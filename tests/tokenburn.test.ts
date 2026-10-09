import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectUsage, clearCache, formatNum, formatCost, budgetsFor, isOverBudget, loadConfig } from "../extensions/tokenburn.ts";

describe("pi-tokenburn", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = mkdtempSync(join(tmpdir(), "pi-tokenburn-test-"));
		clearCache();
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("formats numbers properly", () => {
		expect(formatNum(500)).toBe("500");
		expect(formatNum(1500)).toBe("1.5k");
		expect(formatNum(2_500_000)).toBe("2.50M");
		expect(formatNum(3_400_000_000)).toBe("3.40B");
	});

	it("formats costs properly", () => {
		expect(formatCost(0)).toBe("$0.00");
		expect(formatCost(12.3456)).toBe("$12.35");
	});

	it("correctly aggregates usage across sessions and periods", async () => {
		const sessionDir = join(testDir, "proj1");
		mkdirSync(sessionDir, { recursive: true });

		const now = new Date(2026, 9, 9, 12);

		// Today's entry
		const todayLine = JSON.stringify({
			timestamp: new Date(2026, 9, 9, 10).toISOString(),
			message: {
				usage: {
					input: 1000,
					output: 200,
					cost: { total: 0.05 },
				},
			},
		});

		// Yesterday's entry (same week)
		const yesterdayLine = JSON.stringify({
			timestamp: new Date(2026, 9, 8, 10).toISOString(),
			message: {
				usage: {
					input: 2000,
					output: 300,
					cost: { total: 0.10 },
				},
			},
		});

		// Past month entry
		const oldLine = JSON.stringify({
			timestamp: new Date(2026, 7, 1, 10).toISOString(),
			message: {
				usage: {
					input: 5000,
					output: 500,
					cost: { total: 0.20 },
				},
			},
		});

		writeFileSync(join(sessionDir, "sess1.jsonl"), `${todayLine}\n${yesterdayLine}\n${oldLine}\n`);

		const report = await collectUsage(testDir, now);

		// Today
		expect(report.today.tokens).toBe(1200);
		expect(report.today.input).toBe(1000);
		expect(report.today.output).toBe(200);
		expect(report.today.cost).toBeCloseTo(0.05);

		// Week (today + yesterday)
		expect(report.week.tokens).toBe(3500);
		expect(report.week.cost).toBeCloseTo(0.15);

		// Month (October = today + yesterday)
		expect(report.month.tokens).toBe(3500);

		// Total (all)
		expect(report.total.tokens).toBe(9000);
		expect(report.total.cost).toBeCloseTo(0.35);
		expect(report.total.sessions).toBe(1);
	});

	it("returns empty report for missing directory", async () => {
		const report = await collectUsage(join(testDir, "nope"));
		expect(report.total.tokens).toBe(0);
		expect(report.total.sessions).toBe(0);
	});

	it("picks up appended lines when a cached file grows", async () => {
		const sessionDir = join(testDir, "p");
		mkdirSync(sessionDir, { recursive: true });
		const file = join(sessionDir, "s.jsonl");
		const now = new Date(2026, 9, 9, 12);
		const line = (inp: number) =>
			JSON.stringify({ timestamp: new Date(2026, 9, 9, 10).toISOString(), message: { usage: { input: inp, output: 0 } } });

		writeFileSync(file, line(100) + "\n");
		expect((await collectUsage(testDir, now)).today.tokens).toBe(100);

		writeFileSync(file, line(100) + "\n" + line(50) + "\n");
		expect((await collectUsage(testDir, now)).today.tokens).toBe(150);
	});

	it("skips malformed lines and lines without usage", async () => {
		const sessionDir = join(testDir, "p");
		mkdirSync(sessionDir, { recursive: true });
		const now = new Date(2026, 9, 9, 12);
		writeFileSync(
			join(sessionDir, "s.jsonl"),
			[
				"not json with \"usage\"",
				JSON.stringify({ timestamp: new Date(2026, 9, 9, 10).toISOString(), message: { role: "user" } }),
				JSON.stringify({ timestamp: new Date(2026, 9, 9, 10).toISOString(), message: { usage: { input: 7, output: 3 } } }),
			].join("\n") + "\n",
		);
		expect((await collectUsage(testDir, now)).today.tokens).toBe(10);
	});

	it("counts cache tokens only when includeCache is true", async () => {
		const sessionDir = join(testDir, "p");
		mkdirSync(sessionDir, { recursive: true });
		const now = new Date(2026, 9, 9, 12);
		writeFileSync(
			join(sessionDir, "s.jsonl"),
			JSON.stringify({
				timestamp: new Date(2026, 9, 9, 10).toISOString(),
				message: { usage: { input: 10, output: 5, cacheRead: 1000, cacheWrite: 100 } },
			}) + "\n",
		);
		const withCache = await collectUsage(testDir, now, true);
		expect(withCache.today.tokens).toBe(1115);
		expect(withCache.today.cacheRead).toBe(1000);
		const without = await collectUsage(testDir, now, false);
		expect(without.today.tokens).toBe(15);
	});

	it("evaluates token and cost budgets", () => {
		const cfg: any = { budgets: { dayTokens: 100, weekCost: 5 } };
		expect(budgetsFor(cfg, "today")).toEqual({ tokens: 100, cost: undefined });
		expect(budgetsFor(cfg, "total")).toEqual({});
		const p: any = { tokens: 101, cost: 0 };
		expect(isOverBudget(p, { tokens: 100 })).toBe(true);
		expect(isOverBudget({ ...p, tokens: 50 }, { tokens: 100 })).toBe(false);
		expect(isOverBudget({ ...p, tokens: 0, cost: 6 }, { cost: 5 })).toBe(true);
		expect(isOverBudget(p, {})).toBe(false);
	});

	it("loads defaults when config is missing or invalid", async () => {
		const prev = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = testDir;
		try {
			expect((await loadConfig()).statusWindow).toBe("today");
			writeFileSync(join(testDir, "tokenburn.json"), JSON.stringify({ statusWindow: "bogus", includeCache: false }));
			const cfg = await loadConfig();
			expect(cfg.statusWindow).toBe("today");
			expect(cfg.includeCache).toBe(false);
		} finally {
			if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = prev;
		}
	});
});
