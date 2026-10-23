/** Usage tables (models / providers / projects / sessions) and the current-session summary. */
import { homedir } from "node:os";
import { basename } from "node:path";
import { bar, type Paint } from "../../core/paint.ts";
import { formatCost, formatNum } from "../../core/format.ts";
import { PERIOD_TITLE, cacheHitRatio, cacheSavings, sumRows, type GroupBy, type Period, type Row } from "./query.ts";
import { pad2 } from "../../core/time.ts";

interface Col {
	title: string;
	align: "left" | "right";
	cell: (r: Row, max: Row) => string;
	foot?: (t: Row) => string;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const clip = (s: string, n: number) => (s.length <= n ? s : "…" + s.slice(s.length - n + 1));

/** `~/x/y` for paths under home. */
export function shortPath(p: string, home = homedir()): string {
	return home && p.startsWith(home) ? "~" + p.slice(home.length) : p;
}

export function stamp(ts: number): string {
	const d = new Date(ts);
	return Number.isFinite(ts) ? `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : "-";
}

const tail = (): Col[] => [
	{ title: "tokens", align: "right", cell: (r) => formatNum(r.tokens), foot: (t) => formatNum(t.tokens) },
	{ title: "in", align: "right", cell: (r) => formatNum(r.input), foot: (t) => formatNum(t.input) },
	{ title: "out", align: "right", cell: (r) => formatNum(r.output), foot: (t) => formatNum(t.output) },
	{ title: "cache hit", align: "right", cell: (r) => (r.cacheRead + r.cacheWrite + r.input > 0 ? pct(cacheHitRatio(r)) : "-"), foot: (t) => pct(cacheHitRatio(t)) },
	{ title: "cache saved", align: "right", cell: (r) => (cacheSavings(r) > 0 ? "~" + formatCost(cacheSavings(r)) : "-"), foot: (t) => (cacheSavings(t) > 0 ? "~" + formatCost(cacheSavings(t)) : "-") },
	{ title: "cost", align: "right", cell: (r) => formatCost(r.cost), foot: (t) => formatCost(t.cost) },
	{ title: "share", align: "left", cell: (r, max) => bar(r.cost > 0 ? r.cost : r.tokens, max.cost > 0 ? max.cost : max.tokens, 10) },
];

const COLUMNS: Record<GroupBy, () => Col[]> = {
	model: () => [
		{ title: "model", align: "left", cell: (r) => clip(r.model, 32), foot: () => "total" },
		{ title: "provider", align: "left", cell: (r) => r.provider },
		{ title: "turns", align: "right", cell: (r) => String(r.turns), foot: (t) => String(t.turns) },
		...tail(),
	],
	provider: () => [
		{ title: "provider", align: "left", cell: (r) => r.provider, foot: () => "total" },
		{ title: "turns", align: "right", cell: (r) => String(r.turns), foot: (t) => String(t.turns) },
		...tail(),
	],
	project: () => [
		{ title: "project", align: "left", cell: (r) => clip(shortPath(r.project), 38), foot: () => "total" },
		{ title: "sessions", align: "right", cell: (r) => String(r.sessions), foot: (t) => String(t.sessions) },
		{ title: "turns", align: "right", cell: (r) => String(r.turns), foot: (t) => String(t.turns) },
		...tail(),
	],
	session: () => [
		{ title: "started", align: "left", cell: (r) => stamp(r.first), foot: () => "total" },
		{ title: "project", align: "left", cell: (r) => clip(shortPath(r.project), 28) },
		{ title: "turns", align: "right", cell: (r) => String(r.turns), foot: (t) => String(t.turns) },
		...tail(),
	],
};

const NOUN: Record<GroupBy, string> = { model: "Models", provider: "Providers", project: "Projects", session: "Top sessions" };

/** A bordered table with a totals line. `limit` caps the rows (sessions leaderboard). */
export function renderTable(
	by: GroupBy,
	rows: Row[],
	period: Period,
	opts: { limit?: number; filterText?: string; paint?: Paint } = {},
): string[] {
	const paint = opts.paint ?? ((_k, t) => t);
	const shown = opts.limit ? rows.slice(0, opts.limit) : rows;
	const title = `${NOUN[by]} · ${PERIOD_TITLE[period]}${opts.filterText ? ` · ${opts.filterText}` : ""}`;
	if (rows.length === 0) return [paint("title", title), paint("dim", "no usage in this period")];

	const cols = COLUMNS[by]();
	const total = sumRows(rows);
	const max = shown.reduce((m, r) => (r.cost > m.cost || (m.cost === 0 && r.tokens > m.tokens) ? r : m), shown[0]);
	const body = shown.map((r) => cols.map((c) => c.cell(r, max)));
	const foot = cols.map((c) => c.foot?.(total) ?? "");
	const widths = cols.map((c, i) => Math.max(c.title.length, foot[i].length, ...body.map((b) => b[i].length)));
	const fmt = (cells: string[]) =>
		cells.map((v, i) => (cols[i].align === "right" ? v.padStart(widths[i]) : v.padEnd(widths[i]))).join("  ");
	const rule = "─".repeat(widths.reduce((a, w) => a + w, 0) + 2 * (cols.length - 1));

	const lines = [paint("title", title), paint("axis", rule), paint("dim", fmt(cols.map((c) => c.title))), paint("axis", rule), ...body.map(fmt)];
	if (shown.length < rows.length) lines.push(paint("dim", `… ${rows.length - shown.length} more (total row covers all ${rows.length})`));
	lines.push(paint("axis", rule), fmt(foot));
	return lines;
}

/** Spend of one session file (the current one), against the period totals. */
export function sessionSummary(file: string, row: Row | undefined, todayCost: number): string {
	if (!row) return `This session (${basename(file)}): no usage yet`;
	const share = todayCost > 0 ? `, ${pct(row.cost / todayCost)} of today` : "";
	return `This session: ${formatNum(row.tokens)} tokens · ${formatCost(row.cost)} · ${row.turns} turns · cache hit ${pct(cacheHitRatio(row))}${share}`;
}
