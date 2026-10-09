import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tokenBurn, { clearCache } from "../extensions/tokenburn.ts";

describe("pi-tokenburn extension wiring", () => {
	let dir: string;
	let handlers: Record<string, Function>;
	let command: any;
	let status: Record<string, string>;
	let widgets: Record<string, string[]>;
	let notes: string[];
	let prevEnv: Record<string, string | undefined>;

	const theme = { fg: (_c: string, t: string) => t };
	const ctx = () => ({
		hasUI: true,
		ui: {
			theme,
			setStatus: (k: string, v: string) => (status[k] = v),
			setWidget: (k: string, v: string[]) => (widgets[k] = v),
			notify: (m: string) => notes.push(m),
		},
	});

	beforeEach(async () => {
		clearCache();
		dir = mkdtempSync(join(tmpdir(), "pi-tb-ext-"));
		prevEnv = { a: process.env.PI_CODING_AGENT_DIR };
		process.env.PI_CODING_AGENT_DIR = dir;
		mkdirSync(join(dir, "sessions", "p"), { recursive: true });
		writeFileSync(
			join(dir, "sessions", "p", "s.jsonl"),
			JSON.stringify({
				timestamp: new Date().toISOString(),
				message: { usage: { input: 600, output: 400, cost: { total: 1.5 } } },
			}) + "\n",
		);
		handlers = {};
		status = {};
		widgets = {};
		notes = [];
		tokenBurn({ on: (e: string, f: Function) => (handlers[e] = f), registerCommand: (_: string, c: any) => (command = c) } as any);
		await handlers.session_start({}, ctx());
	});

	afterEach(() => {
		if (prevEnv.a === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = prevEnv.a;
		rmSync(dir, { recursive: true, force: true });
	});

	it("shows status bar on session start", () => {
		expect(status.tokenburn).toContain("1.0k");
		expect(status.tokenburn).toContain("$1.50");
		expect(status.tokenburn).toContain("[today]");
	});

	it("flags over-budget in status after setting a budget", async () => {
		await command.handler("budget day 500", ctx());
		expect(status.tokenburn).toContain("OVER BUDGET");
		const saved = JSON.parse(readFileSync(join(dir, "tokenburn.json"), "utf8"));
		expect(saved.budgets.dayTokens).toBe(500);
	});

	it("supports cost budgets with $ prefix", async () => {
		await command.handler("budget week $1", ctx());
		await command.handler("status week", ctx());
		expect(status.tokenburn).toContain("OVER BUDGET");
	});

	it("toggles the widget window", async () => {
		await command.handler("window", ctx());
		expect(widgets["tokenburn-panel"].length).toBeGreaterThan(3);
		await command.handler("window", ctx());
		expect(widgets["tokenburn-panel"]).toEqual([]);
	});

	it("rejects invalid budget input", async () => {
		await command.handler("budget day nope", ctx());
		expect(notes.at(-1)).toContain("Usage");
	});

	it("prints a report by default", async () => {
		await command.handler("", ctx());
		expect(notes.at(-1)).toContain("TokenBurn Report");
		expect(notes.at(-1)).toContain("Today");
	});
});

describe("pi-tokenburn chart + window commands", () => {
	let dir: string;
	let command: any;
	let status: Record<string, string>;
	let notes: string[];
	let prev: string | undefined;
	const theme = { fg: (_c: string, t: string) => t };
	const ctx = () => ({
		hasUI: true,
		ui: { theme, setStatus: (k: string, v: string) => (status[k] = v), setWidget: () => {}, notify: (m: string) => notes.push(m) },
	});

	beforeEach(async () => {
		clearCache();
		dir = mkdtempSync(join(tmpdir(), "pi-tb-cmd-"));
		prev = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = dir;
		mkdirSync(join(dir, "sessions", "p"), { recursive: true });
		writeFileSync(
			join(dir, "sessions", "p", "s.jsonl"),
			JSON.stringify({ timestamp: new Date().toISOString(), message: { usage: { input: 1000, output: 0, cost: { total: 1 } } } }) + "\n",
		);
		status = {};
		notes = [];
		const handlers: Record<string, Function> = {};
		tokenBurn({ on: (e: string, f: Function) => (handlers[e] = f), registerCommand: (_: string, c: any) => (command = c) } as any);
		await handlers.session_start({}, ctx());
	});

	afterEach(() => {
		if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = prev;
		rmSync(dir, { recursive: true, force: true });
	});

	it("switches the status window with shortcuts", async () => {
		for (const w of ["week", "month", "total", "today"]) {
			await command.handler(w, ctx());
			expect(status.tokenburn).toContain(`[${w}]`);
		}
	});

	it("cycles today → week → month → total → today", async () => {
		const seen: string[] = [];
		for (let i = 0; i < 4; i++) {
			await command.handler("cycle", ctx());
			seen.push(status.tokenburn.match(/\[(\w+)\]/)![1]);
		}
		expect(seen).toEqual(["week", "month", "total", "today"]);
	});

	it("shows a daily chart by default and weekly / monthly on request", async () => {
		await command.handler("", ctx());
		expect(notes.at(-1)).toContain("Daily tokens · last 14 days");
		await command.handler("report week", ctx());
		expect(notes.at(-1)).toContain("Weekly tokens · last 8 weeks");
		await command.handler("month", ctx().ui && ctx());
		expect(status.tokenburn).toContain("[month]");
		await command.handler("chart month", ctx());
		expect(notes.at(-1)).toContain("Monthly tokens · last 6 months");
	});
});
