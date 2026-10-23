/** Burn rate, budget projection and threshold warnings (pure). */
import { budgetsFor, type TokenBurnConfig } from "./config.ts";
import { formatCost, formatNum } from "./format.ts";
import { bucketStart, type Unit } from "./time.ts";
import type { PeriodStats, TokenBurnReport, Window } from "./types.ts";

export interface Rate {
	tokensPerHour: number;
	costPerHour: number;
}

/** Burn rate from the rolling last-60-minutes stats. */
export const burnRate = (hour: PeriodStats): Rate => ({ tokensPerHour: hour.tokens, costPerHour: hour.cost });

/** Start of the bucket after the one starting at `start`. */
export function nextBucket(start: number, unit: Exclude<Unit, "year">): number {
	const d = new Date(start);
	if (unit === "day") return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
	if (unit === "week") return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime();
	return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
}

export interface Projection {
	/** used / budget, 0..n */
	ratio: number;
	/** When the budget runs out at the pace so far, if that is before the period ends. */
	exhaustAt?: number;
	/** Projected usage at the end of the period. */
	projected: number;
}

/** Linear projection: pace = used / elapsed. Undefined when nothing has been used yet. */
export function project(used: number, budget: number, start: number, end: number, now: number): Projection | undefined {
	const elapsed = now - start;
	if (!(used > 0) || !(elapsed > 0) || !(budget > 0)) return undefined;
	const pace = used / elapsed;
	const proj: Projection = { ratio: used / budget, projected: pace * (end - start) };
	if (used < budget) {
		const at = now + (budget - used) / pace;
		if (at < end) proj.exhaustAt = at;
	}
	return proj;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");

/** `today 14:05`, `tomorrow 09:00`, or `Thu 14:05`. */
export function formatWhen(ts: number, now: number): string {
	const d = new Date(ts);
	const days = Math.round((bucketStart(ts, "day") - bucketStart(now, "day")) / 86_400_000);
	const day = days === 0 ? "today" : days === 1 ? "tomorrow" : DAYS[d.getDay()];
	return `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const BUDGET_WINDOWS: { w: Window; unit: Exclude<Unit, "year">; name: string }[] = [
	{ w: "today", unit: "day", name: "daily" },
	{ w: "week", unit: "week", name: "weekly" },
	{ w: "month", unit: "month", name: "monthly" },
];

/** Projection lines for each configured budget, e.g. "at this pace the weekly token budget runs out Thu 14:05". */
export function forecastLines(report: TokenBurnReport, cfg: TokenBurnConfig, now: number): string[] {
	const lines: string[] = [];
	for (const { w, unit, name } of BUDGET_WINDOWS) {
		const b = budgetsFor(cfg, w);
		const start = bucketStart(now, unit);
		const end = nextBucket(start, unit);
		const stat = report[w];
		for (const kind of ["tokens", "cost"] as const) {
			const budget = b[kind];
			if (budget === undefined) continue;
			const fmt = kind === "tokens" ? (n: number) => `${formatNum(n)} tokens` : formatCost;
			const p = project(stat[kind], budget, start, end, now);
			if (!p) continue;
			const used = `${Math.round(p.ratio * 100)}% of ${fmt(budget)} used`;
			if (p.ratio >= 1) lines.push(`${name} ${kind} budget: ${used} (over)`);
			else if (p.exhaustAt !== undefined) lines.push(`${name} ${kind} budget: ${used}; at this pace it runs out ${formatWhen(p.exhaustAt, now)}`);
			else lines.push(`${name} ${kind} budget: ${used}; on track (${fmt(p.projected)} projected)`);
		}
	}
	return lines;
}

export interface Warning {
	/** Stable id: one notification per id (budget + period bucket + level). */
	id: string;
	level: "warn" | "over";
	message: string;
}

/** Budgets at or above `warnPct` percent (and those over 100%), each with a once-per-bucket id. */
export function budgetWarnings(report: TokenBurnReport, cfg: TokenBurnConfig, now: number): Warning[] {
	const out: Warning[] = [];
	if (cfg.warnPct <= 0) return out;
	for (const { w, unit, name } of BUDGET_WINDOWS) {
		const b = budgetsFor(cfg, w);
		const bucket = bucketStart(now, unit);
		for (const kind of ["tokens", "cost"] as const) {
			const budget = b[kind];
			if (budget === undefined) continue;
			const ratio = report[w][kind] / budget;
			const fmt = kind === "tokens" ? (n: number) => `${formatNum(n)} tokens` : formatCost;
			const text = `${Math.round(ratio * 100)}% of the ${name} ${kind} budget (${fmt(report[w][kind])} / ${fmt(budget)})`;
			if (ratio > 1) out.push({ id: `${w}:${kind}:${bucket}:over`, level: "over", message: `tokenburn: over budget, ${text}` });
			else if (ratio * 100 >= cfg.warnPct) out.push({ id: `${w}:${kind}:${bucket}:warn`, level: "warn", message: `tokenburn: ${text}` });
		}
	}
	return out;
}
