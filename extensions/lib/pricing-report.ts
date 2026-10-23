/** Where costs come from: the session logs or the configured price table. */
import { loadAll } from "./parser.ts";
import { applyPricing, matchesFilter, type PriceMode, type PriceTable, type UsageFilter } from "./pricing.ts";
import { formatCost, formatNum } from "./format.ts";

export interface PricingReport {
	logCost: number;
	logTurns: number;
	tableCost: number;
	tableTurns: number;
	/** Models with token usage but no cost and no price entry: their cost is counted as $0. */
	unpriced: { model: string; tokens: number; turns: number }[];
}

export async function collectPricing(root: string, prices: PriceTable, mode: PriceMode, filter?: UsageFilter): Promise<PricingReport> {
	const rep: PricingReport = { logCost: 0, logTurns: 0, tableCost: 0, tableTurns: 0, unpriced: [] };
	const un = new Map<string, { model: string; tokens: number; turns: number }>();
	for (const turns of await loadAll(root)) {
		for (const raw of turns) {
			if (!matchesFilter(raw, filter)) continue;
			const { turn, source } = applyPricing(raw, prices, mode);
			if (source === "table") {
				rep.tableCost += turn.cost;
				rep.tableTurns++;
				continue;
			}
			rep.logCost += turn.cost;
			rep.logTurns++;
			const tokens = turn.input + turn.output + turn.cacheRead + turn.cacheWrite;
			if (turn.cost === 0 && tokens > 0) {
				const key = `${turn.provider}/${turn.model}`;
				const u = un.get(key) ?? { model: key, tokens: 0, turns: 0 };
				u.tokens += tokens;
				u.turns++;
				un.set(key, u);
			}
		}
	}
	rep.unpriced = [...un.values()].sort((a, b) => b.tokens - a.tokens);
	return rep;
}

export function renderPricing(rep: PricingReport, prices: PriceTable, mode: PriceMode): string[] {
	const entries = Object.entries(prices);
	const lines = [
		`Pricing · mode ${mode} (${mode === "fill" ? "price table only fills turns the log has no cost for" : "price table overrides the log cost"})`,
		`cost from session logs: ${formatCost(rep.logCost)} (${rep.logTurns} turns)`,
		`cost from price table:  ${formatCost(rep.tableCost)} (${rep.tableTurns} turns)`,
	];
	if (entries.length > 0) {
		lines.push("price table ($ per million tokens: in / out / cache read / cache write):");
		for (const [name, p] of entries) lines.push(`  ${name}: ${p.input} / ${p.output} / ${p.cacheRead} / ${p.cacheWrite}`);
	} else lines.push("price table: empty. /tokenburn price <model> <in> <out> [cacheRead] [cacheWrite]");
	if (rep.unpriced.length > 0) {
		lines.push("unpriced (tokens but $0, counted as free; add a price):");
		for (const u of rep.unpriced.slice(0, 8)) lines.push(`  ${u.model}: ${formatNum(u.tokens)} tokens in ${u.turns} turns`);
	}
	return lines;
}
