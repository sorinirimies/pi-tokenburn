import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tokenBurn, { clearCache, fileSignature, resolveAgentDir, resolveSessionsDir, sanitizeBudgets } from "../extensions/tokenburn.ts";

describe("path resolution", () => {
	it("resolveAgentDir: PI_CODING_AGENT_DIR, then XDG, then ~/.pi/agent", () => {
		expect(resolveAgentDir({ PI_CODING_AGENT_DIR: "/a", XDG_CONFIG_HOME: "/x" }, "/h")).toBe("/a");
		expect(resolveAgentDir({ XDG_CONFIG_HOME: "/x" }, "/h")).toBe(join("/x", "pi", "agent"));
		expect(resolveAgentDir({}, "/h")).toBe(join("/h", ".pi", "agent"));
		expect(resolveAgentDir({ PI_CODING_AGENT_DIR: "", XDG_CONFIG_HOME: "" }, "/h")).toBe(join("/h", ".pi", "agent"));
	});

	it("resolveSessionsDir: TOKENBURN_PI_SESSIONS, PI_CODING_AGENT_SESSION_DIR, then <agent dir>/sessions", () => {
		expect(resolveSessionsDir({ TOKENBURN_PI_SESSIONS: "/t", PI_CODING_AGENT_SESSION_DIR: "/s" }, "/h")).toBe("/t");
		expect(resolveSessionsDir({ PI_CODING_AGENT_SESSION_DIR: "/s" }, "/h")).toBe("/s");
		expect(resolveSessionsDir({ PI_CODING_AGENT_DIR: "/a" }, "/h")).toBe(join("/a", "sessions"));
		expect(resolveSessionsDir({}, "/h")).toBe(join("/h", ".pi", "agent", "sessions"));
	});

	it("fileSignature is mtime:size, or undefined for a missing file", () => {
		const d = mkdtempSync(join(tmpdir(), "pi-tb-sig-"));
		writeFileSync(join(d, "f"), "abc");
		expect(fileSignature(join(d, "f"))).toMatch(/^\d+(\.\d+)?:3$/);
		expect(fileSignature(join(d, "nope"))).toBeUndefined();
		rmSync(d, { recursive: true, force: true });
	});
});

describe("config hardening", () => {
	it("sanitizeBudgets keeps only known keys with positive finite numbers", () => {
		expect(sanitizeBudgets({ dayTokens: 5, weekCost: 2.5, monthTokens: 0, dayCost: -1, weekTokens: "9", monthCost: Infinity, junk: 1 })).toEqual({ dayTokens: 5, weekCost: 2.5 });
	});

	it("sanitizeBudgets tolerates non-objects", () => {
		for (const v of [undefined, null, 5, "x", [1, 2], true]) expect(sanitizeBudgets(v)).toEqual({});
	});

	it("sanitizeBudgets ignores prototype-pollution keys", () => {
		const evil = JSON.parse('{"__proto__": {"polluted": true}, "constructor": {"x": 1}, "dayTokens": 7}');
		expect(sanitizeBudgets(evil)).toEqual({ dayTokens: 7 });
		expect(({} as any).polluted).toBeUndefined();
	});
});

describe("extension lifecycle", () => {
	let dir: string;
	let handlers: Record<string, Function>;
	let command: any;
	let status: Record<string, string>;
	let widgets: Record<string, string[]>;
	let notes: string[];
	let prev: Record<string, string | undefined>;
	const theme = { fg: (_c: string, t: string) => t };
	const ctx = (hasUI = true) => ({
		hasUI,
		ui: {
			theme,
			setStatus: (k: string, v: string) => (status[k] = v),
			setWidget: (k: string, v: string[]) => (widgets[k] = v),
			notify: (m: string) => notes.push(m),
		},
	});
	const line = (input: number) =>
		JSON.stringify({ timestamp: new Date().toISOString(), message: { usage: { input, output: 0, cost: { total: 0.5 } } } }) + "\n";
	const boot = async (config?: object) => {
		if (config) writeFileSync(join(dir, "tokenburn.json"), JSON.stringify(config));
		handlers = {};
		tokenBurn({ on: (e: string, f: Function) => (handlers[e] = f), registerCommand: (_: string, c: any) => (command = c) } as any);
		await handlers.session_start({}, ctx());
	};

	beforeEach(() => {
		clearCache();
		dir = mkdtempSync(join(tmpdir(), "pi-tb-life-"));
		prev = { a: process.env.PI_CODING_AGENT_DIR, b: process.env.TOKENBURN_PI_SESSIONS };
		process.env.PI_CODING_AGENT_DIR = dir;
		delete process.env.TOKENBURN_PI_SESSIONS;
		mkdirSync(join(dir, "sessions", "p"), { recursive: true });
		writeFileSync(join(dir, "sessions", "p", "s.jsonl"), line(1000));
		status = {};
		widgets = {};
		notes = [];
	});

	afterEach(() => {
		for (const [k, v] of [["PI_CODING_AGENT_DIR", prev.a], ["TOKENBURN_PI_SESSIONS", prev.b]] as const) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
		rmSync(dir, { recursive: true, force: true });
	});

	it("showStatus=false clears the status bar", async () => {
		await boot({ showStatus: false });
		expect(status.tokenburn).toBe("");
	});

	it("showWidget=true from the config file renders the panel at start, including a Year row", async () => {
		await boot({ showWidget: true });
		const panel = widgets["tokenburn-panel"].join("\n");
		for (const label of ["TokenBurn Dashboard", "Today", "Week", "Month", "Year", "Total"]) expect(panel).toContain(label);
	});

	it("turn_end refreshes the status as the session grows", async () => {
		await boot();
		expect(status.tokenburn).toContain("1.0k");
		appendFileSync(join(dir, "sessions", "p", "s.jsonl"), line(2000));
		handlers.turn_end({}, ctx());
		await new Promise((r) => setTimeout(r, 50)); // fire-and-forget refresh
		expect(status.tokenburn).toContain("3.0k");
	});

	it("turn_end never throws into the agent loop, even if the refresh fails", async () => {
		await boot();
		const broken: any = { hasUI: true, get ui() { throw new Error("boom"); } };
		expect(() => handlers.turn_end({}, broken)).not.toThrow();
		await new Promise((r) => setTimeout(r, 20));
	});

	it("a hand-edited config with junk values is sanitised at load", async () => {
		await boot({ budgets: { dayTokens: "lots", weekTokens: 10, bogus: 1 }, statusWindow: "week", showWidget: "yes" });
		expect(status.tokenburn).toContain("[week]");
		expect(status.tokenburn).toContain("OVER BUDGET"); // the valid weekTokens=10 applied; the junk did not
		await command.handler("budget day 1", ctx());
		const saved = JSON.parse(readFileSync(join(dir, "tokenburn.json"), "utf8"));
		expect(saved.budgets).toEqual({ weekTokens: 10, dayTokens: 1 });
	});

	it("session_start survives a UI that throws", async () => {
		handlers = {};
		tokenBurn({ on: (e: string, f: Function) => (handlers[e] = f), registerCommand: () => {} } as any);
		const broken: any = { hasUI: true, ui: { get theme() { throw new Error("no theme"); }, setStatus() {}, setWidget() {}, notify() {} } };
		await expect(handlers.session_start({}, broken)).resolves.toBeUndefined();
	});

	it("does nothing without a UI", async () => {
		handlers = {};
		tokenBurn({ on: (e: string, f: Function) => (handlers[e] = f), registerCommand: () => {} } as any);
		const quiet = { hasUI: false, ui: { theme, setStatus: () => { throw new Error("no UI"); }, setWidget: () => { throw new Error("no UI"); }, notify: () => {} } };
		await handlers.session_start({}, quiet);
		await handlers.turn_end({}, quiet);
	});

	it("`cache` toggles cache tokens, persists it, and changes the totals", async () => {
		writeFileSync(
			join(dir, "sessions", "p", "s.jsonl"),
			JSON.stringify({ timestamp: new Date().toISOString(), message: { usage: { input: 100, output: 0, cacheRead: 9000, cost: { total: 0 } } } }) + "\n",
		);
		await boot();
		expect(status.tokenburn).toContain("9.1k");
		await command.handler("cache", ctx());
		expect(notes.at(-1)).toContain("cache tokens excluded");
		expect(status.tokenburn).toContain("100");
		expect(status.tokenburn).not.toContain("9.1k");
		expect(JSON.parse(readFileSync(join(dir, "tokenburn.json"), "utf8")).includeCache).toBe(false);
		await command.handler("cache", ctx());
		expect(notes.at(-1)).toContain("cache tokens included");
		expect(status.tokenburn).toContain("9.1k");
	});

	it("budget notifies with the formatted amount (tokens and dollars) and persists both kinds", async () => {
		await boot();
		await command.handler("budget day 2500000", ctx());
		expect(notes.at(-1)).toContain("day budget: 2.50M tokens");
		await command.handler("budget month $120", ctx());
		expect(notes.at(-1)).toContain("month budget: $120.00");
		const saved = JSON.parse(readFileSync(join(dir, "tokenburn.json"), "utf8"));
		expect(saved.budgets).toEqual({ dayTokens: 2_500_000, monthCost: 120 });
	});

	it("the report shows the year row and an all-time chart", async () => {
		await boot();
		await command.handler("chart all", ctx());
		expect(notes.at(-1)).toContain("This Year");
		expect(notes.at(-1)).toContain("All time");
	});

	it("chartColor=false produces plain output (no theme calls in the chart)", async () => {
		let calls = 0;
		const counting = { hasUI: true, ui: { theme: { fg: (_c: string, t: string) => (calls++, t) }, setStatus() {}, setWidget() {}, notify: (m: string) => notes.push(m) } };
		await boot({ chartColor: false });
		const before = calls;
		await command.handler("chart day", counting);
		const used = calls - before;
		await command.handler("chart day", ctx());
		expect(used).toBeLessThanOrEqual(6); // only the status bar's fg calls, none from the chart
		expect(notes.at(-1)).toContain("Daily tokens");
	});
});
