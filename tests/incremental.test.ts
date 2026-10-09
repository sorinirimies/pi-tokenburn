import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, appendFileSync, rmSync, mkdirSync, truncateSync, utimesSync, chmodSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __loadAllForTests, __refreshEntryForTests, clearCache, collectUsage, resetStats, stats } from "../extensions/tokenburn.ts";

const NOW = new Date(2026, 9, 9, 12);
const ts = (h = 10) => new Date(2026, 9, 9, h).toISOString();
const usage = (input: number, extra: Record<string, unknown> = {}) =>
	JSON.stringify({ timestamp: ts(), message: { role: "assistant", usage: { input, output: 0, cost: { total: 0 } }, ...extra } });
const fat = (n = 2000) => JSON.stringify({ timestamp: ts(), message: { role: "toolResult", content: "z".repeat(n) } });
const today = async (root: string) => (await collectUsage(root, NOW)).today.tokens;

describe("incremental session parsing", () => {
	let root: string;
	let file: string;
	beforeEach(() => {
		clearCache();
		resetStats();
		root = mkdtempSync(join(tmpdir(), "pi-tb-inc-"));
		mkdirSync(join(root, "p"));
		file = join(root, "p", "s.jsonl");
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	it("reads only the appended bytes when the active session grows", async () => {
		writeFileSync(file, Array.from({ length: 500 }, (_, i) => (i % 5 === 0 ? usage(1) : fat())).join("\n") + "\n"); // ~1 MB
		expect(await today(root)).toBe(100);
		expect(stats.fullParses).toBe(1);

		resetStats();
		appendFileSync(file, usage(7) + "\n");
		expect(await today(root)).toBe(107);
		expect(stats.incrementalParses).toBe(1);
		expect(stats.fullParses).toBe(0);
		expect(stats.bytesRead).toBeLessThan(1024); // the new line + two tiny integrity probes, not the file
	});

	it("reads nothing when nothing changed", async () => {
		writeFileSync(file, usage(5) + "\n");
		await today(root);
		resetStats();
		await today(root);
		await today(root);
		expect(stats.bytesRead).toBe(0);
		expect(stats.fullParses + stats.incrementalParses).toBe(0);
	});

	it("many small appends always match a from-scratch parse", async () => {
		writeFileSync(file, "");
		for (let i = 1; i <= 60; i++) {
			appendFileSync(file, (i % 3 === 0 ? fat(300) : usage(i)) + "\n");
			const incremental = await today(root);
			clearCache();
			expect(await today(root), `after append #${i}`).toBe(incremental);
			// re-prime the incremental state for the next round
			clearCache();
			await today(root);
		}
	});

	it("an unterminated last line counts now and is not double-counted once it completes", async () => {
		writeFileSync(file, usage(10) + "\n" + usage(5)); // no trailing newline
		expect(await today(root)).toBe(15);
		appendFileSync(file, "\n");
		expect(await today(root)).toBe(15);
		appendFileSync(file, usage(1) + "\n");
		expect(await today(root)).toBe(16);
	});

	it("a line written in two pieces is counted exactly once", async () => {
		const line = usage(42);
		writeFileSync(file, usage(1) + "\n" + line.slice(0, 20));
		expect(await today(root)).toBe(1); // half a JSON line: not parseable yet
		appendFileSync(file, line.slice(20) + "\n");
		expect(await today(root)).toBe(43);
	});

	it("falls back to a full reparse when the file shrinks", async () => {
		writeFileSync(file, usage(1) + "\n" + usage(2) + "\n" + usage(4) + "\n");
		expect(await today(root)).toBe(7);
		truncateSync(file, (usage(1) + "\n").length);
		resetStats();
		expect(await today(root)).toBe(1);
		expect(stats.fullParses).toBe(1);
	});

	it("detects an in-place rewrite of the same size (mtime changes)", async () => {
		writeFileSync(file, usage(1) + "\n" + usage(2) + "\n");
		expect(await today(root)).toBe(3);
		writeFileSync(file, usage(9) + "\n" + usage(8) + "\n"); // same byte length
		const future = new Date(Date.now() + 5000);
		utimesSync(file, future, future);
		resetStats();
		expect(await today(root)).toBe(17);
		expect(stats.fullParses).toBe(1);
	});

	it("detects a rewrite that also grew, via the head check", async () => {
		writeFileSync(file, usage(1) + "\n" + usage(2) + "\n");
		await today(root);
		writeFileSync(file, JSON.stringify({ timestamp: ts(), message: { role: "assistant", usage: { input: 100, output: 0 }, pad: "x".repeat(50) } }) + "\n" + usage(2) + "\n" + usage(3) + "\n");
		resetStats();
		expect(await today(root)).toBe(105);
		expect(stats.fullParses).toBe(1);
		expect(stats.incrementalParses).toBe(0);
	});

	it("detects a rewrite that keeps the head but changes the last parsed bytes (guard check)", async () => {
		const head = usage(1);
		writeFileSync(file, head + "\n" + fat(500) + "\n" + usage(2) + "\n");
		await today(root);
		// same head, different tail content, longer file
		writeFileSync(file, head + "\n" + fat(500).replace(/z/g, "y") + "\n" + usage(6) + "\n" + usage(10) + "\n");
		resetStats();
		expect(await today(root)).toBe(1 + 6 + 10);
		expect(stats.fullParses).toBe(1);
	});

	it("handles files appearing, disappearing and empty files", async () => {
		writeFileSync(file, "");
		expect(await today(root)).toBe(0);
		const other = join(root, "p", "t.jsonl");
		writeFileSync(other, usage(3) + "\n");
		expect(await today(root)).toBe(3);
		rmSync(other);
		expect(await today(root)).toBe(0);
	});

	it("skips lines without usage, malformed JSON and CRLF line endings", async () => {
		writeFileSync(file, [fat(50), "not json with \"usage\"", usage(4), JSON.stringify({ message: { usage: { input: 1 } } })].join("\r\n") + "\r\n");
		expect(await today(root)).toBe(4);
	});

	it("is identical for any chunk size, including boundaries inside lines and multibyte characters", async () => {
		const lines = [usage(1, { note: "héllo 🔥 wörld" }), fat(300), usage(2), usage(3, { note: "日本語".repeat(40) }), fat(5), usage(4)];
		writeFileSync(file, lines.join("\n") + "\n" + usage(5)); // last one unterminated
		const expected = 15;
		for (const chunk of [1, 2, 7, 64, 255, 1 << 20]) {
			clearCache();
			const per = await __loadAllForTests(root, chunk);
			const total = per.flat().reduce((a, t) => a + t.input, 0);
			expect(total, `chunk=${chunk}`).toBe(expected);
		}
	});

	it("keeps working across chunk-sized appends", async () => {
		writeFileSync(file, usage(1) + "\n");
		clearCache();
		await __loadAllForTests(root, 16);
		appendFileSync(file, usage(2) + "\n" + fat(100) + "\n" + usage(3) + "\n");
		const per = await __loadAllForTests(root, 16);
		expect(per.flat().reduce((a, t) => a + t.input, 0)).toBe(6);
	});

	it("refreshEntry gives up cleanly on a missing file or a directory", async () => {
		const st = { size: 10, mtimeMs: 1 };
		expect(await __refreshEntryForTests(join(root, "nope.jsonl"), st, undefined, 1024)).toBeUndefined();
		expect(await __refreshEntryForTests(join(root, "p"), st, undefined, 1024)).toBeUndefined();
	});

	it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("an unreadable session file is skipped, not fatal", async () => {
		writeFileSync(file, usage(5) + "\n");
		const locked = join(root, "p", "locked.jsonl");
		writeFileSync(locked, usage(100) + "\n");
		chmodSync(locked, 0o000);
		try {
			expect(await today(root)).toBe(5);
			expect(statSync(locked).size).toBeGreaterThan(0);
		} finally {
			chmodSync(locked, 0o644);
		}
	});
});
