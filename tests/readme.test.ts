import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tokenBurn, { clearCache, parseCommand } from "../extensions/tokenburn.ts";

const PLACEHOLDERS: Record<string, string[]> = {
	"<view>": ["day", "week", "month", "year", "all"],
	"<window>": ["today", "week", "month", "year", "total"],
	"<tokens>": ["5000000"],
	"$<cost>": ["$50"],
};

/** `/tokenburn ...` spans from the README, with `a|b` alternatives and <placeholders> expanded. */
function readmeCommands(): string[] {
	const md = readFileSync(join(import.meta.dir, "..", "README.md"), "utf8");
	const spans = [...md.matchAll(/`(\/tokenburn[^`]*)`/g)].map((m) => m[1].replace(/\\\|/g, "|"));
	const out = new Set<string>();
	for (const span of spans) {
		let variants = [span];
		// <a|b|c> → one variant per alternative
		for (let guard = 0; guard < 5; guard++) {
			variants = variants.flatMap((v) => {
				const m = v.match(/<([^<>]*\|[^<>]*)>/);
				return m ? m[1].split("|").map((alt) => v.replace(m[0], alt)) : [v];
			});
		}
		// bare `a|b|c` after the command name
		variants = variants.flatMap((v) => {
			const m = v.match(/^\/tokenburn (\w+(?:\|\w+)+)$/);
			return m ? m[1].split("|").map((alt) => `/tokenburn ${alt}`) : [v];
		});
		// named placeholders
		for (const [ph, values] of Object.entries(PLACEHOLDERS)) {
			variants = variants.flatMap((v) => (v.includes(ph) ? values.map((val) => v.split(ph).join(val)) : [v]));
		}
		for (const v of variants) out.add(v.replace(/^\/tokenburn\s*/, "").trim());
	}
	return [...out];
}

describe("every command documented in the README works", () => {
	let dir: string;
	let command: any;
	let notes: string[];
	let prev: string | undefined;
	const theme = { fg: (_c: string, t: string) => t };
	const ctx = () => ({ hasUI: true, ui: { theme, setStatus() {}, setWidget() {}, notify: (m: string) => notes.push(m) } });

	beforeEach(async () => {
		clearCache();
		dir = mkdtempSync(join(tmpdir(), "pi-tb-readme-"));
		prev = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = dir;
		mkdirSync(join(dir, "sessions", "p"), { recursive: true });
		writeFileSync(
			join(dir, "sessions", "p", "s.jsonl"),
			JSON.stringify({ timestamp: new Date().toISOString(), message: { usage: { input: 1000, output: 5, cost: { total: 1 } } } }) + "\n",
		);
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

	it("finds a meaningful set of examples in the README", () => {
		const cmds = readmeCommands();
		expect(cmds.length).toBeGreaterThanOrEqual(15);
		for (const must of ["", "day", "week", "month", "year", "all", "cycle", "window", "cache", "status year", "budget day 5000000", "budget week $50"]) {
			expect(cmds).toContain(must);
		}
	});

	it("each example parses (none is `invalid`) and runs with a success notification", async () => {
		for (const cmd of readmeCommands()) {
			expect(parseCommand(cmd).kind, `README example "/tokenburn ${cmd}"`).not.toBe("invalid");
			notes.length = 0;
			await command.handler(cmd, ctx());
			expect(notes.length, `"/tokenburn ${cmd}" produced no output`).toBeGreaterThan(0);
			expect(notes.at(-1), `"/tokenburn ${cmd}"`).not.toContain("Unknown");
			expect(notes.at(-1), `"/tokenburn ${cmd}"`).not.toContain("Usage:");
		}
	});
});
