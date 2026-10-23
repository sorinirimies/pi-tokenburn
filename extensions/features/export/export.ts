/** Export usage as CSV or JSON: one row per day x provider x model x project. */
import { loadSelected } from "../../core/aggregate.ts";
import type { UsageOptions } from "../../core/select.ts";
import { periodStart, type Period } from "../breakdown/query.ts";
import { bucketStart, pad2 } from "../../core/time.ts";

export interface ExportRow {
	date: string;
	provider: string;
	model: string;
	project: string;
	turns: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

export const EXPORT_FORMATS = ["csv", "json"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

const day = (ts: number) => {
	const d = new Date(bucketStart(ts, "day"));
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

export async function collectExport(root: string, period: Period, now: Date = new Date(), opts?: UsageOptions): Promise<ExportRow[]> {
	const since = periodStart(now.getTime(), period);
	const rows = new Map<string, ExportRow>();
	for (const turns of await loadSelected(root, opts)) {
		for (const t of turns) {
			if (t.ts < since) continue;
			const date = day(t.ts);
			const key = `${date}\u0000${t.provider}\u0000${t.model}\u0000${t.project}`;
			let r = rows.get(key);
			if (!r) rows.set(key, (r = { date, provider: t.provider, model: t.model, project: t.project, turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }));
			r.turns++;
			r.input += t.input;
			r.output += t.output;
			r.cacheRead += t.cacheRead;
			r.cacheWrite += t.cacheWrite;
			r.cost += t.cost;
		}
	}
	return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date) || b.cost - a.cost);
}

const FIELDS: (keyof ExportRow)[] = ["date", "provider", "model", "project", "turns", "input", "output", "cacheRead", "cacheWrite", "cost"];

/** RFC 4180 quoting; also neutralises spreadsheet formula injection (=, +, -, @ at the start). */
export function csvCell(v: string | number): string {
	let s = typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(6)) : v;
	if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
	return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function formatExport(rows: ExportRow[], format: ExportFormat): string {
	if (format === "json") return JSON.stringify(rows, null, 2) + "\n";
	return [FIELDS.join(","), ...rows.map((r) => FIELDS.map((f) => csvCell(r[f])).join(","))].join("\n") + "\n";
}
