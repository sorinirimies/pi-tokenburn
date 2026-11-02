import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, appendFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectUsage } from "../extensions/core/aggregate.ts";
import { freshConfig } from "../extensions/core/config.ts";
import { DIET_LOG, SQUEEZE_LOG, clearPluginLogCache, loadPluginLog, parsePluginLog, pluginLogPath } from "../extensions/core/plugin-logs.ts";
import { renderReport } from "../extensions/features/report/report.ts";
import { statusExtras } from "../extensions/features/status-line/status.ts";
import { sumRows } from "../extensions/features/breakdown/query.ts";

const NOW = new Date(2026, 9, 14, 12, 0, 0);
const iso = (d: Date) => d.toISOString();
const line = (ts: Date, tokens: number, extra: object = {}) => JSON.stringify({ ts: iso(ts), session: "s", cwd: "/w", tokens, chars: tokens * 3, ...extra });

describe("pi plugin savings logs", () => {
	let dir: string;
	beforeEach(() => {
		clearPluginLogCache();
		dir = mkdtempSync(join(tmpdir(), "pi-tb-logs-"));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it("live in pi's agent dir", () => {
		expect(pluginLogPath(DIET_LOG, "/agent")).toBe(join("/agent", DIET_LOG));
		expect(pluginLogPath(SQUEEZE_LOG)).toBe(join(process.env.PI_CODING_AGENT_DIR!, SQUEEZE_LOG));
		expect(DIET_LOG).not.toBe(SQUEEZE_LOG);
	});

	it("parses ts and tokens, skipping broken, empty and zero lines", () => {
		const text = [line(NOW, 10), "", "not json", '{"ts":"nope","tokens":5}', '{"tokens":5}', line(NOW, 0), JSON.stringify({ ts: iso(NOW), tokens: "7" }), '{"ts":'].join("\n");
		expect(parsePluginLog(text)).toEqual([{ ts: NOW.getTime(), tokens: 10 }]);
	});

	it("reads nothing from a missing file", async () => {
		expect(await loadPluginLog(join(dir, "missing.jsonl"))).toEqual([]);
	});

	it("re-reads a file only when it changed, each file on its own", async () => {
		const a = join(dir, DIET_LOG);
		const b = join(dir, SQUEEZE_LOG);
		writeFileSync(a, line(NOW, 10) + "\n");
		writeFileSync(b, line(NOW, 99) + "\n");
		const first = await loadPluginLog(a);
		expect(first).toHaveLength(1);
		expect((await loadPluginLog(b))[0]!.tokens).toBe(99);
		expect(await loadPluginLog(a)).toBe(first); // same object: served from the cache
		appendFileSync(a, line(NOW, 20) + "\n");
		expect((await loadPluginLog(a)).map((r) => r.tokens)).toEqual([10, 20]);
	});

	describe("in the usage report", () => {
		let root: string;
		beforeEach(() => {
			root = join(dir, "sessions");
			mkdirSync(join(root, "p"), { recursive: true });
			// One turn today: input at $3/M, 1M cache reads billed $0.30 (the cache-read price is $0.30/M).
			const usage = { input: 1000, output: 0, cacheRead: 1_000_000, cacheWrite: 0, cost: { total: 0.303, input: 0.003, cacheRead: 0.3 } };
			writeFileSync(join(root, "p", "s.jsonl"), JSON.stringify({ timestamp: iso(new Date(2026, 9, 14, 10)), message: { role: "assistant", usage } }) + "\n");
			writeFileSync(join(dir, DIET_LOG), [line(new Date(2026, 9, 14, 9), 2_000_000), line(new Date(2026, 8, 1, 9), 500_000)].join("\n") + "\n");
			writeFileSync(join(dir, SQUEEZE_LOG), line(new Date(2026, 9, 14, 11, 30), 100_000, { kind: "build" }) + "\n");
		});

		it("counts each saving in the windows it falls in, at the window's prices", async () => {
			const r = await collectUsage(root, NOW, true, undefined, dir);
			// context-diet: as cache reads ($0.30/M).
			expect([r.today.dietTokens, r.today.dietRequests]).toEqual([2_000_000, 1]);
			expect(r.today.dietUsd).toBeCloseTo(0.6, 9);
			expect([r.total.dietTokens, r.total.dietRequests]).toEqual([2_500_000, 2]);
			expect(r.total.dietUsd).toBeCloseTo(0.75, 9);
			expect(r.hour.dietTokens).toBe(0);
			// squeeze: as fresh input ($3/M).
			expect([r.hour.squeezeTokens, r.hour.squeezeOutputs]).toEqual([100_000, 1]);
			expect(r.today.squeezeUsd).toBeCloseTo(0.3, 9);
		});

		it("adds the savings to the status line and labels them for pi in the report", async () => {
			const r = await collectUsage(root, NOW, true, undefined, dir);
			// $2.70 of cache savings (1M at $3 - $0.30) + $0.60 of context-diet + $0.30 of squeeze.
			expect(statusExtras(r, { ...freshConfig(), statusWindow: "today", showRate: false, showHit: false }, NOW.getTime())).toEqual(["~$3.60 saved"]);
			const lines = renderReport({ report: r, chart: [], models: sumRows([]), config: freshConfig(), now: NOW.getTime(), filterText: "" });
			expect(lines).toContain("pi context-diet: ~2.50M tokens kept out of 2 requests · saved ~$0.75");
			expect(lines).toContain("pi squeeze: ~100.0k tokens cut from 1 bash outputs · saved ~$0.30");
		});

		it("are left out of filtered views (not attributed to models or projects)", async () => {
			const r = await collectUsage(root, NOW, true, { filter: { project: "p" } }, dir);
			expect([r.total.dietTokens, r.total.dietUsd, r.total.squeezeTokens, r.total.squeezeUsd]).toEqual([0, 0, 0, 0]);
		});

		it("count tokens but claim no money without known prices", async () => {
			writeFileSync(join(root, "p", "s.jsonl"), JSON.stringify({ timestamp: iso(new Date(2026, 9, 14, 10)), message: { role: "assistant", usage: { input: 10, output: 0, cost: { total: 0 } } } }) + "\n");
			const r = await collectUsage(root, NOW, true, undefined, dir);
			expect([r.total.dietTokens, r.total.dietUsd, r.total.squeezeTokens, r.total.squeezeUsd]).toEqual([2_500_000, 0, 100_000, 0]);
			const lines = renderReport({ report: r, chart: [], models: sumRows([]), config: freshConfig(), now: NOW.getTime(), filterText: "" });
			expect(lines.filter((l) => l.startsWith("pi "))).toEqual(["pi context-diet: ~2.50M tokens kept out of 2 requests", "pi squeeze: ~100.0k tokens cut from 1 bash outputs"]);
		});
	});
});
