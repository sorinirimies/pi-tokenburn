/** The text of the `/tokenburn` summary report (pure). */
import type { TokenBurnConfig } from "../../core/config.ts";
import { formatCost, formatNum } from "../../core/format.ts";
import type { PeriodStats, TokenBurnReport } from "../../core/types.ts";
import { burnRate, forecastLines } from "../budgets/budgets.ts";
import { cacheHitRatio, cacheSavings, type Row } from "../breakdown/query.ts";

const row = (name: string, p: PeriodStats) =>
	`${name.padEnd(10)} ${formatNum(p.tokens).padStart(8)} tokens ${formatCost(p.cost).padStart(9)} · in:${formatNum(p.input)} out:${formatNum(p.output)} cache:${formatNum(p.cacheRead + p.cacheWrite)} · ${p.sessions} sess`;

const FOOTER = "models · providers · projects · sessions · session · filter · export · pricing · chart <view> · <view> sets the status bar · cycle · window · budget · cache · live · on|off";

export function renderReport(input: {
	report: TokenBurnReport;
	chart: string[];
	/** All-time totals over every model (cache efficiency). */
	models: Row;
	config: TokenBurnConfig;
	now: number;
	filterText: string;
}): string[] {
	const { report, chart, models, config, now, filterText } = input;
	const rule = "─".repeat(60);
	const rate = burnRate(report.hour);
	const extra = [
		`burn rate: ${formatNum(rate.tokensPerHour)} tokens/h · ${formatCost(rate.costPerHour)}/h (last 60 min)`,
		...(models.cacheRead + models.cacheWrite > 0
			? [`cache: ${Math.round(cacheHitRatio(models) * 100)}% of prompt tokens read from cache${cacheSavings(models) > 0 ? ` · saved ~${formatCost(cacheSavings(models))}` : ""}`]
			: []),
		...forecastLines(report, config, now),
	];
	return [
		`🔥 TokenBurn Report${filterText ? ` · ${filterText}` : ""}`,
		rule,
		row("Today", report.today),
		row("This Week", report.week),
		row("This Month", report.month),
		row("This Year", report.year),
		row("All Time", report.total),
		rule,
		...chart,
		rule,
		...extra,
		rule,
		FOOTER,
	];
}
