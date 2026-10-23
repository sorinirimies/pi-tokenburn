/** Shared types. */

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
	/** Rolling last 60 minutes (burn rate). */
	hour: PeriodStats;
	today: PeriodStats;
	week: PeriodStats;
	month: PeriodStats;
	year: PeriodStats;
	total: PeriodStats;
}

export const STATUS_WINDOWS = ["today", "week", "month", "year", "total"] as const;
export type Window = (typeof STATUS_WINDOWS)[number];
