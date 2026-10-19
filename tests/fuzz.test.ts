// Randomised robustness tests ("fuzzing" without extra dependencies).
//
// Everything that reads untrusted or hand-edited input must survive garbage: session logs
// (JSONL written by pi, possibly truncated), the settings file, and the /tokenburn command line.
// The generator is seeded, so a failure prints a seed that reproduces it exactly:
//
//   FUZZ_SEED=12345 bun test tests/fuzz.test.ts
//   FUZZ_ITERS=200000 bun test tests/fuzz.test.ts      (the nightly workflow does this)
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	bar,
	bucketLabel,
	bucketStart,
	clearCache,
	collectUsage,
	completions,
	formatCost,
	formatNum,
	parseCommand,
	renderChart,
	sanitizeBudgets,
	sanitizeRefreshMs,
	sparkline,
	type SeriesPoint,
	type Unit,
} from "../extensions/tokenburn.ts";

const ITERS = Number(process.env.FUZZ_ITERS ?? 400);
const SEED = Number(process.env.FUZZ_SEED ?? Math.floor(Math.random() * 2 ** 31));
const UNITS: Unit[] = ["day", "week", "month", "year"];

/** mulberry32: small, fast, seedable. */
function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function gen(seed: number) {
	const r = rng(seed);
	const int = (n: number) => Math.floor(r() * n);
	const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)];
	const NASTY = [0, -0, 1, -1, 0.5, NaN, Infinity, -Infinity, 1e308, -1e308, 2 ** 53, 2 ** 31, 1e-300, Number.MAX_SAFE_INTEGER];
	const number = () => (r() < 0.5 ? pick(NASTY) : (r() - 0.5) * 10 ** int(16));
	const string = () => {
		const len = int(24);
		let s = "";
		for (let i = 0; i < len; i++) s += String.fromCharCode(r() < 0.8 ? 32 + int(95) : int(0xd800));
		return s;
	};
	const value = (depth = 0): unknown => {
		const k = int(depth > 2 ? 6 : 9);
		if (k === 0) return number();
		if (k === 1) return string();
		if (k === 2) return null;
		if (k === 3) return undefined;
		if (k === 4) return r() < 0.5;
		if (k === 5) return pick(["", "NaN", "0", "-5", "1e999"]);
		if (k === 6) return Array.from({ length: int(4) }, () => value(depth + 1));
		const o: Record<string, unknown> = {};
		for (let i = 0; i < int(5); i++) o[pick(["input", "output", "cost", "total", "usage", "message", "timestamp", string()])] = value(depth + 1);
		return o;
	};
	return { r, int, pick, number, string, value };
}

/** Run `fn` ITERS times; on failure say which iteration and how to reproduce it. */
function fuzz(name: string, fn: (g: ReturnType<typeof gen>) => void | Promise<void>) {
	it(`${name} (seed ${SEED}, ${ITERS} runs)`, async () => {
		for (let i = 0; i < ITERS; i++) {
			try {
				await fn(gen(SEED + i));
			} catch (e) {
				throw new Error(`${name}: failed at FUZZ_SEED=${SEED + i} FUZZ_ITERS=1: ${(e as Error).message}`);
			}
		}
	});
}

describe("fuzz: command line", () => {
	const WORDS = ["", "day", "week", "month", "year", "all", "budget", "set", "off", "chart", "report", "refresh", "help", "10", "-1", "1e3", "NaN", "$5", "5k", "2M"];
	fuzz("parseCommand never throws and always returns a command", (g) => {
		const words = Array.from({ length: g.int(6) }, () => (g.r() < 0.7 ? g.pick(WORDS) : g.string()));
		const cmd = parseCommand(g.r() < 0.05 ? undefined : words.join(g.pick([" ", "  ", "\t", "\n"])));
		expect(typeof cmd.kind).toBe("string");
	});
	fuzz("completions never throws", (g) => {
		const text = Array.from({ length: g.int(4) }, () => (g.r() < 0.7 ? g.pick(WORDS) : g.string())).join(" ");
		const items = completions(g.r() < 0.5 ? text : text + " ");
		if (items) for (const it of items) expect(typeof it.value).toBe("string");
	});
});

describe("fuzz: settings", () => {
	fuzz("sanitizers turn any value into a valid one", (g) => {
		const ms = sanitizeRefreshMs(g.value());
		expect(Number.isFinite(ms) && ms >= 250 && ms <= 60_000).toBe(true);
		for (const n of Object.values(sanitizeBudgets(g.value()))) expect(Number.isFinite(n) && (n as number) > 0).toBe(true);
	});
});

describe("fuzz: formatting and charts", () => {
	// Found by fuzzing: a value far above `max` used to build a multi-gigabyte string.
	it("bar is capped at the full width", () => {
		expect(bar(Infinity, 1, 10)).toBe("█".repeat(10));
		expect(bar(1e308, 1, 10)).toBe("█".repeat(10));
		expect(bar(5, NaN, 10)).toBe("");
		expect(bar(5, 10, NaN)).toBe("");
	});
	it("renderChart tolerates an invalid date", () => {
		for (const unit of UNITS) expect(() => renderChart([{ start: NaN, label: "x", tokens: 1, cost: 1 }], unit)).not.toThrow();
	});
	fuzz("number formatting returns text for any number", (g) => {
		expect(typeof formatNum(g.number())).toBe("string");
		expect(typeof formatCost(g.number())).toBe("string");
	});
	fuzz("bar and sparkline cope with any numbers", (g) => {
		expect(typeof bar(g.number(), g.number(), g.int(300))).toBe("string");
		expect(typeof sparkline(Array.from({ length: g.int(40) }, () => g.number()))).toBe("string");
	});
	fuzz("bucketing copes with any timestamp", (g) => {
		const unit = g.pick(UNITS);
		const ts = g.r() < 0.4 ? g.number() : Date.now() + (g.r() - 0.5) * 1e13;
		expect(typeof bucketStart(ts, unit)).toBe("number");
		expect(typeof bucketLabel(bucketStart(ts, unit), unit)).toBe("string");
	});
	fuzz("renderChart draws any series", (g) => {
		const series: SeriesPoint[] = Array.from({ length: g.int(30) }, () => ({
			start: g.number(),
			label: g.string(),
			tokens: g.number(),
			cost: g.number(),
		}));
		const budget = g.r() < 0.5 ? { tokens: g.number(), cost: g.number() } : undefined;
		const out = renderChart(series, g.pick(UNITS), { height: g.int(30), budget });
		expect(out === undefined || typeof out === "string" || Array.isArray(out)).toBe(true);
	});
});

describe("fuzz: session logs", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pi-tokenburn-fuzz-"));
		clearCache();
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it(`garbage JSONL never breaks the report (seed ${SEED})`, async () => {
		const runs = Math.max(5, Math.floor(ITERS / 20));
		for (let i = 0; i < runs; i++) {
			const g = gen(SEED + i);
			rmSync(dir, { recursive: true, force: true });
			mkdirSync(join(dir, "proj"), { recursive: true });
			const lines: string[] = [];
			for (let n = 0; n < 1 + g.int(30); n++) {
				const good = JSON.stringify({
					timestamp: new Date(Date.now() - g.int(40) * 864e5).toISOString(),
					message: { usage: { input: g.int(5000), output: g.int(900), cost: { total: g.r() } } },
				});
				const k = g.int(6);
				if (k === 0) lines.push(good);
				else if (k === 1) lines.push(good.slice(0, g.int(good.length))); // truncated
				else if (k === 2) lines.push(JSON.stringify(g.value())); // wrong shape
				else if (k === 3) lines.push(g.string()); // not JSON
				else if (k === 4) lines.push(JSON.stringify({ timestamp: g.value(), message: { usage: g.value() } }));
				else lines.push("");
			}
			writeFileSync(join(dir, "proj", "s.jsonl"), lines.join(g.pick(["\n", "\r\n"])) + (g.r() < 0.5 ? "\n" : ""));
			if (g.r() < 0.3) writeFileSync(join(dir, "proj", "bin.jsonl"), Buffer.from(Array.from({ length: 200 }, () => g.int(256))));
			try {
				clearCache();
				const report = await collectUsage(dir);
				for (const p of [report.today, report.week, report.month, report.total]) {
					expect(Number.isFinite(p.tokens) && Number.isFinite(p.cost)).toBe(true);
				}
			} catch (e) {
				throw new Error(`garbage session logs: failed at FUZZ_SEED=${SEED + i}: ${(e as Error).message}`);
			}
		}
	});
});
