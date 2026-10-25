import { describe, it, expect } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cacheValue, freshConfig, loadConfig, saveConfig, type Turn } from "../extensions/tokenburn.ts";

const turn = (over: Partial<Turn> = {}): Turn => ({
	ts: 0, input: 100, output: 0, cacheRead: 1000, cacheWrite: 0, cost: 1, costInput: 0.5, costCacheRead: 0.05,
	provider: "p", model: "m", project: "x", session: "s", ...over,
});

describe("cacheValue", () => {
	it("values cache reads at the turn's plain input price", () => {
		// input price = 0.5 / 100 tokens, so 1000 cached tokens would have cost 5.0; they cost 0.05
		expect(cacheValue(turn())).toEqual({ base: 5, actual: 0.05 });
	});

	it("claims nothing without an input price or input tokens", () => {
		expect(cacheValue(turn({ costInput: 0 }))).toEqual({ base: 0, actual: 0 });
		expect(cacheValue(turn({ input: 0 }))).toEqual({ base: 0, actual: 0 });
	});
});

describe("saveConfig", () => {
	it("writes atomically: the file is complete and no temp file is left behind", async () => {
		const dir = mkdtempSync(join(tmpdir(), "tb-cfg-"));
		const before = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = dir;
		try {
			const cfg = freshConfig();
			cfg.warnPct = 42;
			await saveConfig(cfg);
			await saveConfig(cfg); // overwrite
			expect(readdirSync(dir)).toEqual(["tokenburn.json"]);
			expect(JSON.parse(readFileSync(join(dir, "tokenburn.json"), "utf8")).warnPct).toBe(42);
			expect((await loadConfig()).warnPct).toBe(42);
		} finally {
			if (before === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = before;
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
