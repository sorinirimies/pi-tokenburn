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
import { open } from "node:fs/promises";
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
	total: PeriodStats;
}

export interface TokenBurnConfig {
	/** Count cache read/write tokens in totals (matches the tokenburn CLI). */
	includeCache: boolean;
	/** Color the report chart (set false if your terminal garbles ANSI in notifications). */
	chartColor: boolean;
	showStatus: boolean;
	showWidget: boolean;
	statusWindow: "today" | "week" | "month" | "total";
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
	includeCache: true,
	chartColor: true,
	showStatus: true,
	showWidget: false,
	statusWindow: "today",
	budgets: {},
};

function getConfigDir(): string {
	if (process.env.PI_CODING_AGENT_DIR) return process.env.PI_CODING_AGENT_DIR;
	if (process.env.XDG_CONFIG_HOME) return join(process.env.XDG_CONFIG_HOME, "pi", "agent");
	return join(homedir(), ".pi", "agent");
}

function getSessionsDir(): string {
	if (process.env.TOKENBURN_PI_SESSIONS) return process.env.TOKENBURN_PI_SESSIONS;
	if (process.env.PI_CODING_AGENT_SESSION_DIR) return process.env.PI_CODING_AGENT_SESSION_DIR;
	return join(getConfigDir(), "sessions");
}

export async function loadConfig(): Promise<TokenBurnConfig> {
	try {
		const raw = await readFile(join(getConfigDir(), "tokenburn.json"), "utf8");
		const parsed = JSON.parse(raw);
		return {
			includeCache: typeof parsed.includeCache === "boolean" ? parsed.includeCache : DEFAULT_CONFIG.includeCache,
			chartColor: typeof parsed.chartColor === "boolean" ? parsed.chartColor : DEFAULT_CONFIG.chartColor,
			showStatus: typeof parsed.showStatus === "boolean" ? parsed.showStatus : DEFAULT_CONFIG.showStatus,
			showWidget: typeof parsed.showWidget === "boolean" ? parsed.showWidget : DEFAULT_CONFIG.showWidget,
			statusWindow: ["today", "week", "month", "total"].includes(parsed.statusWindow)
				? parsed.statusWindow
				: DEFAULT_CONFIG.statusWindow,
			budgets: typeof parsed.budgets === "object" && parsed.budgets !== null ? parsed.budgets : {},
		};
	} catch {
		return { ...DEFAULT_CONFIG };
	}
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

/** Parsed turns per session file, reused while the file is unchanged (mtime + size). */
const FILE_CACHE = new Map<string, { sig: string; turns: Turn[] }>();

async function parseFile(file: string): Promise<Turn[]> {
	const turns: Turn[] = [];
	try {
		const fd = await open(file, "r");
		try {
			for await (const line of fd.readLines({ encoding: "utf8" })) {
				if (!line.includes('"usage"')) continue;
				try {
					const obj = JSON.parse(line);
					const usage = obj.message?.usage;
					if (!obj.timestamp || !usage) continue;
					const ts = new Date(obj.timestamp).getTime();
					if (!Number.isFinite(ts)) continue;
					turns.push({
						ts,
						input: Number(usage.input) || 0,
						output: Number(usage.output) || 0,
						cacheRead: Number(usage.cacheRead) || 0,
						cacheWrite: Number(usage.cacheWrite) || 0,
						cost: Number(usage.cost?.total) || 0,
					});
				} catch {}
			}
		} finally {
			await fd.close();
		}
	} catch {}
	return turns;
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

/** Refresh the per-file cache and return every session file's parsed turns. */
async function loadAll(sessionsRoot: string): Promise<Turn[][]> {
	const files = listSessionFiles(sessionsRoot);
	const live = new Set(files);
	for (const key of FILE_CACHE.keys()) if (!live.has(key)) FILE_CACHE.delete(key);

	const out: Turn[][] = [];
	for (const file of files) {
		let sig: string;
		try {
			const st = statSync(file);
			sig = `${st.mtimeMs}:${st.size}`;
		} catch {
			continue;
		}
		let entry = FILE_CACHE.get(file);
		if (!entry || entry.sig !== sig) {
			entry = { sig, turns: await parseFile(file) };
			FILE_CACHE.set(file, entry);
		}
		out.push(entry.turns);
	}
	return out;
}

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

	const report: TokenBurnReport = {
		today: emptyStats(),
		week: emptyStats(),
		month: emptyStats(),
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
			if (t.ts >= startOfMonth) add(report.month, t);
			if (t.ts >= startOfWeek) add(report.week, t);
			if (t.ts >= startOfDay) add(report.today, t);
		}
		if (turns.length > 0) report.total.sessions++;
		if (maxTs >= startOfMonth) report.month.sessions++;
		if (maxTs >= startOfWeek) report.week.sessions++;
		if (maxTs >= startOfDay) report.today.sessions++;
	}

	return report;
}

// ---------------------------------------------------------------------------
// Time series + chart
// ---------------------------------------------------------------------------

export type Unit = "day" | "week" | "month";

/** Local-time start of the day / Monday-week / month containing `ts`. */
export function bucketStart(ts: number, unit: Unit): number {
	const d = new Date(ts);
	if (unit === "day") return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	if (unit === "week") {
		const dow = (d.getDay() + 6) % 7; // Monday = 0
		return new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow).getTime();
	}
	return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export function bucketLabel(start: number, unit: Unit): string {
	const d = new Date(start);
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

export const DEFAULT_COUNT: Record<Unit, number> = { day: 14, week: 8, month: 6 };

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

const UNIT_TITLE: Record<Unit, string> = { day: "Daily", week: "Weekly", month: "Monthly" };
const UNIT_NOUN: Record<Unit, string> = { day: "day", week: "week", month: "month" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type Paint = (kind: "bar" | "now" | "over" | "axis" | "budget" | "dim" | "title", text: string) => string;
const plain: Paint = (_k, t) => t;

/** Two header rows for a column: [top, bottom]. */
function columnLabels(p: SeriesPoint, unit: Unit): [string, string] {
	const d = new Date(p.start);
	if (unit === "day") return [pad2(d.getDate()), ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][d.getDay()]];
	if (unit === "week") return [`${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`, "wk"];
	return [MONTHS[d.getMonth()], String(d.getFullYear())];
}

/**
 * Vertical column chart: y-axis, 1/8-row precision, optional budget line,
 * highlighted current bucket and over-budget columns, summary footer.
 */
export function renderChart(
	series: SeriesPoint[],
	unit: Unit,
	opts: { height?: number; budget?: { tokens?: number; cost?: number }; paint?: Paint } = {},
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
		paint("title", `${UNIT_TITLE[unit]} tokens`) +
			paint("dim", ` · last ${series.length} ${UNIT_NOUN[unit]}s`) +
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

export type Window = "today" | "week" | "month" | "total";

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
	let config: TokenBurnConfig = { ...DEFAULT_CONFIG };

	const updateUI = async (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
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
				line("Total", report.total),
				`└${"─".repeat(46)}┘`,
			];

			ctx.ui.setWidget("tokenburn-panel", lines, { placement: "belowEditor" });
		} else {
			ctx.ui.setWidget("tokenburn-panel", []);
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		config = await loadConfig();
		await updateUI(ctx);
	});

	// Fire-and-forget: never block the agent loop on a stats refresh.
	pi.on("turn_end", (_event, ctx) => {
		void updateUI(ctx).catch(() => {});
	});

	pi.registerCommand("tokenburn", {
		description: "TokenBurn stats: show report, toggle widget, or set budgets",
		getArgumentCompletions: (prefix: string) => {
			const opts = ["report", "day", "week", "month", "today", "total", "cycle", "window", "cache", "status <today|week|month|total>", "budget <day|week|month> <tokens|$cost>"];
			return opts.filter((o) => o.startsWith(prefix)).map((value) => ({ value }));
		},
		handler: async (args, ctx) => {
			const [cmd, p1, p2] = (args ?? "").trim().split(/\s+/).filter(Boolean);

			if (cmd === "window" || cmd === "widget") {
				config.showWidget = !config.showWidget;
				await saveConfig(config);
				await updateUI(ctx);
				ctx.ui.notify(`tokenburn widget: ${config.showWidget ? "enabled" : "hidden"}`, "info");
				return;
			}

			const WINDOWS = ["today", "week", "month", "total"] as const;
			const setWindow = async (w: (typeof WINDOWS)[number]) => {
				config.statusWindow = w;
				await saveConfig(config);
				await updateUI(ctx);
				ctx.ui.notify(`tokenburn status window: ${w}`, "info");
			};

			// /tokenburn today|week|month|total  — shortcut for the status bar period
			if ((WINDOWS as readonly string[]).includes(cmd ?? "")) {
				await setWindow(cmd as (typeof WINDOWS)[number]);
				return;
			}
			if (cmd === "status" && (WINDOWS as readonly string[]).includes(p1 ?? "")) {
				await setWindow(p1 as (typeof WINDOWS)[number]);
				return;
			}
			// /tokenburn cycle  — today → week → month → total → today
			if (cmd === "cycle") {
				await setWindow(WINDOWS[(WINDOWS.indexOf(config.statusWindow) + 1) % WINDOWS.length]);
				return;
			}

			if (cmd === "cache") {
				config.includeCache = !config.includeCache;
				await saveConfig(config);
				await updateUI(ctx);
				ctx.ui.notify(`tokenburn: cache tokens ${config.includeCache ? "included" : "excluded"}`, "info");
				return;
			}

			if (cmd === "budget") {
				const isCost = (p2 ?? "").startsWith("$");
				const val = Number((p2 ?? "").replace(/^\$/, ""));
				if (!["day", "week", "month"].includes(p1 ?? "") || !Number.isFinite(val) || val <= 0) {
					ctx.ui.notify("Usage: /tokenburn budget <day|week|month> <tokens | $cost>", "warning");
					return;
				}
				const key = `${p1}${isCost ? "Cost" : "Tokens"}` as keyof TokenBurnConfig["budgets"];
				config.budgets[key] = val;
				await saveConfig(config);
				await updateUI(ctx);
				ctx.ui.notify(`tokenburn ${p1} budget: ${isCost ? formatCost(val) : formatNum(val) + " tokens"}`, "info");
				return;
			}

			// /tokenburn [report] [day|week|month]  — summary + chart
			const unitArg = (cmd === "report" || cmd === "chart" ? p1 : cmd) as string | undefined;
			const unit: Unit = unitArg === "week" || unitArg === "month" ? unitArg : "day";
			const report = await collectUsage(getSessionsDir(), new Date(), config.includeCache);
			const series = await collectSeries(getSessionsDir(), unit, DEFAULT_COUNT[unit], new Date(), config.includeCache);
			const budgetKey = unit === "day" ? "today" : unit === "week" ? "week" : "month";
			const formatRow = (name: string, p: PeriodStats) =>
				`${name.padEnd(10)} ${formatNum(p.tokens).padStart(8)} tokens ${formatCost(p.cost).padStart(9)} · in:${formatNum(p.input)} out:${formatNum(p.output)} cache:${formatNum(p.cacheRead + p.cacheWrite)} · ${p.sessions} sess`;

			const output = [
				"🔥 TokenBurn Report",
				"─".repeat(60),
				formatRow("Today", report.today),
				formatRow("This Week", report.week),
				formatRow("This Month", report.month),
				formatRow("All Time", report.total),
				"─".repeat(60),
				...renderChart(series, unit, { budget: budgetsFor(config, budgetKey as Window), paint: config.chartColor ? themePaint(ctx.ui.theme) : undefined }),
				"─".repeat(60),
				"/tokenburn [day|week|month] chart · today|week|month|total|cycle status bar · window · budget · cache",
			].join("\n");

			ctx.ui.notify(output, "info");
		},
	});
}
