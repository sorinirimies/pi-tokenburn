/** Terminal chart rendering. */
import { isOverBudget } from "./config.ts";
import { formatCost, formatNum } from "./format.ts";
import { bucketLabel, pad2, type Unit } from "./time.ts";
import type { SeriesPoint } from "./aggregate.ts";
import type { PeriodStats } from "./types.ts";

const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];
const SPARK = "▁▂▃▄▅▆▇█";

/** Horizontal bar of `value/max` over `width` cells, with 1/8-cell precision. */
export function bar(value: number, max: number, width: number): string {
	if (!(max > 0) || !(value > 0) || !(width > 0)) return "";
	// Capped at the full width: a value above `max` (or Infinity) must not build a giant string.
	const eighths = Math.min(Math.floor(width) * 8, Math.max(1, Math.round((value / max) * width * 8)));
	const full = Math.floor(eighths / 8);
	return "█".repeat(full) + EIGHTHS[eighths % 8];
}

export function sparkline(values: number[]): string {
	const max = Math.max(...values, 0);
	if (max <= 0) return SPARK[0].repeat(values.length);
	return values.map((v) => SPARK[Math.min(7, Math.round((v / max) * 7))]).join("");
}

const UNIT_TITLE: Record<Unit, string> = { day: "Daily", week: "Weekly", month: "Monthly", year: "Yearly" };
const UNIT_NOUN: Record<Unit, string> = { day: "day", week: "week", month: "month", year: "year" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type Paint = (kind: "bar" | "now" | "over" | "axis" | "budget" | "dim" | "title", text: string) => string;
const plain: Paint = (_k, t) => t;

/** Two header rows for a column: [top, bottom]. */
function columnLabels(p: SeriesPoint, unit: Unit): [string, string] {
	const d = new Date(p.start);
	// `?? ""`: an invalid date (NaN) has no weekday or month name.
	if (unit === "day") return [pad2(d.getDate()), ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][d.getDay()] ?? ""];
	if (unit === "week") return [`${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`, "wk"];
	if (unit === "year") return [String(d.getFullYear()), ""];
	return [MONTHS[d.getMonth()] ?? "", String(d.getFullYear())];
}

/**
 * Vertical column chart: y-axis, 1/8-row precision, optional budget line,
 * highlighted current bucket and over-budget columns, summary footer.
 */
export function renderChart(
	series: SeriesPoint[],
	unit: Unit,
	opts: { height?: number; budget?: { tokens?: number; cost?: number }; paint?: Paint; title?: string } = {},
): string[] {
	const paint = opts.paint ?? plain;
	const height = opts.height ?? 8;
	const colW = unit === "day" ? 3 : 6; // bar cells + 1 gap
	const barW = colW - 1;

	const peakPoint = series.reduce((m, p) => (p.tokens > m.tokens ? p : m), series[0]);
	const dataMax = peakPoint?.tokens ?? 0;
	const budgetTokens = opts.budget?.tokens;
	const scaleMax = Math.max(dataMax, budgetTokens ?? 0);
	const total = series.reduce((a, p) => a + p.tokens, 0);
	const totalCost = series.reduce((a, p) => a + p.cost, 0);

	const yLabels = [formatNum(scaleMax), formatNum(scaleMax / 2), "0"];
	const yW = Math.max(...yLabels.map((l) => l.length)) + 1;
	const labelFor = (row: number) => (row === height ? yLabels[0] : row === Math.ceil(height / 2) ? yLabels[1] : "");
	const budgetRow = budgetTokens && scaleMax > 0 ? Math.max(1, Math.ceil((budgetTokens / scaleMax) * height)) : 0;

	const isOver = (p: SeriesPoint) =>
		opts.budget ? isOverBudget({ tokens: p.tokens, cost: p.cost } as PeriodStats, opts.budget) : false;
	const kindOf = (i: number): "bar" | "now" | "over" =>
		isOver(series[i]) ? "over" : i === series.length - 1 ? "now" : "bar";

	const lines: string[] = [];
	lines.push(
		paint("title", opts.title ?? `${UNIT_TITLE[unit]} tokens`) +
			paint("dim", ` · ${opts.title ? "" : "last "}${series.length} ${UNIT_NOUN[unit]}${series.length === 1 ? "" : "s"}`) +
			(budgetTokens ? paint("budget", `  ┄ budget ${formatNum(budgetTokens)}`) : ""),
	);

	for (let row = height; row >= 1; row--) {
		let line = paint("axis", `${labelFor(row).padStart(yW)} │`);
		for (let i = 0; i < series.length; i++) {
			const h = scaleMax > 0 ? (series[i].tokens / scaleMax) * height : 0;
			let cell: string;
			if (h >= row) cell = "█";
			else if (h > row - 1 && series[i].tokens > 0) cell = SPARK[Math.min(7, Math.max(0, Math.floor((h - (row - 1)) * 8) - 1))];
			else if (row === 1 && series[i].tokens > 0) cell = "▁";
			else cell = row === budgetRow ? "┄" : " ";
			const filled = cell !== " " && cell !== "┄";
			const body = cell.repeat(barW);
			line += filled ? paint(kindOf(i), body) : cell === "┄" ? paint("budget", body) : body;
			line += row === budgetRow ? paint("budget", "┄") : " ";
		}
		lines.push(line);
	}

	lines.push(paint("axis", `${"".padStart(yW)} └${"─".repeat(series.length * colW)}`));
	const pad = " ".repeat(yW + 2);
	const cols = series.map((p, i) => ({ l: columnLabels(p, unit), now: i === series.length - 1 }));
	lines.push(pad + cols.map((c) => c.l[0].padEnd(colW)).join(""));
	lines.push(paint("dim", pad + cols.map((c) => c.l[1].padEnd(colW)).join("")));
	lines.push(pad + cols.map((c) => (c.now ? paint("now", "▲".padEnd(colW)) : " ".repeat(colW))).join(""));

	const avg = series.length ? total / series.length : 0;
	lines.push(
		paint(
			"dim",
			`Σ ${formatNum(total)} (${formatCost(totalCost)}) · avg ${formatNum(avg)}/${UNIT_NOUN[unit]}` +
				(dataMax > 0 ? ` · peak ${formatNum(dataMax)} (${bucketLabel(peakPoint.start, unit)})` : ""),
		),
	);
	return lines;
}



/** Map chart roles to pi theme colors. */
export function themePaint(theme: { fg: (c: any, t: string) => string }): Paint {
	const color: Record<string, string> = {
		bar: "accent",
		now: "success",
		over: "error",
		axis: "dim",
		budget: "warning",
		dim: "dim",
		title: "accent",
	};
	return (kind, text) => theme.fg(color[kind], text);
}
