/** Config file (tokenburn.json), path resolution, budgets. */
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { STATUS_WINDOWS, type PeriodStats, type Window } from "./types.ts";

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

export const DEFAULT_CONFIG: TokenBurnConfig = {
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

export const getConfigDir = () => resolveAgentDir(process.env, homedir());

export const getSessionsDir = () => resolveSessionsDir(process.env, homedir());

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
