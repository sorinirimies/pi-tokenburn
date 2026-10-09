import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, appendFileSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tokenBurn, { clearCache, resetStats, sanitizeRefreshMs, stats } from "../extensions/tokenburn.ts";

const line = (input: number) =>
	JSON.stringify({ timestamp: new Date().toISOString(), message: { role: "assistant", usage: { input, output: 0, cost: { total: 0.1 } } } }) + "\n";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("live refresh, enable / disable", () => {
	let dir: string;
	let sessionFile: string;
	let handlers: Record<string, Function>;
	let command: any;
	let notes: string[];
	let statusCalls: string[];
	let widgetCalls: string[][];
	let prev: string | undefined;
	const theme = { fg: (_c: string, t: string) => t };
	const ctx = (hasUI = true) => ({
		hasUI,
		ui: {
			theme,
			setStatus: (_k: string, v: string) => statusCalls.push(v),
			setWidget: (_k: string, v: string[]) => widgetCalls.push(v),
			notify: (m: string) => notes.push(m),
		},
	});
	const lastStatus = () => statusCalls.at(-1) ?? "";
	const cfgFile = () => JSON.parse(readFileSync(join(dir, "tokenburn.json"), "utf8"));
	const boot = async (config: object = {}) => {
		writeFileSync(join(dir, "tokenburn.json"), JSON.stringify({ refreshMs: 250, ...config }));
		handlers = {};
		tokenBurn({ on: (e: string, f: Function) => (handlers[e] = f), registerCommand: (_: string, c: any) => (command = c) } as any);
		await handlers.session_start({}, ctx());
	};
	const assistant = { message: { role: "assistant" } };

	beforeEach(() => {
		clearCache();
		resetStats();
		dir = mkdtempSync(join(tmpdir(), "pi-tb-live-"));
		prev = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = dir;
		mkdirSync(join(dir, "sessions", "p"), { recursive: true });
		sessionFile = join(dir, "sessions", "p", "s.jsonl");
		writeFileSync(sessionFile, line(1000));
		notes = [];
		statusCalls = [];
		widgetCalls = [];
	});

	afterEach(async () => {
		await handlers.session_shutdown?.({ reason: "quit" });
		if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = prev;
		rmSync(dir, { recursive: true, force: true });
	});

	describe("live refresh after each assistant message", () => {
		it("a burst of messages causes ONE refresh, which shows the new total", async () => {
			await boot();
			expect(lastStatus()).toContain("1.0k");
			const before = statusCalls.length;
			appendFileSync(sessionFile, line(2000));
			for (let i = 0; i < 25; i++) expect(handlers.message_end(assistant, ctx())).toBeUndefined();
			expect(statusCalls.length).toBe(before); // nothing yet: it is coalesced, not synchronous
			await sleep(450);
			expect(statusCalls.length).toBe(before + 1);
			expect(lastStatus()).toContain("3.0k");
		});

		it("only assistant messages trigger it; the handler always returns undefined (never replaces a message)", async () => {
			await boot();
			const before = statusCalls.length;
			appendFileSync(sessionFile, line(500));
			for (const message of [{ role: "user" }, { role: "toolResult" }, { role: "custom" }, {}, undefined, null]) {
				expect(handlers.message_end({ message }, ctx())).toBeUndefined();
			}
			expect(handlers.message_end({}, ctx())).toBeUndefined();
			await sleep(400);
			expect(statusCalls.length).toBe(before);
		});

		it("turn_end refreshes immediately (no delay) and cancels the pending delayed refresh", async () => {
			await boot({ refreshMs: 60_000 });
			const before = statusCalls.length;
			appendFileSync(sessionFile, line(4000));
			handlers.message_end(assistant, ctx()); // schedules a (very late) refresh
			handlers.turn_end({}, ctx());
			await sleep(60);
			expect(lastStatus()).toContain("5.0k");
			expect(statusCalls.length).toBe(before + 1);
		});

		it("liveRefresh=false: messages do nothing, turn_end still refreshes", async () => {
			await boot({ liveRefresh: false });
			const before = statusCalls.length;
			appendFileSync(sessionFile, line(1000));
			handlers.message_end(assistant, ctx());
			await sleep(400);
			expect(statusCalls.length).toBe(before);
			handlers.turn_end({}, ctx());
			await sleep(60);
			expect(lastStatus()).toContain("2.0k");
		});

		it("session_shutdown cancels a pending refresh (no stale-context use after a reload)", async () => {
			await boot();
			const before = statusCalls.length;
			appendFileSync(sessionFile, line(1000));
			handlers.message_end(assistant, ctx());
			await handlers.session_shutdown({ reason: "reload" });
			await sleep(400);
			expect(statusCalls.length).toBe(before);
		});

		it("works without a UI and never throws", async () => {
			await boot();
			expect(() => handlers.message_end(assistant, ctx(false))).not.toThrow();
			await sleep(350);
		});

		it("each live refresh reads only what was appended", async () => {
			await boot();
			resetStats();
			appendFileSync(sessionFile, line(7));
			handlers.message_end(assistant, ctx());
			await sleep(400);
			expect(stats.incrementalParses).toBe(1);
			expect(stats.fullParses).toBe(0);
			expect(stats.bytesRead).toBeLessThan(2048);
		});
	});

	describe("/tokenburn disable and enable", () => {
		it("disable clears the status line and panel, persists, and says what it does", async () => {
			await boot({ showWidget: true });
			expect(lastStatus()).toContain("🔥");
			await command.handler("disable", ctx());
			expect(lastStatus()).toBe("");
			expect(widgetCalls.at(-1)).toEqual([]);
			expect(cfgFile().enabled).toBe(false);
			expect(notes.at(-1)).toContain("tokenburn disabled");
			expect(notes.at(-1)).toContain("/tokenburn enable");
		});

		it("while disabled NOTHING runs: no status, no panel, no disk reads, no timers", async () => {
			await boot();
			await command.handler("disable", ctx());
			resetStats();
			statusCalls.length = 0;
			appendFileSync(sessionFile, line(5000));
			for (let i = 0; i < 10; i++) handlers.message_end(assistant, ctx());
			handlers.turn_end({}, ctx());
			await sleep(400);
			expect(statusCalls).toEqual([]);
			expect(stats.bytesRead).toBe(0);
		});

		it("a disabled config at startup shows nothing and reads nothing", async () => {
			resetStats();
			await boot({ enabled: false, showWidget: true });
			expect(lastStatus()).toBe("");
			expect(widgetCalls.at(-1)).toEqual([]);
			expect(stats.bytesRead).toBe(0);
		});

		it("enable brings everything back and persists", async () => {
			await boot({ enabled: false });
			await command.handler("enable", ctx());
			expect(lastStatus()).toContain("1.0k");
			expect(cfgFile().enabled).toBe(true);
			expect(notes.at(-1)).toBe("tokenburn enabled");
			// and live refresh works again
			appendFileSync(sessionFile, line(1000));
			handlers.message_end(assistant, ctx());
			await sleep(400);
			expect(lastStatus()).toContain("2.0k");
		});

		it("on / off are aliases", async () => {
			await boot();
			await command.handler("off", ctx());
			expect(lastStatus()).toBe("");
			await command.handler("on", ctx());
			expect(lastStatus()).toContain("🔥");
		});

		it("both are idempotent and say so", async () => {
			await boot();
			await command.handler("enable", ctx());
			expect(notes.at(-1)).toBe("tokenburn is already enabled");
			await command.handler("disable", ctx());
			await command.handler("disable", ctx());
			expect(notes.at(-1)).toBe("tokenburn is already disabled");
		});

		it("a pending live refresh is cancelled by disable", async () => {
			await boot();
			appendFileSync(sessionFile, line(1000));
			handlers.message_end(assistant, ctx());
			await command.handler("disable", ctx());
			statusCalls.length = 0;
			await sleep(400);
			expect(statusCalls).toEqual([]);
		});

		it("settings changed while disabled are kept, with a hint, and shown after enable", async () => {
			await boot();
			await command.handler("disable", ctx());
			await command.handler("week", ctx());
			expect(notes.at(-1)).toContain("status window: week");
			expect(notes.at(-1)).toContain("tokenburn is disabled");
			expect(lastStatus()).toBe("");
			await command.handler("budget day 5", ctx());
			expect(notes.at(-1)).toContain("disabled");
			await command.handler("window", ctx());
			expect(notes.at(-1)).toContain("disabled");
			await command.handler("enable", ctx());
			expect(lastStatus()).toContain("[week]");
			expect(widgetCalls.at(-1)!.length).toBeGreaterThan(3);
		});

		it("charts and reports still work on demand while disabled", async () => {
			await boot();
			await command.handler("disable", ctx());
			await command.handler("chart month", ctx());
			expect(notes.at(-1)).toContain("Monthly tokens");
			await command.handler("", ctx());
			expect(notes.at(-1)).toContain("TokenBurn Report");
			expect(lastStatus()).toBe("");
		});
	});

	describe("/tokenburn live", () => {
		it("toggles live refresh, persists it, and cancels a pending refresh when turned off", async () => {
			await boot();
			await command.handler("live", ctx());
			expect(notes.at(-1)).toContain("live refresh off");
			expect(cfgFile().liveRefresh).toBe(false);
			const before = statusCalls.length;
			appendFileSync(sessionFile, line(1000));
			handlers.message_end(assistant, ctx());
			await sleep(400);
			expect(statusCalls.length).toBe(before);

			await command.handler("live", ctx());
			expect(notes.at(-1)).toContain("live refresh on");
			expect(cfgFile().liveRefresh).toBe(true);
			handlers.message_end(assistant, ctx());
			await command.handler("live", ctx()); // off again while a refresh is pending
			const calls = statusCalls.length;
			await sleep(400);
			expect(statusCalls.length).toBe(calls);
		});
	});

	describe("config", () => {
		it("sanitizeRefreshMs clamps to 250..60000 and falls back for junk", () => {
			expect(sanitizeRefreshMs(1)).toBe(250);
			expect(sanitizeRefreshMs(250)).toBe(250);
			expect(sanitizeRefreshMs(750.4)).toBe(750);
			expect(sanitizeRefreshMs(9_999_999)).toBe(60_000);
			for (const junk of ["fast", NaN, Infinity, null, undefined, {}, []]) expect(sanitizeRefreshMs(junk)).toBe(750);
		});

		it("enabled, liveRefresh and refreshMs load from the config file; junk falls back to defaults", async () => {
			await boot({ enabled: "yes", liveRefresh: 1, refreshMs: "soon" });
			expect(lastStatus()).toContain("🔥"); // enabled defaulted to true
			appendFileSync(sessionFile, line(1000));
			handlers.message_end(assistant, ctx()); // liveRefresh defaulted to true, refreshMs to 750
			await sleep(1000);
			expect(lastStatus()).toContain("2.0k");
		});
	});
});
