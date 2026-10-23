/** Grouped usage queries: per model, provider, project and session, over a period. */
import { HOUR_MS, loadSelected, turnTokens } from "./aggregate.ts";
import type { UsageOptions } from "./pricing.ts";
import { bucketStart } from "./time.ts";

export const PERIODS = ["hour", "day", "week", "month", "year", "all"] as const;
export type Period = (typeof PERIODS)[number];
/** Words accepted for a period, mapped to it (`today` = day, `total` = all). */
export const PERIOD_ALIASES: Record<string, Period> = {
	hour: "hour",
	day: "day",
	today: "day",
	week: "week",
	month: "month",
	year: "year",
	all: "all",
	total: "all",
};
export const PERIOD_TITLE: Record<Period, string> = {
	hour: "last 60 minutes",
	day: "today",
	week: "this week",
	month: "this month",
	year: "this year",
	all: "all time",
};

/** Start of a period; `hour` is the rolling last 60 minutes, `all` is 0. */
export function periodStart(now: number, p: Period): number {
	if (p === "hour") return now - HOUR_MS;
	if (p === "all") return 0;
	return bucketStart(now, p);
}

export const GROUPS = ["model", "provider", "project", "session"] as const;
export type GroupBy = (typeof GROUPS)[number];

export interface Row {
	key: string;
	provider: string;
	model: string;
	project: string;
	session: string;
	tokens: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	turns: number;
	sessions: number;
	first: number;
	last: number;
	/** What the cached tokens would have cost as plain input, and what they did cost (turns with a known input price). */
	cacheBase: number;
	cacheActual: number;
}

const emptyRow = (key: string): Row => ({
	key, provider: "", model: "", project: "", session: "",
	tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0,
	turns: 0, sessions: 0, first: Infinity, last: 0, cacheBase: 0, cacheActual: 0,
});

/** Share of prompt tokens served from cache, 0..1. */
export function cacheHitRatio(r: { input: number; cacheRead: number; cacheWrite: number }): number {
	const prompt = r.input + r.cacheRead + r.cacheWrite;
	return prompt > 0 ? r.cacheRead / prompt : 0;
}

/** Estimated dollars saved by cache reads versus paying the plain input price for them. */
export const cacheSavings = (r: Row): number => Math.max(0, r.cacheBase - r.cacheActual);

/** Rows for one grouping over a period, biggest cost first (ties: most tokens). */
export async function collectGroups(
	root: string,
	by: GroupBy,
	period: Period,
	now: Date = new Date(),
	includeCache = true,
	opts?: UsageOptions,
): Promise<Row[]> {
	const since = periodStart(now.getTime(), period);
	const rows = new Map<string, Row>();
	for (const turns of await loadSelected(root, opts)) {
		const seen = new Set<string>();
		for (const t of turns) {
			if (t.ts < since) continue;
			const key =
				by === "model" ? `${t.provider}/${t.model}` : by === "provider" ? t.provider : by === "project" ? t.project : t.session;
			let r = rows.get(key);
			if (!r) {
				r = emptyRow(key);
				r.provider = t.provider;
				r.model = t.model;
				r.project = t.project;
				r.session = t.session;
				rows.set(key, r);
			}
			r.tokens += turnTokens(t, includeCache);
			r.input += t.input;
			r.output += t.output;
			r.cacheRead += t.cacheRead;
			r.cacheWrite += t.cacheWrite;
			r.cost += t.cost;
			r.turns++;
			if (t.ts < r.first) r.first = t.ts;
			if (t.ts > r.last) r.last = t.ts;
			if (t.input > 0 && t.costInput > 0) {
				r.cacheBase += (t.cacheRead * t.costInput) / t.input;
				r.cacheActual += t.costCacheRead;
			}
			if (!seen.has(key)) {
				seen.add(key);
				r.sessions++;
			}
			// Mixed groups (e.g. a provider with many models) keep the label only when unambiguous.
			if (by === "provider") r.model = "";
			if (by === "provider" || by === "model") r.project = "";
			if (by !== "session") r.session = "";
		}
	}
	return [...rows.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
}

/** Sum of rows (for a totals line). */
export function sumRows(rows: Row[]): Row {
	const t = emptyRow("total");
	for (const r of rows) {
		t.tokens += r.tokens; t.input += r.input; t.output += r.output;
		t.cacheRead += r.cacheRead; t.cacheWrite += r.cacheWrite; t.cost += r.cost;
		t.turns += r.turns; t.sessions += r.sessions;
		t.cacheBase += r.cacheBase; t.cacheActual += r.cacheActual;
		if (r.first < t.first) t.first = r.first;
		if (r.last > t.last) t.last = r.last;
	}
	return t;
}
