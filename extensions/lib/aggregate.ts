/** Aggregation of parsed turns into period totals and time series. */
import { loadAll, type Turn } from "./parser.ts";
import { bucketLabel, bucketStart, type Unit } from "./time.ts";
import type { PeriodStats, TokenBurnReport } from "./types.ts";

const emptyStats = (): PeriodStats => ({
	tokens: 0,
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	cost: 0,
	sessions: 0,
});

export const turnTokens = (t: Turn, includeCache: boolean) =>
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
