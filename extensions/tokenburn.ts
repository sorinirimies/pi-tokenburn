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

export async function collectUsage(
	sessionsRoot: string,
	now: Date = new Date(),
	includeCache = true,
): Promise<TokenBurnReport> {
	const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const dayOfWeek = (now.getDay() + 6) % 7; // Monday = 0
	const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek).getTime();
	const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

	const report: TokenBurnReport = {
		today: emptyStats(),
		week: emptyStats(),
		month: emptyStats(),
		total: emptyStats(),
	};

	const files = listSessionFiles(sessionsRoot);
	const live = new Set(files);
	for (const key of FILE_CACHE.keys()) if (!live.has(key)) FILE_CACHE.delete(key);

	const add = (p: PeriodStats, t: Turn) => {
		p.tokens += t.input + t.output + (includeCache ? t.cacheRead + t.cacheWrite : 0);
		p.input += t.input;
		p.output += t.output;
		p.cacheRead += t.cacheRead;
		p.cacheWrite += t.cacheWrite;
		p.cost += t.cost;
	};

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

		let maxTs = 0;
		for (const t of entry.turns) {
			if (t.ts > maxTs) maxTs = t.ts;
			add(report.total, t);
			if (t.ts >= startOfMonth) add(report.month, t);
			if (t.ts >= startOfWeek) add(report.week, t);
			if (t.ts >= startOfDay) add(report.today, t);
		}
		if (entry.turns.length > 0) report.total.sessions++;
		if (maxTs >= startOfMonth) report.month.sessions++;
		if (maxTs >= startOfWeek) report.week.sessions++;
		if (maxTs >= startOfDay) report.today.sessions++;
	}

	return report;
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
			const opts = ["report", "window", "cache", "status <today|week|month|total>", "budget <day|week|month> <tokens|$cost>"];
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

			if (cmd === "status" && ["today", "week", "month", "total"].includes(p1)) {
				config.statusWindow = p1 as any;
				await saveConfig(config);
				await updateUI(ctx);
				ctx.ui.notify(`tokenburn status window set to: ${p1}`, "info");
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

			// Default: print report
			const report = await collectUsage(getSessionsDir(), new Date(), config.includeCache);
			const formatRow = (name: string, p: PeriodStats) =>
				`${name.padEnd(8)}: ${formatNum(p.tokens).padStart(8)} tokens (${formatCost(p.cost)}) · in:${formatNum(p.input)} out:${formatNum(p.output)} cache:${formatNum(p.cacheRead + p.cacheWrite)} · ${p.sessions} sessions`;

			const output = [
				"🔥 TokenBurn Report",
				"--------------------------------------------------",
				formatRow("Today", report.today),
				formatRow("This Week", report.week),
				formatRow("This Month", report.month),
				formatRow("All Time", report.total),
				"--------------------------------------------------",
				`Use '/tokenburn window' to toggle persistent status window.`,
			].join("\n");

			ctx.ui.notify(output, "info");
		},
	});
}
