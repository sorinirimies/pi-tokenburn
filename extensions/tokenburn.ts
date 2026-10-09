/**
 * pi-tokenburn — token usage monitor with budget alerts in your Pi session.
 *
 * Inspired by the tokenburn Rust project (https://github.com/sorinirimies/tokenburn).
 * Reads local Pi session JSONL logs directly (0 network, 0 prompt tokens).
 *
 * Features:
 *   - Status bar indicator: `🔥 1.2M (today) · $0.45`
 *   - Optional widget window with Day / Week / Month / Total breakdown
 *   - Configurable limits with visual warning when budget threshold is exceeded
 *   - Commands:
 *       /tokenburn                show token burn report
 *       /tokenburn window         toggle permanent tokenburn widget in editor
 *       /tokenburn budget <d|w|m> <tokens|cost>  set budget
 */

import { readdirSync, statSync } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFile, writeFile, mkdir } from "node:fs/promises";

export interface TokenUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

export interface PeriodStats {
	/** input + output (+ cache read/write when includeCache). */
	tokens: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	sessions: number;
}

export interface TokenBurnReport {
	today: PeriodStats;
	week: PeriodStats;
	month: PeriodStats;
	year: PeriodStats;
	total: PeriodStats;
}

export const STATUS_WINDOWS = ["today", "week", "month", "year", "total"] as const;
export type Window = (typeof STATUS_WINDOWS)[number];

export interface TokenBurnConfig {
	/** Master switch. When false nothing runs in the background and the status line / panel are cleared. */
	enabled: boolean;
	/** Refresh after each assistant message (coalesced), not only when a turn ends. */
	liveRefresh: boolean;
	/** Trailing delay for live refreshes, in ms (250 to 60000). */
	refreshMs: number;
	/** Count cache read/write tokens in totals (matches the tokenburn CLI). */
	includeCache: boolean;
	/** Color the report chart (set false if your terminal garbles ANSI in notifications). */
	chartColor: boolean;
	showStatus: boolean;
	showWidget: boolean;
	statusWindow: Window;
	budgets: {
		dayTokens?: number;
		weekTokens?: number;
		monthTokens?: number;
		dayCost?: number;
		weekCost?: number;
		monthCost?: number;
	};
}

const DEFAULT_CONFIG: TokenBurnConfig = {
	enabled: true,
	liveRefresh: true,
	refreshMs: 750,
	includeCache: true,
	chartColor: true,
	showStatus: true,
	showWidget: false,
	statusWindow: "today",
	budgets: {},
};

/** Where pi keeps its config: PI_CODING_AGENT_DIR, then $XDG_CONFIG_HOME/pi/agent, then ~/.pi/agent. */
export function resolveAgentDir(env: Record<string, string | undefined>, home: string): string {
	if (env.PI_CODING_AGENT_DIR) return env.PI_CODING_AGENT_DIR;
	if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "pi", "agent");
	return join(home, ".pi", "agent");
}

/** Pi session logs: TOKENBURN_PI_SESSIONS, PI_CODING_AGENT_SESSION_DIR, then <agent dir>/sessions. */
export function resolveSessionsDir(env: Record<string, string | undefined>, home: string): string {
	if (env.TOKENBURN_PI_SESSIONS) return env.TOKENBURN_PI_SESSIONS;
	if (env.PI_CODING_AGENT_SESSION_DIR) return env.PI_CODING_AGENT_SESSION_DIR;
	return join(resolveAgentDir(env, home), "sessions");
}

const getConfigDir = () => resolveAgentDir(process.env, homedir());

const getSessionsDir = () => resolveSessionsDir(process.env, homedir());

export async function loadConfig(): Promise<TokenBurnConfig> {
	try {
		const raw = await readFile(join(getConfigDir(), "tokenburn.json"), "utf8");
		const parsed = JSON.parse(raw);
		return {
			enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_CONFIG.enabled,
			liveRefresh: typeof parsed.liveRefresh === "boolean" ? parsed.liveRefresh : DEFAULT_CONFIG.liveRefresh,
			refreshMs: sanitizeRefreshMs(parsed.refreshMs),
			includeCache: typeof parsed.includeCache === "boolean" ? parsed.includeCache : DEFAULT_CONFIG.includeCache,
			chartColor: typeof parsed.chartColor === "boolean" ? parsed.chartColor : DEFAULT_CONFIG.chartColor,
			showStatus: typeof parsed.showStatus === "boolean" ? parsed.showStatus : DEFAULT_CONFIG.showStatus,
			showWidget: typeof parsed.showWidget === "boolean" ? parsed.showWidget : DEFAULT_CONFIG.showWidget,
			statusWindow: (STATUS_WINDOWS as readonly string[]).includes(parsed.statusWindow)
				? parsed.statusWindow
				: DEFAULT_CONFIG.statusWindow,
			budgets: sanitizeBudgets(parsed.budgets),
		};
	} catch {
		return freshConfig();
	}
}

/** Live-refresh delay: a finite number clamped to 250..60000 ms, else the default. */
export function sanitizeRefreshMs(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_CONFIG.refreshMs;
	return Math.min(60_000, Math.max(250, Math.round(value)));
}

const BUDGET_KEYS = ["dayTokens", "weekTokens", "monthTokens", "dayCost", "weekCost", "monthCost"] as const;

/** Keep only known budget keys holding positive, finite numbers (the file is hand-editable). */
export function sanitizeBudgets(value: unknown): TokenBurnConfig["budgets"] {
	const out: TokenBurnConfig["budgets"] = {};
	if (typeof value !== "object" || value === null || Array.isArray(value)) return out;
	for (const key of BUDGET_KEYS) {
		const n = (value as Record<string, unknown>)[key];
		if (typeof n === "number" && Number.isFinite(n) && n > 0) out[key] = n;
	}
	return out;
}

/** A config that shares no mutable state with DEFAULT_CONFIG. */
export function freshConfig(): TokenBurnConfig {
	return { ...DEFAULT_CONFIG, budgets: {} };
}

export async function saveConfig(cfg: TokenBurnConfig): Promise<void> {
	await mkdir(getConfigDir(), { recursive: true });
	await writeFile(join(getConfigDir(), "tokenburn.json"), JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

export function formatNum(n: number): string {
	if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
	if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
	if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
	return n.toString();
}

export function formatCost(c: number): string {
	return `$${c.toFixed(2)}`;
}

interface Turn {
	ts: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

/** What was read from disk, for tests and tuning: refreshes must cost O(new bytes). */
export const stats = { bytesRead: 0, fullParses: 0, incrementalParses: 0 };

export function resetStats(): void {
	stats.bytesRead = 0;
	stats.fullParses = 0;
	stats.incrementalParses = 0;
}

/**
 * Per-session-file parse state. Pi session logs are append-only JSONL, so after the first
 * parse only the bytes added since then are read. The state is dropped (full reparse) when
 * the file shrank, was rewritten in place, or its head / last-parsed bytes no longer match.
 */
interface FileEntry {
	size: number;
	mtimeMs: number;
	/** End of the last COMPLETE (newline-terminated) line that was parsed. */
	offset: number;
	turns: Turn[];
	/** Turn from an unterminated final line; counted now, re-parsed once the line completes. */
	tail: Turn[];
	/** First bytes of the file, to notice a rewrite. */
	head: Buffer;
	/** The bytes just before `offset`, same purpose. */
	guard: Buffer;
}

const FILE_CACHE = new Map<string, FileEntry>();
const GUARD_BYTES = 64;
const HEAD_BYTES = 256;
const CHUNK_BYTES = 1 << 20;

/** A Turn from one JSONL line, or undefined when it carries no usage. */
function turnFromLine(line: Buffer): Turn | undefined {
	if (!line.includes('"usage"')) return undefined; // most lines: skip without a JSON parse
	try {
		const obj = JSON.parse(line.toString("utf8"));
		const usage = obj.message?.usage;
		if (!obj.timestamp || !usage) return undefined;
		const ts = new Date(obj.timestamp).getTime();
		if (!Number.isFinite(ts)) return undefined;
		return {
			ts,
			input: Number(usage.input) || 0,
			output: Number(usage.output) || 0,
			cacheRead: Number(usage.cacheRead) || 0,
			cacheWrite: Number(usage.cacheWrite) || 0,
			cost: Number(usage.cost?.total) || 0,
		};
	} catch {
		return undefined;
	}
}

async function readAt(fd: FileHandle, buf: Buffer, position: number): Promise<number> {
	const { bytesRead } = await fd.read(buf, 0, buf.length, position);
	stats.bytesRead += bytesRead;
	return bytesRead;
}

/** Parse complete lines in [start, end). Returns their turns, where they stop, and the unterminated rest. */
async function scan(
	fd: FileHandle,
	start: number,
	end: number,
	chunkSize: number,
): Promise<{ turns: Turn[]; consumed: number; rest: Buffer }> {
	const turns: Turn[] = [];
	const buf = Buffer.allocUnsafe(Math.min(chunkSize, Math.max(1, end - start)));
	let pos = start;
	let consumed = start;
	let carry: Buffer = Buffer.alloc(0);
	while (pos < end) {
		const want = Math.min(buf.length, end - pos);
		const n = await readAt(fd, want === buf.length ? buf : buf.subarray(0, want), pos);
		if (n === 0) break;
		const base = pos - carry.length;
		const data = carry.length > 0 ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
		let lineStart = 0;
		for (let nl = data.indexOf(10, lineStart); nl !== -1; nl = data.indexOf(10, lineStart)) {
			const t = turnFromLine(data.subarray(lineStart, nl));
			if (t) turns.push(t);
			lineStart = nl + 1;
		}
		if (lineStart > 0) consumed = base + lineStart;
		carry = Buffer.from(data.subarray(lineStart)); // copy: `buf` is reused
		pos += n;
	}
	return { turns, consumed, rest: carry };
}

async function bytesAt(fd: FileHandle, position: number, length: number): Promise<Buffer> {
	if (length <= 0) return Buffer.alloc(0);
	const buf = Buffer.alloc(length);
	const n = await readAt(fd, buf, position);
	return buf.subarray(0, n);
}

/** Is the prefix we parsed earlier still what is on disk? */
async function stillAppendOnly(fd: FileHandle, prev: FileEntry): Promise<boolean> {
	const head = await bytesAt(fd, 0, prev.head.length);
	if (!head.equals(prev.head)) return false;
	const guard = await bytesAt(fd, prev.offset - prev.guard.length, prev.guard.length);
	return guard.equals(prev.guard);
}

async function refreshEntry(
	file: string,
	st: { size: number; mtimeMs: number },
	prev: FileEntry | undefined,
	chunkSize: number,
): Promise<FileEntry | undefined> {
	let fd: FileHandle;
	try {
		fd = await open(file, "r");
	} catch {
		return undefined;
	}
	try {
		const grew = prev !== undefined && st.size > prev.size;
		const incremental = grew && (await stillAppendOnly(fd, prev!));
		const start = incremental ? prev!.offset : 0;
		const turns = incremental ? prev!.turns : [];
		if (incremental) stats.incrementalParses++;
		else stats.fullParses++;

		const r = await scan(fd, start, st.size, chunkSize);
		for (const t of r.turns) turns.push(t);
		const tailTurn = r.rest.length > 0 ? turnFromLine(r.rest) : undefined;
		return {
			size: st.size,
			mtimeMs: st.mtimeMs,
			offset: r.consumed,
			turns,
			tail: tailTurn ? [tailTurn] : [],
			head: incremental ? prev!.head : await bytesAt(fd, 0, Math.min(HEAD_BYTES, st.size)),
			guard: await bytesAt(fd, Math.max(0, r.consumed - GUARD_BYTES), Math.min(GUARD_BYTES, r.consumed)),
		};
	} catch {
		return undefined;
	} finally {
		await fd.close();
	}
}

/** Size and mtime of a file, or undefined when it cannot be stat'ed. */
export function fileStat(file: string): { size: number; mtimeMs: number } | undefined {
	try {
		const st = statSync(file);
		return { size: st.size, mtimeMs: st.mtimeMs };
	} catch {
		return undefined;
	}
}

function listSessionFiles(root: string): string[] {
	const files: string[] = [];
	const walk = (dir: string) => {
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			const full = join(dir, e.name);
			if (e.isDirectory()) walk(full);
			else if (e.isFile() && e.name.endsWith(".jsonl")) files.push(full);
		}
	};
	walk(root);
	return files;
}

const emptyStats = (): PeriodStats => ({
	tokens: 0,
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	cost: 0,
	sessions: 0,
});

/** Bring the per-file cache up to date (reading only what changed) and return every file's turns. */
async function loadAll(sessionsRoot: string, chunkSize = CHUNK_BYTES): Promise<Turn[][]> {
	const files = listSessionFiles(sessionsRoot);
	const live = new Set(files);
	for (const key of FILE_CACHE.keys()) if (!live.has(key)) FILE_CACHE.delete(key);

	const out: Turn[][] = [];
	for (const file of files) {
		const st = fileStat(file);
		if (st === undefined) continue; // vanished between listing and stat
		let entry = FILE_CACHE.get(file);
		if (!entry || entry.size !== st.size || entry.mtimeMs !== st.mtimeMs) {
			const fresh = await refreshEntry(file, st, entry, chunkSize);
			if (fresh) FILE_CACHE.set(file, fresh);
			else FILE_CACHE.delete(file);
			entry = fresh;
		}
		if (entry) out.push(entry.tail.length > 0 ? entry.turns.concat(entry.tail) : entry.turns);
	}
	return out;
}

/** Test hooks: parse with a tiny chunk size (chunk boundaries) / refresh one file directly. */
export const __loadAllForTests = loadAll;
export const __refreshEntryForTests = refreshEntry;

const turnTokens = (t: Turn, includeCache: boolean) =>
	t.input + t.output + (includeCache ? t.cacheRead + t.cacheWrite : 0);

export async function collectUsage(
	sessionsRoot: string,
	now: Date = new Date(),
	includeCache = true,
): Promise<TokenBurnReport> {
	const startOfDay = bucketStart(now.getTime(), "day");
	const startOfWeek = bucketStart(now.getTime(), "week");
	const startOfMonth = bucketStart(now.getTime(), "month");
	const startOfYear = bucketStart(now.getTime(), "year");

	const report: TokenBurnReport = {
		today: emptyStats(),
		week: emptyStats(),
		month: emptyStats(),
		year: emptyStats(),
		total: emptyStats(),
	};

	const add = (p: PeriodStats, t: Turn) => {
		p.tokens += turnTokens(t, includeCache);
		p.input += t.input;
		p.output += t.output;
		p.cacheRead += t.cacheRead;
		p.cacheWrite += t.cacheWrite;
		p.cost += t.cost;
	};

	for (const turns of await loadAll(sessionsRoot)) {
		let maxTs = 0;
		for (const t of turns) {
			if (t.ts > maxTs) maxTs = t.ts;
			add(report.total, t);
			if (t.ts >= startOfYear) add(report.year, t);
			if (t.ts >= startOfMonth) add(report.month, t);
			if (t.ts >= startOfWeek) add(report.week, t);
			if (t.ts >= startOfDay) add(report.today, t);
		}
		if (turns.length > 0) report.total.sessions++;
		if (maxTs >= startOfYear) report.year.sessions++;
		if (maxTs >= startOfMonth) report.month.sessions++;
		if (maxTs >= startOfWeek) report.week.sessions++;
		if (maxTs >= startOfDay) report.today.sessions++;
	}

	return report;
}

// ---------------------------------------------------------------------------
// Time series + chart
// ---------------------------------------------------------------------------

export type Unit = "day" | "week" | "month" | "year";

/** Local-time start of the day / Monday-week / month containing `ts`. */
export function bucketStart(ts: number, unit: Unit): number {
	const d = new Date(ts);
	if (unit === "day") return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	if (unit === "week") {
		const dow = (d.getDay() + 6) % 7; // Monday = 0
		return new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow).getTime();
	}
	if (unit === "year") return new Date(d.getFullYear(), 0, 1).getTime();
	return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export function bucketLabel(start: number, unit: Unit): string {
	const d = new Date(start);
	if (unit === "year") return String(d.getFullYear());
	if (unit === "month") return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
	const base = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
	return unit === "day" ? `${base} ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]}` : `${base} wk`;
}

export interface SeriesPoint {
	start: number;
	label: string;
	tokens: number;
	cost: number;
}

export const DEFAULT_COUNT: Record<Unit, number> = { day: 14, week: 8, month: 6, year: 5 };

/** Last `count` buckets ending at `now`, oldest first, empty buckets zero-filled. */
export async function collectSeries(
	sessionsRoot: string,
	unit: Unit,
	count = DEFAULT_COUNT[unit],
	now: Date = new Date(),
	includeCache = true,
): Promise<SeriesPoint[]> {
	const starts: number[] = [];
	for (let i = count - 1; i >= 0; i--) {
		const y = now.getFullYear();
		const m = now.getMonth();
		const day = now.getDate();
		const anchor =
			unit === "day"
				? new Date(y, m, day - i)
				: unit === "week"
					? new Date(y, m, day - i * 7)
					: unit === "year"
						? new Date(y - i, 0, 1)
						: new Date(y, m - i, 1);
		starts.push(bucketStart(anchor.getTime(), unit));
	}
	const points = new Map<number, SeriesPoint>(
		starts.map((start) => [start, { start, label: bucketLabel(start, unit), tokens: 0, cost: 0 }]),
	);
	for (const turns of await loadAll(sessionsRoot)) {
		for (const t of turns) {
			const pt = points.get(bucketStart(t.ts, unit));
			if (!pt) continue;
			pt.tokens += turnTokens(t, includeCache);
			pt.cost += t.cost;
		}
	}
	return starts.map((s) => points.get(s)!);
}

/**
 * Whole history: monthly columns while it spans <= 18 months, yearly after that.
 * Always at least 2 columns so the chart has a shape.
 */
export async function collectAllSeries(
	sessionsRoot: string,
	now: Date = new Date(),
	includeCache = true,
): Promise<{ unit: Unit; series: SeriesPoint[] }> {
	let first = now.getTime();
	for (const turns of await loadAll(sessionsRoot)) for (const t of turns) if (t.ts < first) first = t.ts;
	const f = new Date(first);
	const months = (now.getFullYear() - f.getFullYear()) * 12 + (now.getMonth() - f.getMonth()) + 1;
	if (months <= 18) {
		const unit: Unit = "month";
		return { unit, series: await collectSeries(sessionsRoot, unit, Math.max(2, months), now, includeCache) };
	}
	const years = now.getFullYear() - f.getFullYear() + 1;
	return { unit: "year", series: await collectSeries(sessionsRoot, "year", years, now, includeCache) };
}

const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];
const SPARK = "▁▂▃▄▅▆▇█";

/** Horizontal bar of `value/max` over `width` cells, with 1/8-cell precision. */
export function bar(value: number, max: number, width: number): string {
	if (max <= 0 || value <= 0) return "";
	const eighths = Math.max(1, Math.round((value / max) * width * 8));
	const full = Math.floor(eighths / 8);
	return "█".repeat(full) + EIGHTHS[eighths % 8];
}

export function sparkline(values: number[]): string {
	const max = Math.max(...values, 0);
	if (max <= 0) return SPARK[0].repeat(values.length);
	return values.map((v) => SPARK[Math.min(7, Math.round((v / max) * 7))]).join("");
}

const UNIT_TITLE: Record<Unit, string> = { day: "Daily", week: "Weekly", month: "Monthly", year: "Yearly" };
const UNIT_NOUN: Record<Unit, string> = { day: "day", week: "week", month: "month", year: "year" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type Paint = (kind: "bar" | "now" | "over" | "axis" | "budget" | "dim" | "title", text: string) => string;
const plain: Paint = (_k, t) => t;

/** Two header rows for a column: [top, bottom]. */
function columnLabels(p: SeriesPoint, unit: Unit): [string, string] {
	const d = new Date(p.start);
	if (unit === "day") return [pad2(d.getDate()), ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][d.getDay()]];
	if (unit === "week") return [`${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`, "wk"];
	if (unit === "year") return [String(d.getFullYear()), ""];
	return [MONTHS[d.getMonth()], String(d.getFullYear())];
}

/**
 * Vertical column chart: y-axis, 1/8-row precision, optional budget line,
 * highlighted current bucket and over-budget columns, summary footer.
 */
export function renderChart(
	series: SeriesPoint[],
	unit: Unit,
	opts: { height?: number; budget?: { tokens?: number; cost?: number }; paint?: Paint; title?: string } = {},
): string[] {
	const paint = opts.paint ?? plain;
	const height = opts.height ?? 8;
	const colW = unit === "day" ? 3 : 6; // bar cells + 1 gap
	const barW = colW - 1;

	const peakPoint = series.reduce((m, p) => (p.tokens > m.tokens ? p : m), series[0]);
	const dataMax = peakPoint?.tokens ?? 0;
	const budgetTokens = opts.budget?.tokens;
	const scaleMax = Math.max(dataMax, budgetTokens ?? 0);
	const total = series.reduce((a, p) => a + p.tokens, 0);
	const totalCost = series.reduce((a, p) => a + p.cost, 0);

	const yLabels = [formatNum(scaleMax), formatNum(scaleMax / 2), "0"];
	const yW = Math.max(...yLabels.map((l) => l.length)) + 1;
	const labelFor = (row: number) => (row === height ? yLabels[0] : row === Math.ceil(height / 2) ? yLabels[1] : "");
	const budgetRow = budgetTokens && scaleMax > 0 ? Math.max(1, Math.ceil((budgetTokens / scaleMax) * height)) : 0;

	const isOver = (p: SeriesPoint) =>
		opts.budget ? isOverBudget({ tokens: p.tokens, cost: p.cost } as PeriodStats, opts.budget) : false;
	const kindOf = (i: number): "bar" | "now" | "over" =>
		isOver(series[i]) ? "over" : i === series.length - 1 ? "now" : "bar";

	const lines: string[] = [];
	lines.push(
		paint("title", opts.title ?? `${UNIT_TITLE[unit]} tokens`) +
			paint("dim", ` · ${opts.title ? "" : "last "}${series.length} ${UNIT_NOUN[unit]}${series.length === 1 ? "" : "s"}`) +
			(budgetTokens ? paint("budget", `  ┄ budget ${formatNum(budgetTokens)}`) : ""),
	);

	for (let row = height; row >= 1; row--) {
		let line = paint("axis", `${labelFor(row).padStart(yW)} │`);
		for (let i = 0; i < series.length; i++) {
			const h = scaleMax > 0 ? (series[i].tokens / scaleMax) * height : 0;
			let cell: string;
			if (h >= row) cell = "█";
			else if (h > row - 1 && series[i].tokens > 0) cell = SPARK[Math.min(7, Math.max(0, Math.floor((h - (row - 1)) * 8) - 1))];
			else if (row === 1 && series[i].tokens > 0) cell = "▁";
			else cell = row === budgetRow ? "┄" : " ";
			const filled = cell !== " " && cell !== "┄";
			const body = cell.repeat(barW);
			line += filled ? paint(kindOf(i), body) : cell === "┄" ? paint("budget", body) : body;
			line += row === budgetRow ? paint("budget", "┄") : " ";
		}
		lines.push(line);
	}

	lines.push(paint("axis", `${"".padStart(yW)} └${"─".repeat(series.length * colW)}`));
	const pad = " ".repeat(yW + 2);
	const cols = series.map((p, i) => ({ l: columnLabels(p, unit), now: i === series.length - 1 }));
	lines.push(pad + cols.map((c) => c.l[0].padEnd(colW)).join(""));
	lines.push(paint("dim", pad + cols.map((c) => c.l[1].padEnd(colW)).join("")));
	lines.push(pad + cols.map((c) => (c.now ? paint("now", "▲".padEnd(colW)) : " ".repeat(colW))).join(""));

	const avg = series.length ? total / series.length : 0;
	lines.push(
		paint(
			"dim",
			`Σ ${formatNum(total)} (${formatCost(totalCost)}) · avg ${formatNum(avg)}/${UNIT_NOUN[unit]}` +
				(dataMax > 0 ? ` · peak ${formatNum(dataMax)} (${bucketLabel(peakPoint.start, unit)})` : ""),
		),
	);
	return lines;
}

/** Clear the per-file cache (tests). */
export function clearCache(): void {
	FILE_CACHE.clear();
}

export function budgetsFor(cfg: TokenBurnConfig, w: Window): { tokens?: number; cost?: number } {
	const b = cfg.budgets;
	if (w === "today") return { tokens: b.dayTokens, cost: b.dayCost };
	if (w === "week") return { tokens: b.weekTokens, cost: b.weekCost };
	if (w === "month") return { tokens: b.monthTokens, cost: b.monthCost };
	return {};
}

export function isOverBudget(p: PeriodStats, b: { tokens?: number; cost?: number }): boolean {
	return (b.tokens !== undefined && p.tokens > b.tokens) || (b.cost !== undefined && p.cost > b.cost);
}

// ---------------------------------------------------------------------------
// Live refresh scheduling
// ---------------------------------------------------------------------------

export interface Timers {
	set: (fn: () => void, ms: number) => unknown;
	clear: (handle: unknown) => void;
}

const realTimers: Timers = {
	set: (fn, ms) => setTimeout(fn, ms),
	clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * Runs `run` at most once per `delayMs` window however often `schedule()` is called
 * (trailing edge), and never two runs at once: a request that arrives mid-run triggers one
 * more run afterwards. A burst of 50 messages costs one refresh. Failures are swallowed;
 * the timer never keeps the process alive.
 */
export function createCoalescer(
	run: () => Promise<void>,
	delayMs: number | (() => number),
	timers: Timers = realTimers,
) {
	let timer: unknown;
	let running = false;
	let dirty = false;

	const execute = async () => {
		if (running) {
			dirty = true;
			return;
		}
		running = true;
		try {
			await run();
		} catch {
			/* a failed refresh must never surface */
		} finally {
			running = false;
		}
		if (dirty) {
			dirty = false;
			schedule();
		}
	};

	const schedule = () => {
		if (timer !== undefined) return; // one is already pending: coalesce
		const ms = typeof delayMs === "function" ? delayMs() : delayMs;
		timer = timers.set(() => {
			timer = undefined;
			void execute();
		}, ms);
		(timer as { unref?: () => void } | undefined)?.unref?.();
	};

	const cancel = () => {
		if (timer !== undefined) timers.clear(timer);
		timer = undefined;
		dirty = false;
	};

	/** Run now (dropping any pending delayed run). */
	const flush = () => {
		if (timer !== undefined) timers.clear(timer);
		timer = undefined;
		return execute();
	};

	return { schedule, cancel, flush, isPending: () => timer !== undefined };
}

/** Map chart roles to pi theme colors. */
export function themePaint(theme: { fg: (c: any, t: string) => string }): Paint {
	const color: Record<string, string> = {
		bar: "accent",
		now: "success",
		over: "error",
		axis: "dim",
		budget: "warning",
		dim: "dim",
		title: "accent",
	};
	return (kind, text) => theme.fg(color[kind], text);
}

export default function tokenBurnExtension(pi: ExtensionAPI) {
	let config: TokenBurnConfig = freshConfig();

	const updateUI = async (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		if (!config.enabled) {
			// Disabled: show nothing and read nothing.
			ctx.ui.setStatus("tokenburn", "");
			ctx.ui.setWidget("tokenburn-panel", []);
			return;
		}
		const report = await collectUsage(getSessionsDir(), new Date(), config.includeCache);
		const theme = ctx.ui.theme;

		// Status bar update
		if (config.showStatus) {
			const stat = report[config.statusWindow];
			const isOver = isOverBudget(stat, budgetsFor(config, config.statusWindow));
			const fire = isOver ? theme.fg("error", "🔥 OVER BUDGET") : theme.fg("warning", "🔥");
			const tokensText = theme.fg(isOver ? "error" : "accent", formatNum(stat.tokens));
			const costText = theme.fg("dim", `(${formatCost(stat.cost)})`);
			const label = theme.fg("dim", `[${config.statusWindow}]`);

			ctx.ui.setStatus("tokenburn", `${fire} ${tokensText} ${costText} ${label}`);
		} else {
			ctx.ui.setStatus("tokenburn", "");
		}

		// Widget panel update
		if (config.showWidget) {
			const border = theme.fg("dim", "─".repeat(46));
			const header = theme.fg("accent", " 🔥 TokenBurn Dashboard ");
			const line = (label: string, p: PeriodStats, b: { tokens?: number; cost?: number } = {}) => {
				const over = isOverBudget(p, b);
				const tokStr = (over ? theme.fg("error", "!") : " ") + formatNum(p.tokens).padStart(8);
				const inStr = `(in:${formatNum(p.input)} out:${formatNum(p.output)})`.padEnd(20);
				const costStr = formatCost(p.cost).padStart(8);
				return `  ${theme.fg("muted", label.padEnd(8))} ${tokStr}  ${theme.fg("dim", inStr)} ${costStr}`;
			};

			const lines = [
				`┌${header}${"─".repeat(21)}┐`,
				line("Today", report.today, budgetsFor(config, "today")),
				line("Week", report.week, budgetsFor(config, "week")),
				line("Month", report.month, budgetsFor(config, "month")),
				line("Year", report.year),
				line("Total", report.total),
				`└${"─".repeat(46)}┘`,
			];

			ctx.ui.setWidget("tokenburn-panel", lines, { placement: "belowEditor" });
		} else {
			ctx.ui.setWidget("tokenburn-panel", []);
		}
	};

	// The latest context, used by the (delayed) live refresh. Dropped at shutdown so a reloaded
	// runtime never touches a stale one.
	let latestCtx: ExtensionContext | undefined;
	const refresher = createCoalescer(
		async () => {
			if (latestCtx && config.enabled) await updateUI(latestCtx);
		},
		() => config.refreshMs,
	);

	pi.on("session_start", async (_event, ctx) => {
		latestCtx = ctx;
		config = await loadConfig();
		// A failing refresh must never break session start.
		await updateUI(ctx).catch(() => {});
	});

	// Live: after each assistant message, coalesced. Never blocks, never throws into pi, and
	// must return undefined (a message_end handler may otherwise replace the message).
	pi.on("message_end", (event, ctx) => {
		if (!config.enabled || !config.liveRefresh) return undefined;
		if ((event.message as { role?: string } | undefined)?.role !== "assistant") return undefined;
		latestCtx = ctx;
		refresher.schedule();
		return undefined;
	});

	// Final, exact refresh when a turn ends (fire-and-forget).
	pi.on("turn_end", (_event, ctx) => {
		if (!config.enabled) return;
		latestCtx = ctx;
		void refresher.flush();
	});

	pi.on("session_shutdown", () => {
		refresher.cancel();
		latestCtx = undefined;
	});

	pi.registerCommand("tokenburn", {
		description: "TokenBurn: /tokenburn [day|week|month|year|all] sets the status bar; /tokenburn chart <day|week|month|year|all> shows the chart",
		getArgumentCompletions: (prefix: string) => completions(prefix),
		handler: async (args, ctx) => {
			const cmd = parseCommand(args);
			latestCtx = ctx;
			const persist = async () => {
				await saveConfig(config);
				await updateUI(ctx);
			};
			// Settings changed while disabled are kept, but nothing shows until it is enabled.
			const note = (msg: string) => ctx.ui.notify(config.enabled ? msg : `${msg} (tokenburn is disabled; /tokenburn enable to show it)`, "info");

			switch (cmd.kind) {
				case "window":
					config.showWidget = !config.showWidget;
					await persist();
					note(`tokenburn widget: ${config.showWidget ? "enabled" : "hidden"}`);
					return;

				case "status":
					config.statusWindow = cmd.window;
					await persist();
					note(`tokenburn status window: ${cmd.window}`);
					return;

				case "cycle": {
					const next = STATUS_WINDOWS[(STATUS_WINDOWS.indexOf(config.statusWindow) + 1) % STATUS_WINDOWS.length];
					config.statusWindow = next;
					await persist();
					note(`tokenburn status window: ${next}`);
					return;
				}

				case "cache":
					config.includeCache = !config.includeCache;
					await persist();
					note(`tokenburn: cache tokens ${config.includeCache ? "included" : "excluded"}`);
					return;

				case "budget": {
					const key = `${cmd.period}${cmd.isCost ? "Cost" : "Tokens"}` as keyof TokenBurnConfig["budgets"];
					config.budgets[key] = cmd.amount;
					await persist();
					note(`tokenburn ${cmd.period} budget: ${cmd.isCost ? formatCost(cmd.amount) : formatNum(cmd.amount) + " tokens"}`);
					return;
				}

				case "enable":
					if (config.enabled) {
						ctx.ui.notify("tokenburn is already enabled", "info");
						return;
					}
					config.enabled = true;
					await persist();
					ctx.ui.notify("tokenburn enabled", "info");
					return;

				case "disable":
					if (!config.enabled) {
						ctx.ui.notify("tokenburn is already disabled", "info");
						return;
					}
					config.enabled = false;
					refresher.cancel();
					await persist(); // clears the status line and the panel
					ctx.ui.notify("tokenburn disabled: nothing runs in the background. /tokenburn enable turns it back on (charts still work on demand)", "info");
					return;

				case "live":
					config.liveRefresh = !config.liveRefresh;
					if (!config.liveRefresh) refresher.cancel();
					await persist();
					note(`tokenburn live refresh ${config.liveRefresh ? "on (after each assistant message)" : "off (only when a turn ends)"}`);
					return;

				case "invalid":
					ctx.ui.notify(cmd.message, "warning");
					return;

				case "report": {
					const root = getSessionsDir();
					const now = new Date();
					const report = await collectUsage(root, now, config.includeCache);
					const paint = config.chartColor ? themePaint(ctx.ui.theme) : undefined;

					let chart: string[];
					if (cmd.view === "all") {
						const all = await collectAllSeries(root, now, config.includeCache);
						chart = renderChart(all.series, all.unit, { paint, title: "All time" });
					} else {
						const series = await collectSeries(root, cmd.view, DEFAULT_COUNT[cmd.view], now, config.includeCache);
						const budgetWindow: Window | undefined =
							cmd.view === "day" ? "today" : cmd.view === "year" ? undefined : cmd.view;
						chart = renderChart(series, cmd.view, {
							paint,
							budget: budgetWindow ? budgetsFor(config, budgetWindow) : undefined,
						});
					}

					const row = (name: string, p: PeriodStats) =>
						`${name.padEnd(10)} ${formatNum(p.tokens).padStart(8)} tokens ${formatCost(p.cost).padStart(9)} · in:${formatNum(p.input)} out:${formatNum(p.output)} cache:${formatNum(p.cacheRead + p.cacheWrite)} · ${p.sessions} sess`;
					const rule = "─".repeat(60);
					ctx.ui.notify(
						[
							"🔥 TokenBurn Report",
							rule,
							row("Today", report.today),
							row("This Week", report.week),
							row("This Month", report.month),
							row("This Year", report.year),
							row("All Time", report.total),
							rule,
							...chart,
							rule,
							"/tokenburn chart <day|week|month|year|all> · /tokenburn <day|week|month|year|all> sets the status bar · cycle · window · budget · cache",
						].join("\n"),
						"info",
					);
					return;
				}
			}
		},
	});
}

// ---------------------------------------------------------------------------
// Command parsing + completions (pure, unit-tested)
// ---------------------------------------------------------------------------

export const REPORT_VIEWS = ["day", "week", "month", "year", "all"] as const;
export type ReportView = (typeof REPORT_VIEWS)[number];
export const BUDGET_PERIODS = ["day", "week", "month"] as const;

export type Command =
	| { kind: "report"; view: ReportView }
	| { kind: "status"; window: Window }
	| { kind: "cycle" }
	| { kind: "window" }
	| { kind: "cache" }
	| { kind: "enable" }
	| { kind: "disable" }
	| { kind: "live" }
	| { kind: "budget"; period: (typeof BUDGET_PERIODS)[number]; amount: number; isCost: boolean }
	| { kind: "invalid"; message: string };

export const USAGE =
	"Usage: /tokenburn [day|week|month|year|all] (status-bar period) · chart [day|week|month|year|all] · status <today|week|month|year|total> · cycle · window · budget <day|week|month> <tokens|$cost> · cache · live · enable · disable";

/** Words that pick the status-bar period: `day` shows today, `all` shows the all-time total. */
const WORD_TO_WINDOW: Record<string, Window> = {
	day: "today",
	today: "today",
	week: "week",
	month: "month",
	year: "year",
	all: "total",
	total: "total",
};

/** Views the chart can show. */
const asView = (w: string | undefined): ReportView | undefined =>
	w === "today" ? "day" : w === "total" ? "all" : (REPORT_VIEWS as readonly string[]).includes(w ?? "") ? (w as ReportView) : undefined;

export function parseCommand(args: string | undefined): Command {
	const [cmd, p1, p2] = (args ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (!cmd) return { kind: "report", view: "day" };

	// /tokenburn day|week|month|year|all → what the bottom status line shows
	const window = WORD_TO_WINDOW[cmd];
	if (window) return { kind: "status", window };

	switch (cmd) {
		case "chart":
		case "report": {
			if (p1 === undefined) return { kind: "report", view: "day" };
			const v = asView(p1);
			return v ? { kind: "report", view: v } : { kind: "invalid", message: `Unknown chart "${p1}". ${USAGE}` };
		}
		case "status":
			return (STATUS_WINDOWS as readonly string[]).includes(p1 ?? "")
				? { kind: "status", window: p1 as Window }
				: { kind: "invalid", message: `Usage: /tokenburn status <${STATUS_WINDOWS.join("|")}>` };
		case "cycle":
			return { kind: "cycle" };
		case "window":
		case "widget":
			return { kind: "window" };
		case "cache":
			return { kind: "cache" };
		case "enable":
		case "on":
			return { kind: "enable" };
		case "disable":
		case "off":
			return { kind: "disable" };
		case "live":
			return { kind: "live" };
		case "budget": {
			const isCost = (p2 ?? "").startsWith("$");
			const amount = Number((p2 ?? "").replace(/^\$/, ""));
			if (!(BUDGET_PERIODS as readonly string[]).includes(p1 ?? "") || !Number.isFinite(amount) || amount <= 0) {
				return { kind: "invalid", message: "Usage: /tokenburn budget <day|week|month> <tokens | $cost>" };
			}
			return { kind: "budget", period: p1 as (typeof BUDGET_PERIODS)[number], amount, isCost };
		}
		default:
			return { kind: "invalid", message: `Unknown option "${cmd}". ${USAGE}` };
	}
}

export interface CompletionItem {
	value: string;
	/** Required by pi: it calls `label.endsWith(...)` when applying a completion. */
	label: string;
	description?: string;
}

const CHART_SPAN: Record<ReportView, string> = {
	day: "last 14 days",
	week: "last 8 weeks",
	month: "last 6 months",
	year: "last 5 years",
	all: "whole history",
};

const TOP_LEVEL: CompletionItem[] = [
	{ value: "day", label: "day", description: "Status bar: today" },
	{ value: "week", label: "week", description: "Status bar: this week" },
	{ value: "month", label: "month", description: "Status bar: this month" },
	{ value: "year", label: "year", description: "Status bar: this year" },
	{ value: "all", label: "all", description: "Status bar: all-time total" },
	{ value: "chart ", label: "chart", description: "Report + chart: day, week, month, year or all" },
	{ value: "status ", label: "status", description: "Set the status-bar period explicitly" },
	{ value: "cycle", label: "cycle", description: "Rotate the status-bar period" },
	{ value: "window", label: "window", description: "Toggle the panel below the editor" },
	{ value: "budget ", label: "budget", description: "Set a day/week/month budget" },
	{ value: "cache", label: "cache", description: "Toggle counting cache tokens" },
	{ value: "live", label: "live", description: "Toggle refreshing after each message" },
	{ value: "enable", label: "enable", description: "Turn tokenburn on (status line, panel, refresh)" },
	{ value: "disable", label: "disable", description: "Turn tokenburn off: nothing runs in the background" },
];

/** `prefix` is the whole argument text typed so far (pi replaces it with `value`). */
export function completions(prefix: string): CompletionItem[] | null {
	const text = (prefix ?? "").toLowerCase().replace(/^\s+/, "");
	// `tail` = " " when the completed text still needs another word (a budget amount).
	const sub = (head: string, words: readonly string[], desc: (w: string) => string, tail = ""): CompletionItem[] =>
		words.map((w) => ({ value: `${head} ${w}${tail}`, label: w, description: desc(w) }));

	let pool: CompletionItem[];
	if (text.startsWith("status ")) pool = sub("status", STATUS_WINDOWS, (w) => `Show ${w} in the status bar`);
	else if (text.startsWith("budget ") && !/^budget \S+ /.test(text))
		pool = sub("budget", BUDGET_PERIODS, (w) => `Set the ${w} budget (tokens or $cost)`, " ");
	else if (/^(report|chart) /.test(text)) {
		const head = text.split(" ")[0];
		pool = sub(head, REPORT_VIEWS, (w) => `Chart: ${CHART_SPAN[w as ReportView]}`);
	} else pool = TOP_LEVEL;

	const out = pool.filter((i) => i.value.startsWith(text));
	return out.length > 0 ? out : null;
}
