import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, appendFileSync, rmSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CACHE_FILE, SAVE_EVERY_MS, cacheFilePath, decodeCache, encodeCache, persistCache, resetCacheFileState, restoreCache } from "../extensions/core/cache-file.ts";
import { __loadAllForTests as loadAll, clearCache, collectUsage, exportCache, importCache, resetStats, stats } from "../extensions/tokenburn.ts";

const NOW = new Date(2026, 9, 9, 12);
const ts = (h = 10) => new Date(2026, 9, 9, h).toISOString();
const header = (cwd: string) => JSON.stringify({ type: "session", cwd });
const usage = (input: number) =>
	JSON.stringify({ timestamp: ts(), message: { role: "assistant", provider: "anthropic", model: "claude", usage: { input, output: 2, cacheRead: 3, cacheWrite: 4, cost: { total: 0.5, input: 0.1, cacheRead: 0.01 } } } });
const today = async (root: string) => (await collectUsage(root, NOW)).today.tokens;

describe("the parse cache saved between pi runs", () => {
	let dir: string;
	let root: string;
	let path: string;
	beforeEach(() => {
		clearCache();
		resetStats();
		resetCacheFileState();
		dir = mkdtempSync(join(tmpdir(), "pi-tb-cachefile-"));
		root = join(dir, "sessions");
		mkdirSync(join(root, "a"), { recursive: true });
		mkdirSync(join(root, "b"), { recursive: true });
		writeFileSync(join(root, "a", "s.jsonl"), [header("/work/a"), usage(10), usage(20)].join("\n") + "\n");
		// No header (project from the directory) and an unterminated last line (a tail turn).
		writeFileSync(join(root, "b", "s.jsonl"), usage(5) + "\n" + usage(7));
		path = join(dir, CACHE_FILE);
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it("lives in pi's agent dir", () => {
		expect(cacheFilePath("/agent")).toBe(join("/agent", CACHE_FILE));
		expect(cacheFilePath()).toBe(join(process.env.PI_CODING_AGENT_DIR!, CACHE_FILE));
	});

	it("round-trips every entry, sharing repeated strings", async () => {
		await loadAll(root);
		const entries = exportCache();
		const saved = encodeCache(entries);
		expect([...saved.strings].sort()).toEqual(["/work/a", "anthropic", "b", "claude"]); // order follows the directory listing
		expect(decodeCache(JSON.parse(JSON.stringify(saved)))).toEqual(entries);
	});

	it("lets a new run start without re-reading unchanged sessions", async () => {
		const before = await today(root);
		expect(before).toBe(4 * 9 + 10 + 20 + 5 + 7); // 4 turns of (input + 2 + 3 + 4)
		expect(await persistCache(path, { force: true })).toBe(true);

		clearCache(); // a new pi run
		resetStats();
		await restoreCache(path);
		expect(await today(root)).toBe(before);
		expect(stats.bytesRead).toBe(0);
		expect(stats.fullParses + stats.incrementalParses).toBe(0);

		// A session that grew since is read from where the cache stopped.
		appendFileSync(join(root, "a", "s.jsonl"), usage(100) + "\n");
		expect(await today(root)).toBe(before + 109);
		expect(stats.incrementalParses).toBe(1);
		expect(stats.fullParses).toBe(0);
	});

	it("re-parses a session rewritten since the cache was saved", async () => {
		await today(root);
		await persistCache(path, { force: true });
		clearCache();
		await restoreCache(path);
		writeFileSync(join(root, "a", "s.jsonl"), [header("/work/x"), usage(1000), usage(1000), usage(1000)].join("\n") + "\n");
		resetStats();
		const r = await collectUsage(root, NOW);
		expect(stats.fullParses).toBe(1);
		expect(r.today.input).toBe(3000 + 5 + 7);
	});

	it("starts empty from a missing or broken file, and never overwrites a warm cache", async () => {
		await restoreCache(join(dir, "missing.json"));
		expect(exportCache()).toEqual([]);
		writeFileSync(path, "{not json");
		await restoreCache(path);
		expect(exportCache()).toEqual([]);

		await loadAll(root);
		const warm = exportCache();
		importCache([["/elsewhere.jsonl", warm[0]![1]]]);
		expect(exportCache()).toEqual(warm);
	});

	it("writes only when something changed, at most every minute unless forced", async () => {
		await loadAll(root);
		expect(await persistCache(path, { now: 1_000_000 })).toBe(true);
		expect(existsSync(path)).toBe(true);
		expect(await persistCache(path, { force: true })).toBe(false); // nothing changed

		appendFileSync(join(root, "a", "s.jsonl"), usage(1) + "\n");
		await loadAll(root);
		expect(await persistCache(path, { now: 1_000_000 + SAVE_EVERY_MS - 1 })).toBe(false);
		expect(await persistCache(path, { now: 1_000_000 + SAVE_EVERY_MS })).toBe(true);
		expect(readFileSync(path, "utf8")).toContain('"version":1');

		appendFileSync(join(root, "a", "s.jsonl"), usage(1) + "\n");
		await loadAll(root);
		expect(await persistCache(path, { now: 1_000_000 })).toBe(false);
		expect(await persistCache(path, { force: true })).toBe(true);
		expect(await persistCache(join(dir, "no", "such", "dir", CACHE_FILE), { force: true })).toBe(false); // nothing changed
		appendFileSync(join(root, "a", "s.jsonl"), usage(1) + "\n");
		await loadAll(root);
		expect(await persistCache(join(dir, "no", "such", "dir", CACHE_FILE), { force: true })).toBe(false); // the write fails
	});

	it("drops whatever is malformed and keeps the rest", () => {
		const ok = { size: 1, mtimeMs: 2, offset: 1, head: "", guard: "", turns: [[1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0]], tail: [] };
		const files = {
			"/ok": ok,
			"/ok-cwd": { ...ok, cwd: "/w" },
			"/null": null,
			"/size": { ...ok, size: "1" },
			"/mtime": { ...ok, mtimeMs: Infinity },
			"/offset": { ...ok, offset: undefined },
			"/head": { ...ok, head: 1 },
			"/guard": { ...ok, guard: null },
			"/cwd": { ...ok, cwd: 7 },
			"/turns": { ...ok, turns: "x" },
			"/tail": { ...ok, tail: [["x"]] },
			"/short": { ...ok, turns: [[1, 2, 3]] },
			"/nan": { ...ok, turns: [[1, 2, 3, 4, 5, 6, 7, "8", 0, 0, 0]] },
			"/string": { ...ok, turns: [[1, 2, 3, 4, 5, 6, 7, 8, 0, 9, 0]] },
			"/index": { ...ok, turns: [[1, 2, 3, 4, 5, 6, 7, 8, 0.5, 0, 0]] },
			"/project": { ...ok, turns: [[1, 2, 3, 4, 5, 6, 7, 8, 0, 0, -1]] },
			"/provider": { ...ok, turns: [[1, 2, 3, 4, 5, 6, 7, 8, 5, 0, 0]] },
		};
		const got = decodeCache({ version: 1, strings: ["s"], files });
		expect(got.map(([f]) => f)).toEqual(["/ok", "/ok-cwd"]);
		expect(got[0]![1].turns[0]).toEqual({ ts: 1, input: 2, output: 3, cacheRead: 4, cacheWrite: 5, cost: 6, costInput: 7, costCacheRead: 8, provider: "s", model: "s", project: "s", session: "/ok" });
		for (const bad of [null, 1, {}, { version: 2, strings: [], files: {} }, { version: 1, strings: "s", files: {} }, { version: 1, strings: [], files: null }, { version: 1, strings: [] }])
			expect(decodeCache(bad)).toEqual([]);
	});

	it("never counts appended turns twice when refreshes overlap", async () => {
		await loadAll(root);
		appendFileSync(join(root, "a", "s.jsonl"), usage(100) + "\n" + usage(100) + "\n");
		const [x, y] = await Promise.all([collectUsage(root, NOW), collectUsage(root, NOW)]);
		expect(x.today.input).toBe(10 + 20 + 5 + 7 + 200);
		expect(y.today.input).toBe(x.today.input);
	});
});
