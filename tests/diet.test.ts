import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, appendFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectUsage } from "../extensions/core/aggregate.ts";
import { freshConfig } from "../extensions/core/config.ts";
import { DIET_LOG, clearDietCache, dietLogPath, loadDietLog, parseDietLog } from "../extensions/core/diet.ts";
import { renderReport } from "../extensions/features/report/report.ts";
import { statusExtras } from "../extensions/features/status-line/status.ts";
import { sumRows } from "../extensions/features/breakdown/query.ts";

const NOW = new Date(2026, 9, 14, 12, 0, 0);
const iso = (d: Date) => d.toISOString();
const line = (ts: Date, tokens: number, extra: object = {}) => JSON.stringify({ ts: iso(ts), session: "s", cwd: "/w", tokens, chars: tokens * 3, results: 1, args: 0, ...extra });

describe("pi-context-diet savings log", () => {
	let dir: string;
	beforeEach(() => {
		clearDietCache();
		dir = mkdtempSync(join(tmpdir(), "pi-tb-diet-"));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it("lives in pi's agent dir", () => {
		expect(dietLogPath("/agent")).toBe(join("/agent", DIET_LOG));
		expect(dietLogPath()).toBe(join(process.env.PI_CODING_AGENT_DIR!, DIET_LOG));
	});

	it("parses ts and tokens, skipping broken, empty and zero lines", () => {
		const text = [line(NOW, 10), "", "not json", '{"ts":"nope","tokens":5}', '{"tokens":5}', line(NOW, 0), JSON.stringify({ ts: iso(NOW), tokens: "7" }), '{"ts":'].join("\n");
		expect(parseDietLog(text)).toEqual([{ ts: NOW.getTime(), tokens: 10 }]);
	});

	it("reads nothing from a missing file", async () => {
		expect(await loadDietLog(join(dir, "missing.jsonl"))).toEqual([]);
	});

	it("re-reads the file only when it changed", async () => {
		const path = join(dir, DIET_LOG);
		writeFileSync(path, line(NOW, 10) + "\n");
		const first = await loadDietLog(path);
		expect(first).toHaveLength(1);
		expect(await loadDietLog(path)).toBe(first); // same object: served from the cache
		appendFileSync(path, line(NOW, 20) + "\n");
		expect((await loadDietLog(path)).map((r) => r.tokens)).toEqual([10, 20]);
	});

	describe("in the usage report", () => {
		let root: string;
		let log: string;
		beforeEach(() => {
			root = join(dir, "sessions");
			mkdirSync(join(root, "p"), { recursive: true });
			// One turn today: 1M cache reads billed $0.30 (the cache-read price is $0.30/M).
			const usage = { input: 1000, output: 0, cacheRead: 1_000_000, cacheWrite: 0, cost: { total: 0.303, input: 0.003, cacheRead: 0.3 } };
			writeFileSync(join(root, "p", "s.jsonl"), JSON.stringify({ timestamp: iso(new Date(2026, 9, 14, 10)), message: { role: "assistant", usage } }) + "\n");
			log = join(dir, DIET_LOG);
			writeFileSync(log, [line(new Date(2026, 9, 14, 9), 2_000_000), line(new Date(2026, 8, 1, 9), 500_000)].join("\n") + "\n");
		});

		it("counts each request in the windows it falls in, priced as cache reads", async () => {
			const r = await collectUsage(root, NOW, true, undefined, log);
			expect([r.today.dietTokens, r.today.dietRequests]).toEqual([2_000_000, 1]);
			expect(r.today.dietUsd).toBeCloseTo(0.6, 9);
			expect([r.total.dietTokens, r.total.dietRequests]).toEqual([2_500_000, 2]);
			expect(r.total.dietUsd).toBeCloseTo(0.75, 9);
			expect(r.hour.dietTokens).toBe(0);
		});

		it("adds the saving to the status line and the report", async () => {
			const r = await collectUsage(root, NOW, true, undefined, log);
			// $2.70 of cache savings (1M at $3 - $0.30) + $0.60 of context-diet.
			expect(statusExtras(r, { ...freshConfig(), statusWindow: "today", showRate: false, showHit: false }, NOW.getTime())).toEqual(["~$3.30 saved"]);
			const lines = renderReport({ report: r, chart: [], models: sumRows([]), config: freshConfig(), now: NOW.getTime(), filterText: "" });
			expect(lines.some((l) => l.includes("context-diet: ~2.50M tokens kept out of 2 requests · saved ~$0.75"))).toBe(true);
		});

		it("is left out of filtered views (it is not attributed to models or projects)", async () => {
			const r = await collectUsage(root, NOW, true, { filter: { project: "p" } }, log);
			expect([r.total.dietTokens, r.total.dietUsd]).toEqual([0, 0]);
		});

		it("counts tokens but claims no money without a known cache-read price", async () => {
			writeFileSync(join(root, "p", "s.jsonl"), JSON.stringify({ timestamp: iso(new Date(2026, 9, 14, 10)), message: { role: "assistant", usage: { input: 10, output: 0, cost: { total: 0 } } } }) + "\n");
			const r = await collectUsage(root, NOW, true, undefined, log);
			expect([r.total.dietTokens, r.total.dietUsd]).toEqual([2_500_000, 0]);
			const lines = renderReport({ report: r, chart: [], models: sumRows([]), config: freshConfig(), now: NOW.getTime(), filterText: "" });
			expect(lines.find((l) => l.startsWith("context-diet"))).toBe("context-diet: ~2.50M tokens kept out of 2 requests");
		});
	});
});
