/** Status line: window start, burn rate / cache hit / savings extras for the status window (pure). */
import type { TokenBurnConfig } from "../../core/config.ts";
import { formatCost, formatNum } from "../../core/format.ts";
import { bucketStart } from "../../core/time.ts";
import type { PeriodStats, Rate, TokenBurnReport, Window } from "../../core/types.ts";
import { cacheHitRatio } from "../breakdown/query.ts";

const HOUR = 3_600_000;

/** Start of a status window (`hour` = rolling last 60 minutes, `total` = 0). */
export function windowStart(w: Window, now: number): number {
	if (w === "hour") return now - HOUR;
	if (w === "total") return 0;
	return bucketStart(now, w === "today" ? "day" : w);
}

/** Tokens/hour and $/hour averaged over the window (counted from the first turn when the window started earlier; at least one hour). */
export function windowRate(stat: PeriodStats, w: Window, firstTs: number | undefined, now: number): Rate {
	const from = Math.max(windowStart(w, now), firstTs ?? now);
	const hours = Math.max((now - from) / HOUR, 1);
	return { tokensPerHour: stat.tokens / hours, costPerHour: stat.cost / hours };
}

/** Estimated dollars saved by cache reads in a window. */
export const statSavings = (s: PeriodStats): number => Math.max(0, s.cacheBase - s.cacheActual);

/** Status-line extras for the window, in order: burn rate, cache hit ratio, cache savings (each only when enabled and meaningful). */
export function statusExtras(report: TokenBurnReport, cfg: TokenBurnConfig, now: number): string[] {
	const stat = report[cfg.statusWindow];
	const out: string[] = [];
	if (cfg.showRate && stat.tokens > 0) out.push(`${formatNum(windowRate(stat, cfg.statusWindow, report.firstTs, now).tokensPerHour)}/h`);
	if (cfg.showHit && stat.input + stat.cacheRead + stat.cacheWrite > 0) out.push(`${Math.round(cacheHitRatio(stat) * 100)}% hit`);
	if (cfg.showSaved && statSavings(stat) >= 0.005) out.push(`~${formatCost(statSavings(stat))} saved`);
	return out;
}
