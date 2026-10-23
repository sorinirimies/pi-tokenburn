/** Terminal paint helpers shared by charts and tables: bars, sparklines, theme colors. */

const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];
export const SPARK = "▁▂▃▄▅▆▇█";

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

export type Paint = (kind: "bar" | "now" | "over" | "axis" | "budget" | "dim" | "title", text: string) => string;

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
