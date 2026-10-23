/** What the status line and the optional panel look like. */
import { budgetsFor, isOverBudget, type TokenBurnConfig } from "../../core/config.ts";
import { formatCost, formatNum } from "../../core/format.ts";
import { describeFilter } from "../../core/select.ts";
import type { PeriodStats, TokenBurnReport } from "../../core/types.ts";
import { statusExtras } from "./status.ts";

type Theme = { fg: (color: any, text: string) => string };

/** `🔥 1.2M ($5.10) [today] · 52k/h · 95% hit · ~$12.40 saved` (red `OVER BUDGET` past a budget). */
export function renderStatusLine(report: TokenBurnReport, config: TokenBurnConfig, theme: Theme, now: number): string {
	const stat = report[config.statusWindow];
	const isOver = isOverBudget(stat, budgetsFor(config, config.statusWindow));
	const fire = isOver ? theme.fg("error", "🔥 OVER BUDGET") : theme.fg("warning", "🔥");
	const tokensText = theme.fg(isOver ? "error" : "accent", formatNum(stat.tokens));
	const costText = theme.fg("dim", `(${formatCost(stat.cost)})`);
	const filterText = describeFilter(config.filter);
	const label = theme.fg("dim", `[${config.statusWindow}${filterText ? ` · ${filterText}` : ""}]`);
	const extras = statusExtras(report, config, now);
	const tail = extras.length > 0 ? theme.fg("dim", ` · ${extras.join(" · ")}`) : "";
	return `${fire} ${tokensText} ${costText} ${label}${tail}`;
}

/** The Today / Week / Month / Year / Total panel below the editor. */
export function renderWidget(report: TokenBurnReport, config: TokenBurnConfig, theme: Theme): string[] {
	const header = theme.fg("accent", " 🔥 TokenBurn Dashboard ");
	const line = (label: string, p: PeriodStats, b: { tokens?: number; cost?: number } = {}) => {
		const over = isOverBudget(p, b);
		const tokStr = (over ? theme.fg("error", "!") : " ") + formatNum(p.tokens).padStart(8);
		const inStr = `(in:${formatNum(p.input)} out:${formatNum(p.output)})`.padEnd(20);
		const costStr = formatCost(p.cost).padStart(8);
		return `  ${theme.fg("muted", label.padEnd(8))} ${tokStr}  ${theme.fg("dim", inStr)} ${costStr}`;
	};
	return [
		`┌${header}${"─".repeat(21)}┐`,
		line("Today", report.today, budgetsFor(config, "today")),
		line("Week", report.week, budgetsFor(config, "week")),
		line("Month", report.month, budgetsFor(config, "month")),
		line("Year", report.year),
		line("Total", report.total),
		`└${"─".repeat(46)}┘`,
	];
}
