import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	bar,
	bucketLabel,
	bucketStart,
	clearCache,
	collectSeries,
	renderChart,
	sparkline,
} from "../extensions/tokenburn.ts";

describe("buckets", () => {
	it("starts a day at local midnight", () => {
		const ts = new Date(2026, 9, 9, 15, 30).getTime();
		expect(bucketStart(ts, "day")).toBe(new Date(2026, 9, 9).getTime());
	});

	it("starts a week on Monday", () => {
		// Fri 2026-10-09 → Mon 2026-10-05; Sun 2026-10-11 → still Mon 10-05
		expect(bucketStart(new Date(2026, 9, 9).getTime(), "week")).toBe(new Date(2026, 9, 5).getTime());
		expect(bucketStart(new Date(2026, 9, 11, 23).getTime(), "week")).toBe(new Date(2026, 9, 5).getTime());
		expect(bucketStart(new Date(2026, 9, 12).getTime(), "week")).toBe(new Date(2026, 9, 12).getTime());
	});

	it("starts a month on the 1st", () => {
		expect(bucketStart(new Date(2026, 9, 31, 23).getTime(), "month")).toBe(new Date(2026, 9, 1).getTime());
	});

	it("labels buckets", () => {
		expect(bucketLabel(new Date(2026, 9, 9).getTime(), "day")).toBe("10-09 Fri");
		expect(bucketLabel(new Date(2026, 9, 5).getTime(), "week")).toBe("10-05 wk");
		expect(bucketLabel(new Date(2026, 9, 1).getTime(), "month")).toBe("2026-10");
	});
});

describe("bar / sparkline", () => {
	it("scales bars with 1/8 precision", () => {
		expect(bar(100, 100, 10)).toBe("██████████");
		expect(bar(50, 100, 10)).toBe("█████");
		expect(bar(55, 100, 10)).toBe("█████▌");
	});

	it("shows at least a sliver for tiny non-zero values and nothing for zero", () => {
		expect(bar(1, 1_000_000, 10)).toBe("▏");
		expect(bar(0, 100, 10)).toBe("");
		expect(bar(5, 0, 10)).toBe("");
	});

	it("builds a sparkline", () => {
		expect(sparkline([0, 7, 14])).toBe("▁▅█");
		expect(sparkline([0, 0])).toBe("▁▁");
	});
});

describe("collectSeries / renderChart", () => {
	let dir: string;
	beforeEach(() => {
		clearCache();
		dir = mkdtempSync(join(tmpdir(), "pi-tb-chart-"));
		mkdirSync(join(dir, "p"), { recursive: true });
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	const line = (d: Date, input: number, cost = 0) =>
		JSON.stringify({ timestamp: d.toISOString(), message: { usage: { input, output: 0, cost: { total: cost } } } });

	it("zero-fills days and orders oldest first", async () => {
		const now = new Date(2026, 9, 9, 12);
		writeFileSync(
			join(dir, "p", "s.jsonl"),
			[line(new Date(2026, 9, 9, 9), 100, 1), line(new Date(2026, 9, 7, 9), 40, 0.5), line(new Date(2026, 9, 7, 10), 10)].join("\n") + "\n",
		);
		const s = await collectSeries(dir, "day", 5, now);
		expect(s.map((p) => p.label)).toEqual(["10-05 Mon", "10-06 Tue", "10-07 Wed", "10-08 Thu", "10-09 Fri"]);
		expect(s.map((p) => p.tokens)).toEqual([0, 0, 50, 0, 100]);
		expect(s[4].cost).toBeCloseTo(1);
	});

	it("groups by week and month, ignoring out-of-range data", async () => {
		const now = new Date(2026, 9, 9, 12);
		writeFileSync(
			join(dir, "p", "s.jsonl"),
			[line(new Date(2026, 9, 9), 10), line(new Date(2026, 9, 5), 20), line(new Date(2026, 8, 30), 5), line(new Date(2020, 0, 1), 999)].join("\n") + "\n",
		);
		const weeks = await collectSeries(dir, "week", 3, now);
		expect(weeks.map((p) => p.tokens)).toEqual([0, 5, 30]); // 09-21, 09-28 (has 09-30), 10-05
		const months = await collectSeries(dir, "month", 2, now);
		expect(months.map((p) => p.label)).toEqual(["2026-09", "2026-10"]);
		expect(months.map((p) => p.tokens)).toEqual([5, 30]);
	});

	it("renders a vertical chart with axis, labels, now-marker and summary", async () => {
		const now = new Date(2026, 9, 9, 12);
		writeFileSync(join(dir, "p", "s.jsonl"), line(new Date(2026, 9, 8), 5000) + "\n" + line(new Date(2026, 9, 9), 100) + "\n");
		const s = await collectSeries(dir, "day", 3, now);
		const out = renderChart(s, "day", { height: 4 });
		expect(out[0]).toContain("Daily tokens · last 3 days");
		expect(out[1]).toContain("5.0k │"); // y max
		expect(out[1]).toContain("██"); // 10-08 reaches the top
		expect(out.some((l) => l.includes("└"))).toBe(true);
		expect(out.some((l) => l.includes("07") && l.includes("08") && l.includes("09"))).toBe(true);
		expect(out.some((l) => l.includes("We") && l.includes("Th") && l.includes("Fr"))).toBe(true);
		expect(out.some((l) => l.includes("▲"))).toBe(true);
		expect(out.at(-1)).toContain("peak 5.0k (10-08 Thu)");
		expect(out.at(-1)).toContain("avg 1.7k/day");
		// bar heights: 10-08 full, 10-09 tiny, 10-07 empty
		const bottom = out[4]; // row 1
		expect(bottom).toContain("██");
	});

	it("draws a budget line and marks over-budget columns", async () => {
		const now = new Date(2026, 9, 9, 12);
		writeFileSync(join(dir, "p", "s.jsonl"), line(new Date(2026, 9, 8), 5000) + "\n" + line(new Date(2026, 9, 9), 100) + "\n");
		const s = await collectSeries(dir, "day", 3, now);
		const kinds: string[] = [];
		const paint = (k: string, t: string) => (kinds.push(k), t);
		const out = renderChart(s, "day", { height: 4, budget: { tokens: 2500 }, paint: paint as any });
		expect(out[0]).toContain("┄ budget 2.5k");
		expect(out.some((l) => l.includes("┄┄"))).toBe(true);
		expect(kinds).toContain("over"); // 10-08 > 2500
		expect(kinds).toContain("now"); // today, within budget
	});

	it("uses wider columns and date labels for weeks and months", async () => {
		const now = new Date(2026, 9, 9, 12);
		writeFileSync(join(dir, "p", "s.jsonl"), line(new Date(2026, 9, 9), 10) + "\n");
		const weeks = renderChart(await collectSeries(dir, "week", 2, now), "week", { height: 3 });
		expect(weeks.some((l) => l.includes("09-28") && l.includes("10-05"))).toBe(true);
		const months = renderChart(await collectSeries(dir, "month", 2, now), "month", { height: 3 });
		expect(months.some((l) => l.includes("Sep") && l.includes("Oct"))).toBe(true);
		expect(months.some((l) => l.includes("2026"))).toBe(true);
	});

	it("renders an all-zero series without crashing", async () => {
		const s = await collectSeries(dir, "day", 3, new Date(2026, 9, 9));
		const out = renderChart(s, "day", { height: 3 });
		expect(out.at(-1)).not.toContain("peak");
		expect(out.join("\n")).not.toContain("NaN");
	});
});
