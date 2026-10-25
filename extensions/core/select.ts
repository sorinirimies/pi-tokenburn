/**
 * Usage filter + price table. Costs normally come straight from the session logs (pi computes
 * them from its own model prices). The price table lets you fill in models pi had no price for
 * (`fill`) or correct stale prices (`override`).
 */
import type { Turn } from "./parser.ts";

export interface UsageFilter {
	provider?: string;
	model?: string;
	project?: string;
}

/** $ per million tokens. */
export interface Price {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}
export type PriceTable = Record<string, Price>;
export type PriceMode = "fill" | "override";

/** Options every collector accepts. */
export interface UsageOptions {
	filter?: UsageFilter;
	prices?: PriceTable;
	priceMode?: PriceMode;
}

const FILTER_KEYS = ["provider", "model", "project"] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];
export const FILTER_KEYS_LIST: readonly FilterKey[] = FILTER_KEYS;

/** Keep only known keys holding non-empty strings (the file is hand-editable). */
export function sanitizeFilter(value: unknown): UsageFilter {
	const out: UsageFilter = {};
	if (typeof value !== "object" || value === null || Array.isArray(value)) return out;
	for (const k of FILTER_KEYS) {
		const v = (value as Record<string, unknown>)[k];
		if (typeof v === "string" && v.trim() !== "") out[k] = v.trim();
	}
	return out;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);

/** Keep only entries with a finite, non-negative input and output price. */
export function sanitizePrices(value: unknown): PriceTable {
	const out: PriceTable = {};
	if (typeof value !== "object" || value === null || Array.isArray(value)) return out;
	for (const [name, p] of Object.entries(value as Record<string, unknown>)) {
		if (typeof p !== "object" || p === null) continue;
		const r = p as Record<string, unknown>;
		const input = num(r.input);
		const output = num(r.output);
		if (input === undefined || output === undefined) continue;
		out[name] = { input, output, cacheRead: num(r.cacheRead) ?? input, cacheWrite: num(r.cacheWrite) ?? input };
	}
	return out;
}

export const hasFilter = (f: UsageFilter | undefined) => !!f && (!!f.provider || !!f.model || !!f.project);

/** Human text for an active filter, e.g. `provider=anthropic model=opus`. */
export function describeFilter(f: UsageFilter | undefined): string {
	return FILTER_KEYS.filter((k) => f?.[k]).map((k) => `${k}=${f![k]}`).join(" ");
}

export function matchesFilter(t: Turn, f: UsageFilter | undefined): boolean {
	if (!f) return true;
	const has = (hay: string, needle: string | undefined) => !needle || hay.toLowerCase().includes(needle.toLowerCase());
	return has(t.provider, f.provider) && has(t.model, f.model) && has(t.project, f.project);
}

export function priceFor(t: Turn, prices: PriceTable): Price | undefined {
	return prices[`${t.provider}/${t.model}`] ?? prices[t.model];
}

export type CostSource = "log" | "table";

/** The turn with the price table applied (same object when it does not apply). */
export function applyPricing(t: Turn, prices: PriceTable | undefined, mode: PriceMode = "fill"): { turn: Turn; source: CostSource } {
	if (!prices) return { turn: t, source: "log" };
	const p = priceFor(t, prices);
	if (!p || (mode === "fill" && t.cost > 0)) return { turn: t, source: "log" };
	const costInput = (t.input * p.input) / 1e6;
	const costCacheRead = (t.cacheRead * p.cacheRead) / 1e6;
	const cost = costInput + costCacheRead + (t.output * p.output) / 1e6 + (t.cacheWrite * p.cacheWrite) / 1e6;
	return { turn: { ...t, cost, costInput, costCacheRead }, source: "table" };
}

/** Filter then price every turn. Returns the input array untouched when there is nothing to do. */
export function selectTurns(turns: Turn[], opts: UsageOptions | undefined): Turn[] {
	if (!opts) return turns;
	const filter = hasFilter(opts.filter) ? opts.filter : undefined;
	const prices = opts.prices && Object.keys(opts.prices).length > 0 ? opts.prices : undefined;
	if (!filter && !prices) return turns;
	const out: Turn[] = [];
	for (const t of turns) {
		if (!matchesFilter(t, filter)) continue;
		out.push(prices ? applyPricing(t, prices, opts.priceMode).turn : t);
	}
	return out;
}

/**
 * What the turn's cached tokens would have cost as plain input (`base`) and what they did cost
 * (`actual`). Both 0 when the log has no input price for the turn (then no savings are claimed).
 */
export function cacheValue(t: Turn): { base: number; actual: number } {
	if (!(t.input > 0 && t.costInput > 0)) return { base: 0, actual: 0 };
	return { base: (t.cacheRead * t.costInput) / t.input, actual: t.costCacheRead };
}
