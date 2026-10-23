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
	/** What cache reads would have cost as plain input vs what they cost (turns with a known input price). */
	cacheBase: number;
	cacheActual: number;
}

export interface TokenBurnReport {
	/** Rolling last 60 minutes (burn rate). */
	hour: PeriodStats;
	today: PeriodStats;
	week: PeriodStats;
	month: PeriodStats;
	year: PeriodStats;
	total: PeriodStats;
	/** Timestamp of the earliest turn counted (undefined when there is none). */
	firstTs?: number;
}

export const STATUS_WINDOWS = ["hour", "today", "week", "month", "year", "total"] as const;
export type Window = (typeof STATUS_WINDOWS)[number];

export interface Rate {
	tokensPerHour: number;
	costPerHour: number;
}
