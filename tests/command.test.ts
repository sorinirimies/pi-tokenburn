import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearCache, collectAllSeries, collectSeries, completions, parseCommand, bucketStart, bucketLabel, renderChart, collectUsage } from "../extensions/tokenburn.ts";

describe("parseCommand", () => {
	it("defaults to the daily report", () => {
		expect(parseCommand("")).toEqual({ kind: "report", view: "day" });
		expect(parseCommand(undefined)).toEqual({ kind: "report", view: "day" });
		expect(parseCommand("   ")).toEqual({ kind: "report", view: "day" });
	});

	it("accepts day, today, week, month, year and all as report views", () => {
		for (const [arg, view] of [["day", "day"], ["today", "day"], ["week", "week"], ["month", "month"], ["year", "year"], ["all", "all"]] as const) {
			expect(parseCommand(arg)).toEqual({ kind: "report", view });
		}
	});

	it("is case- and whitespace-insensitive", () => {
		expect(parseCommand("  MONTH ")).toEqual({ kind: "report", view: "month" });
	});

	it("accepts report/chart prefix", () => {
		expect(parseCommand("report week")).toEqual({ kind: "report", view: "week" });
		expect(parseCommand("chart all")).toEqual({ kind: "report", view: "all" });
		expect(parseCommand("report")).toEqual({ kind: "report", view: "day" });
		expect(parseCommand("report nope").kind).toBe("invalid");
	});

	it("parses status windows", () => {
		for (const w of ["today", "week", "month", "year", "total"]) {
			expect(parseCommand(`status ${w}`)).toEqual({ kind: "status", window: w as any });
		}
		expect(parseCommand("status").kind).toBe("invalid");
		expect(parseCommand("status all").kind).toBe("invalid");
	});

	it("parses cycle / window / widget / cache", () => {
		expect(parseCommand("cycle")).toEqual({ kind: "cycle" });
		expect(parseCommand("window")).toEqual({ kind: "window" });
		expect(parseCommand("widget")).toEqual({ kind: "window" });
		expect(parseCommand("cache")).toEqual({ kind: "cache" });
	});

	it("parses token and cost budgets", () => {
		expect(parseCommand("budget day 5000000")).toEqual({ kind: "budget", period: "day", amount: 5_000_000, isCost: false });
		expect(parseCommand("budget week $50")).toEqual({ kind: "budget", period: "week", amount: 50, isCost: true });
		expect(parseCommand("budget month $0.5")).toEqual({ kind: "budget", period: "month", amount: 0.5, isCost: true });
	});

	it("rejects bad budgets", () => {
		for (const a of ["budget", "budget day", "budget day nope", "budget day 0", "budget day -5", "budget year 5", "budget all 5"]) {
			expect(parseCommand(a).kind).toBe("invalid");
		}
	});

	it("rejects unknown words with a helpful message", () => {
		const c = parseCommand("bogus");
		expect(c.kind).toBe("invalid");
		expect((c as any).message).toContain("day|week|month|year|all");
	});
});

describe("completions", () => {
	const valid = (items: any[] | null) =>
		(items ?? []).every((i) => typeof i.value === "string" && typeof i.label === "string" && i.label.length > 0);

	it("every item has a string value and label (pi calls label.endsWith)", () => {
		for (const p of ["", "d", "w", "m", "y", "a", "s", "status ", "status t", "budget ", "budget d", "report ", "chart w"]) {
			expect(valid(completions(p))).toBe(true);
		}
	});

	it("offers day, week, month, year, all at the top level", () => {
		const values = completions("")!.map((i) => i.value.trim());
		for (const v of ["day", "week", "month", "year", "all", "status", "cycle", "window", "budget", "cache"]) {
			expect(values).toContain(v);
		}
	});

	it("filters by prefix", () => {
		expect(completions("mo")!.map((i) => i.value)).toEqual(["month"]);
		expect(completions("y")!.map((i) => i.value)).toEqual(["year"]);
		expect(completions("zzz")).toBeNull();
	});

	it("completes second-level words with the full argument text", () => {
		expect(completions("status ")!.map((i) => i.value)).toEqual([
			"status today", "status week", "status month", "status year", "status total",
		]);
		expect(completions("status y")!.map((i) => i.value)).toEqual(["status year"]);
		expect(completions("budget ")!.map((i) => i.value)).toEqual(["budget day", "budget week", "budget month"]);
		expect(completions("report a")!.map((i) => i.value)).toEqual(["report all"]);
	});

	it("stops completing once a budget period is chosen", () => {
		expect(completions("budget day ")).toBeNull();
	});
});

describe("year + all series", () => {
	let dir: string;
	beforeEach(() => {
		clearCache();
		dir = mkdtempSync(join(tmpdir(), "pi-tb-year-"));
		mkdirSync(join(dir, "p"), { recursive: true });
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	const line = (d: Date, input: number) =>
		JSON.stringify({ timestamp: d.toISOString(), message: { usage: { input, output: 0 } } });

	it("buckets and labels years", () => {
		expect(bucketStart(new Date(2026, 9, 9).getTime(), "year")).toBe(new Date(2026, 0, 1).getTime());
		expect(bucketLabel(new Date(2026, 0, 1).getTime(), "year")).toBe("2026");
	});

	it("collects yearly series, zero-filled", async () => {
		const now = new Date(2026, 9, 9);
		writeFileSync(join(dir, "p", "s.jsonl"), [line(new Date(2026, 2, 1), 10), line(new Date(2024, 5, 1), 7)].join("\n") + "\n");
		const s = await collectSeries(dir, "year", 4, now);
		expect(s.map((p) => p.label)).toEqual(["2023", "2024", "2025", "2026"]);
		expect(s.map((p) => p.tokens)).toEqual([0, 7, 0, 10]);
	});

	it("tracks the current year in the report", async () => {
		const now = new Date(2026, 9, 9);
		writeFileSync(join(dir, "p", "s.jsonl"), [line(new Date(2026, 0, 2), 10), line(new Date(2025, 11, 31), 5)].join("\n") + "\n");
		const r = await collectUsage(dir, now);
		expect(r.year.tokens).toBe(10);
		expect(r.total.tokens).toBe(15);
	});

	it("`all` uses months for short history", async () => {
		const now = new Date(2026, 9, 9);
		writeFileSync(join(dir, "p", "s.jsonl"), [line(new Date(2026, 6, 15), 10), line(new Date(2026, 9, 1), 5)].join("\n") + "\n");
		const { unit, series } = await collectAllSeries(dir, now);
		expect(unit).toBe("month");
		expect(series.map((p) => p.label)).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
		expect(series.map((p) => p.tokens)).toEqual([10, 0, 0, 5]);
	});

	it("`all` switches to years once history spans more than 18 months", async () => {
		const now = new Date(2026, 9, 9);
		writeFileSync(join(dir, "p", "s.jsonl"), [line(new Date(2023, 3, 1), 10), line(new Date(2026, 1, 1), 5)].join("\n") + "\n");
		const { unit, series } = await collectAllSeries(dir, now);
		expect(unit).toBe("year");
		expect(series.map((p) => p.label)).toEqual(["2023", "2024", "2025", "2026"]);
		expect(series.map((p) => p.tokens)).toEqual([10, 0, 0, 5]);
	});

	it("`all` with no data still returns a drawable series", async () => {
		const { series } = await collectAllSeries(dir, new Date(2026, 9, 9));
		expect(series.length).toBeGreaterThanOrEqual(2);
		expect(renderChart(series, "month").join("\n")).not.toContain("NaN");
	});

	it("renders the yearly chart with wide columns and year labels", async () => {
		const now = new Date(2026, 9, 9);
		writeFileSync(join(dir, "p", "s.jsonl"), line(new Date(2025, 5, 1), 10) + "\n");
		const out = renderChart(await collectSeries(dir, "year", 3, now), "year", { height: 3 });
		expect(out[0]).toContain("Yearly tokens · last 3 years");
		expect(out.some((l) => l.includes("2024") && l.includes("2025") && l.includes("2026"))).toBe(true);
	});

	it("supports a custom chart title", async () => {
		const out = renderChart(await collectSeries(dir, "month", 2, new Date(2026, 9, 9)), "month", { title: "All time" });
		expect(out[0]).toContain("All time · 2 months");
	});
});
