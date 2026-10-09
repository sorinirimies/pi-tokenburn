import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// pi's REAL autocomplete provider: the one that crashed with "reading 'endsWith'" on a mock-tested build.
import { CombinedAutocompleteProvider } from "@earendil-works/pi-tui";
import tokenBurn, { clearCache, completions, parseCommand } from "../extensions/tokenburn.ts";

/** Every argument text a user can plausibly have typed when the menu is open. */
const TYPED = [
	"", "d", "da", "day", "t", "to", "today", "w", "week", "m", "month", "y", "year", "a", "all",
	"s", "status", "status ", "status t", "status to", "status w", "status m", "status y", "status total",
	"c", "cycle", "ca", "cache", "wi", "window",
	"b", "budget", "budget ", "budget d", "budget w", "budget m", "budget day",
	"r", "report", "report ", "report d", "report w", "report m", "report y", "report a",
	"ch", "chart", "chart ", "chart d", "chart w", "chart m", "chart y", "chart a", "chart all", "chart zzz",
	"zzz", "status zzz", "budget day ", "budget day 5", "report week ",
];

describe("pi's real autocomplete provider × the tokenburn command", () => {
	let dir: string;
	let command: any;
	let notes: string[];
	let status: Record<string, string>;
	let prev: string | undefined;
	let provider: CombinedAutocompleteProvider;
	const theme = { fg: (_c: string, t: string) => t };
	const ctx = () => ({ hasUI: true, ui: { theme, setStatus: (k: string, v: string) => (status[k] = v), setWidget() {}, notify: (m: string) => notes.push(m) } });
	const signal = new AbortController().signal;

	beforeEach(async () => {
		clearCache();
		dir = mkdtempSync(join(tmpdir(), "pi-tb-ac-"));
		prev = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = dir;
		mkdirSync(join(dir, "sessions", "p"), { recursive: true });
		writeFileSync(
			join(dir, "sessions", "p", "s.jsonl"),
			JSON.stringify({ timestamp: new Date().toISOString(), message: { usage: { input: 1000, output: 0, cost: { total: 1 } } } }) + "\n",
		);
		notes = [];
		status = {};
		const handlers: Record<string, Function> = {};
		tokenBurn({ on: (e: string, f: Function) => (handlers[e] = f), registerCommand: (_: string, c: any) => (command = c) } as any);
		await handlers.session_start({}, ctx());
		provider = new CombinedAutocompleteProvider([{ name: "tokenburn", description: command.description, getArgumentCompletions: command.getArgumentCompletions }], dir);
	});

	afterEach(() => {
		if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = prev;
		rmSync(dir, { recursive: true, force: true });
	});

	const suggest = (line: string) => provider.getSuggestions([line], 0, line.length, { signal });

	it("regression: items without a label crash the real provider (what 0.2.0 shipped)", async () => {
		const broken = new CombinedAutocompleteProvider(
			[{ name: "tokenburn", getArgumentCompletions: () => [{ value: "day" }] as any }],
			dir,
		);
		const line = "/tokenburn d";
		const s = await broken.getSuggestions([line], 0, line.length, { signal });
		expect(() => broken.applyCompletion([line], 0, line.length, s!.items[0], s!.prefix)).toThrow(/endsWith/);
	});

	it("applying ANY suggestion for ANY typed input never throws and yields a valid command line", async () => {
		let applied = 0;
		for (const arg of TYPED) {
			const line = `/tokenburn ${arg}`;
			const s = await suggest(line);
			if (!s) continue;
			for (const item of s.items) {
				expect(typeof item.value).toBe("string");
				expect(typeof item.label).toBe("string");
				const out = provider.applyCompletion([line], 0, line.length, item, s.prefix);
				expect(out.lines).toHaveLength(1);
				expect(out.lines[0].startsWith("/tokenburn")).toBe(true);
				// the completed argument text must parse to something other than "invalid"
				// unless it is an intentionally unfinished `status ` / `budget ` / `report ` stem
				const argText = out.lines[0].replace(/^\/tokenburn\s*/, "");
				const parsed = parseCommand(argText);
				const stem = /^(status|report|chart)\s*$/.test(argText) || /^budget\s*((day|week|month)\s*)?$/.test(argText);
				expect(parsed.kind === "invalid" ? stem : true).toBe(true);
				applied++;
			}
		}
		expect(applied).toBeGreaterThan(40);
	});

	it("`/tokenburn day` (the exact input from the crash report) completes and switches the bottom line", async () => {
		const line = "/tokenburn day";
		const s = await suggest(line);
		expect(s).not.toBeNull();
		const item = s!.items.find((i) => i.label === "day")!;
		const out = provider.applyCompletion([line], 0, line.length, item, s!.prefix);
		expect(out.lines[0]).toBe("/tokenburn day");
		await command.handler("week", ctx());
		await command.handler("day", ctx());
		expect(status.tokenburn).toContain("[today]");
		expect(notes.at(-1)).toBe("tokenburn status window: today");
	});

	it("`/tokenburn chart ` offers every chart and applying one prints that chart", async () => {
		const line = "/tokenburn chart m";
		const s = await suggest(line);
		expect(s!.items.map((i) => i.value)).toEqual(["chart month"]);
		const out = provider.applyCompletion([line], 0, line.length, s!.items[0], s!.prefix);
		expect(out.lines[0]).toBe("/tokenburn chart month");
		await command.handler("chart month", ctx());
		expect(notes.at(-1)).toContain("Monthly tokens");
		const all = await suggest("/tokenburn chart ");
		expect(all!.items.map((i) => i.label)).toEqual(["day", "week", "month", "year", "all"]);
	});

	it("offers day/week/month/year/all first, then the other options, with descriptions", async () => {
		const s = await suggest("/tokenburn ");
		const labels = s!.items.map((i) => i.label);
		expect(labels.slice(0, 5)).toEqual(["day", "week", "month", "year", "all"]);
		for (const l of ["chart", "status", "cycle", "window", "budget", "cache"]) expect(labels).toContain(l);
		for (const i of s!.items) expect(i.description && i.description.length).toBeGreaterThan(3);
	});

	it("second-level completion keeps the stem (`status y` → `status year`)", async () => {
		const line = "/tokenburn status y";
		const s = await suggest(line);
		expect(s!.items.map((i) => i.value)).toEqual(["status year"]);
		const out = provider.applyCompletion([line], 0, line.length, s!.items[0], s!.prefix);
		expect(out.lines[0]).toBe("/tokenburn status year");
		await command.handler("status year", ctx());
		expect(status.tokenburn).toContain("[year]");
	});

	it("completing a stem like `status ` leaves the cursor at the end, ready for more", async () => {
		const line = "/tokenburn s";
		const s = await suggest(line);
		const item = s!.items.find((i) => i.label === "status")!;
		const out = provider.applyCompletion([line], 0, line.length, item, s!.prefix);
		expect(out.lines[0]).toBe("/tokenburn status ");
		expect(out.cursorCol).toBe(out.lines[0].length);
	});

	it("choosing a budget period leaves the cursor after a space, ready for the amount", async () => {
		const line = "/tokenburn budget w";
		const s = await suggest(line);
		const out = provider.applyCompletion([line], 0, line.length, s!.items[0], s!.prefix);
		expect(out.lines[0]).toBe("/tokenburn budget week ");
		expect(out.cursorCol).toBe(out.lines[0].length);
		await command.handler("budget week 5000000", ctx());
		expect(notes.at(-1)).toContain("week budget: 5.00M tokens");
	});

	it("no suggestions (null) for unknown input, without throwing", async () => {
		expect(await suggest("/tokenburn zzz")).toBeNull();
		expect(await suggest("/tokenburn budget day 5")).toBeNull();
	});

	it("every completion that is a complete command actually runs and reports success", async () => {
		const complete = new Set<string>();
		for (const arg of TYPED) {
			for (const item of completions(arg) ?? []) if (parseCommand(item.value).kind !== "invalid") complete.add(item.value.trim());
		}
		expect(complete.size).toBeGreaterThanOrEqual(20);
		for (const value of complete) {
			notes.length = 0;
			await command.handler(value, ctx());
			expect(notes.length).toBeGreaterThan(0);
			expect(notes.at(-1)).not.toContain("Unknown");
			expect(notes.at(-1)).not.toContain("Usage:");
		}
	});
});
