import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, appendFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tokenBurn, {
	applyPricing, budgetWarnings, burnRate, cacheHitRatio, cacheSavings, clearCache, collectExport, collectGroups, collectPricing, collectUsage,
	completions, csvCell, describeFilter, forecastLines, formatExport, formatWhen, freshConfig, hasFilter, matchesFilter, nextBucket, parseCommand,
	periodStart, project, statSavings, statusExtras, windowRate, windowStart, renderPricing, renderTable, sanitizeFilter, sanitizePrices, sanitizeWarnPct, selectTurns, sessionSummary, shortPath, stamp, sumRows,
	__loadAllForTests,
} from "../extensions/tokenburn.ts";

const NOW = new Date(2026, 9, 14, 12, 0, 0); // Wed 2026-10-14 12:00 local

function line(ts: Date, o: { provider?: string; model?: string; input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: number; costInput?: number; costCacheRead?: number } = {}) {
	return JSON.stringify({
		type: "message",
		timestamp: ts.toISOString(),
		message: {
			role: "assistant",
			provider: o.provider ?? "anthropic",
			model: o.model ?? "opus",
			usage: {
				input: o.input ?? 100, output: o.output ?? 50, cacheRead: o.cacheRead ?? 0, cacheWrite: o.cacheWrite ?? 0,
				cost: { total: o.cost ?? 1, input: o.costInput ?? 0.5, cacheRead: o.costCacheRead ?? 0 },
			},
		},
	});
}
const header = (cwd: string) => JSON.stringify({ type: "session", version: 3, id: "x", timestamp: NOW.toISOString(), cwd });

describe("tokenburn features", () => {
	let dir: string;
	beforeEach(() => {
		clearCache();
		dir = mkdtempSync(join(tmpdir(), "pi-tb-feat-"));
		mkdirSync(join(dir, "a"), { recursive: true });
		mkdirSync(join(dir, "b"), { recursive: true });
		// session A: project /w/alpha, anthropic/opus (cached) + openai/gpt
		writeFileSync(
			join(dir, "a", "a.jsonl"),
			[
				header("/w/alpha"),
				line(new Date(2026, 9, 14, 11, 30), { cost: 2, input: 10, costInput: 0.00003, cacheRead: 1000, costCacheRead: 0.0001, output: 5 }),
				line(new Date(2026, 9, 14, 9, 0), { provider: "openai", model: "gpt", cost: 0.5 }),
				line(new Date(2026, 9, 13, 9, 0), { cost: 1 }),
			].join("\n") + "\n",
		);
		// session B: no header (falls back to dir name), a zero-cost model
		writeFileSync(
			join(dir, "b", "b.jsonl"),
			[line(new Date(2026, 9, 14, 10, 0), { provider: "local", model: "llama", cost: 0, input: 1000, output: 1000 })].join("\n") + "\n",
		);
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	describe("parser metadata", () => {
		it("reads provider, model and project (cwd, or the session dir as fallback)", async () => {
			const per = await __loadAllForTests(dir);
			const turns = per.flat();
			expect(turns.find((t) => t.model === "gpt")!.project).toBe("/w/alpha");
			expect(turns.find((t) => t.model === "llama")!.project).toBe("b");
			expect(turns.find((t) => t.model === "llama")!.provider).toBe("local");
		});

		it("keeps the cwd across incremental appends; missing provider/model become unknown", async () => {
			await __loadAllForTests(dir);
			appendFileSync(join(dir, "a", "a.jsonl"), JSON.stringify({ timestamp: NOW.toISOString(), message: { usage: { input: 1, output: 1 } } }) + "\n");
			const turns = (await __loadAllForTests(dir)).flat();
			const added = turns.find((t) => t.provider === "unknown")!;
			expect(added.model).toBe("unknown");
			expect(added.project).toBe("/w/alpha");
		});

		it("ignores a malformed header line", async () => {
			mkdirSync(join(dir, "c"));
			writeFileSync(join(dir, "c", "c.jsonl"), '{"type":"session", broken\n' + line(NOW) + "\n");
			const turns = (await __loadAllForTests(dir)).flat();
			expect(turns.some((t) => t.project === "c")).toBe(true);
		});
	});

	describe("filter + groups", () => {
		it("matches case-insensitive substrings and describes the filter", () => {
			const t = { provider: "Anthropic", model: "opus-4", project: "/w/alpha" } as any;
			expect(matchesFilter(t, undefined)).toBe(true);
			expect(matchesFilter(t, { provider: "anthro", model: "OPUS" })).toBe(true);
			expect(matchesFilter(t, { project: "beta" })).toBe(false);
			expect(hasFilter({})).toBe(false);
			expect(hasFilter({ model: "x" })).toBe(true);
			expect(describeFilter({ provider: "a", model: "b" })).toBe("provider=a model=b");
			expect(describeFilter(undefined)).toBe("");
		});

		it("sanitizeFilter keeps only non-empty strings of known keys", () => {
			expect(sanitizeFilter({ provider: " x ", model: "", project: 3, junk: "y" })).toEqual({ provider: "x" });
			for (const v of [null, 1, "s", [1]]) expect(sanitizeFilter(v)).toEqual({});
		});

		it("groups by model, provider, project and session, biggest cost first", async () => {
			const models = await collectGroups(dir, "model", "all", NOW);
			expect(models.map((r) => r.key)).toEqual(["anthropic/opus", "openai/gpt", "local/llama"]);
			expect(models[0].cost).toBe(3);
			expect(models[0].turns).toBe(2);
			const providers = await collectGroups(dir, "provider", "all", NOW);
			expect(providers.map((r) => r.key)).toEqual(["anthropic", "openai", "local"]);
			expect(providers[0].model).toBe("");
			const projects = await collectGroups(dir, "project", "all", NOW);
			expect(projects.map((r) => r.key).sort()).toEqual(["/w/alpha", "b"]);
			const sessions = await collectGroups(dir, "session", "all", NOW);
			expect(sessions).toHaveLength(2);
			expect(sessions[0].session).toContain("a.jsonl");
			expect(sessions[0].sessions).toBe(1);
		});

		it("respects the period (hour = rolling 60 min) and the filter", async () => {
			expect((await collectGroups(dir, "model", "hour", NOW)).map((r) => r.key)).toEqual(["anthropic/opus"]);
			expect((await collectGroups(dir, "model", "day", NOW)).reduce((a, r) => a + r.turns, 0)).toBe(3);
			expect((await collectGroups(dir, "model", "all", NOW, true, { filter: { provider: "openai" } })).map((r) => r.key)).toEqual(["openai/gpt"]);
			expect(await collectGroups(dir, "model", "all", NOW, true, { filter: { provider: "nope" } })).toEqual([]);
		});

		it("periodStart", () => {
			const n = NOW.getTime();
			expect(periodStart(n, "hour")).toBe(n - 3_600_000);
			expect(periodStart(n, "all")).toBe(0);
			expect(periodStart(n, "day")).toBe(new Date(2026, 9, 14).getTime());
			expect(periodStart(n, "week")).toBe(new Date(2026, 9, 12).getTime());
		});

		it("applies the filter to collectUsage and tracks the rolling hour", async () => {
			const all = await collectUsage(dir, NOW);
			expect(all.hour.cost).toBe(2);
			expect(burnRate(all.hour)).toEqual({ tokensPerHour: all.hour.tokens, costPerHour: 2 });
			const f = await collectUsage(dir, NOW, true, { filter: { model: "gpt" } });
			expect(f.total.cost).toBe(0.5);
			expect(f.total.sessions).toBe(1);
		});

		it("sums rows", async () => {
			const rows = await collectGroups(dir, "model", "all", NOW);
			const t = sumRows(rows);
			expect(t.cost).toBe(3.5);
			expect(t.turns).toBe(4);
			expect(sumRows([]).first).toBe(Infinity);
		});
	});

	describe("cache efficiency", () => {
		it("hit ratio and savings estimate", async () => {
			const [opus] = await collectGroups(dir, "model", "hour", NOW);
			// 1000 cached tokens priced like input (0.00003 / 10 per token = 3e-6) = 0.003; paid 0.0001
			expect(cacheSavings(opus)).toBeCloseTo(0.0029, 6);
			expect(cacheHitRatio(opus)).toBeCloseTo(1000 / 1010, 6);
			expect(cacheHitRatio({ input: 0, cacheRead: 0, cacheWrite: 0 })).toBe(0);
			expect(cacheSavings({ cacheBase: 1, cacheActual: 5 } as any)).toBe(0);
		});
	});

	describe("pricing", () => {
		const turn = { provider: "local", model: "llama", input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 0, cost: 0, costInput: 0, costCacheRead: 0 } as any;

		it("sanitizePrices defaults cache prices to the input price and drops junk", () => {
			expect(sanitizePrices({ a: { input: 1, output: 2 }, b: { input: 1 }, c: { input: -1, output: 1 }, d: null, e: 5, f: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 3 } })).toEqual({
				a: { input: 1, output: 2, cacheRead: 1, cacheWrite: 1 },
				f: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 3 },
			});
			for (const v of [null, 1, [1]]) expect(sanitizePrices(v)).toEqual({});
		});

		it("fill mode prices only zero-cost turns; override replaces the log cost; provider/model key wins", () => {
			const prices = sanitizePrices({ llama: { input: 1, output: 2, cacheRead: 0.5 }, "local/llama": { input: 10, output: 20, cacheRead: 5 } });
			const filled = applyPricing(turn, prices, "fill");
			expect(filled.source).toBe("table");
			expect(filled.turn.cost).toBe(10 + 20 + 5);
			expect(filled.turn.costInput).toBe(10);
			expect(applyPricing({ ...turn, cost: 3 }, prices, "fill").source).toBe("log");
			expect(applyPricing({ ...turn, cost: 3 }, prices, "override").turn.cost).toBe(35);
			expect(applyPricing(turn, undefined).source).toBe("log");
			expect(applyPricing({ ...turn, model: "other" }, prices).source).toBe("log");
		});

		it("selectTurns is a no-op without filter or prices", () => {
			const turns = [turn];
			expect(selectTurns(turns, undefined)).toBe(turns);
			expect(selectTurns(turns, {})).toBe(turns);
			expect(selectTurns(turns, { prices: {} })).toBe(turns);
		});

		it("a price table fills the cost of unpriced models in totals", async () => {
			const prices = sanitizePrices({ llama: { input: 1, output: 2 } });
			const r = await collectUsage(dir, NOW, true, { prices });
			expect(r.total.cost).toBeCloseTo(3.5 + (1000 * 1 + 1000 * 2) / 1e6, 9);
		});

		it("reports cost sources and unpriced models", async () => {
			mkdirSync(join(dir, "d"));
			writeFileSync(join(dir, "d", "d.jsonl"), line(NOW, { provider: "local", model: "tiny", cost: 0, input: 1, output: 1 }) + "\n");
			const none = await collectPricing(dir, {}, "fill");
			expect(none.unpriced.map((u) => u.model)).toEqual(["local/llama", "local/tiny"]);
			expect(none.tableTurns).toBe(0);
			const text = renderPricing(none, {}, "fill").join("\n");
			expect(text).toContain("unpriced");
			expect(text).toContain("price table: empty");
			const prices = sanitizePrices({ llama: { input: 1, output: 2 } });
			const priced = await collectPricing(dir, prices, "override", { model: "llama" });
			expect(priced.tableTurns).toBe(1);
			expect(priced.unpriced).toEqual([]);
			const t2 = renderPricing(priced, prices, "override").join("\n");
			expect(t2).toContain("llama: 1 / 2 / 1 / 1");
			expect(t2).toContain("overrides");
		});
	});

	describe("tables", () => {
		it("renders a model table with totals, shares and cache columns", async () => {
			const rows = await collectGroups(dir, "model", "all", NOW);
			const out = renderTable("model", rows, "all").join("\n");
			expect(out).toContain("Models · all time");
			expect(out).toContain("opus");
			expect(out).toContain("anthropic");
			expect(out).toContain("total");
			expect(out).toContain("cache hit");
			expect(out).toContain("█");
		});

		it("renders every grouping, a limit line, a filter note and the empty state", async () => {
			for (const by of ["provider", "project", "session"] as const) {
				const rows = await collectGroups(dir, by, "all", NOW);
				expect(renderTable(by, rows, "week").join("\n").length).toBeGreaterThan(20);
			}
			const rows = await collectGroups(dir, "model", "all", NOW);
			const limited = renderTable("model", rows, "all", { limit: 1, filterText: "provider=x" }).join("\n");
			expect(limited).toContain("2 more");
			expect(limited).toContain("provider=x");
			expect(renderTable("model", [], "hour").join("\n")).toContain("no usage");
		});

		it("uses tokens for the share bar when nothing has a cost, and paints", async () => {
			const rows = await collectGroups(dir, "model", "all", NOW, true, { filter: { provider: "local" } });
			const painted = renderTable("model", rows, "all", { paint: (k, t) => `<${k}>${t}` }).join("\n");
			expect(painted).toContain("<title>");
			expect(painted).toContain("█");
		});

		it("shortPath / stamp / sessionSummary", () => {
			expect(shortPath("/Users/x/p", "/Users/x")).toBe("~/p");
			expect(shortPath("/other/p", "/Users/x")).toBe("/other/p");
			expect(stamp(NOW.getTime())).toBe("2026-10-14 12:00");
			expect(stamp(NaN)).toBe("-");
			expect(sessionSummary("/x/s.jsonl", undefined, 1)).toContain("no usage yet");
			const row = { tokens: 1500, cost: 1, turns: 2, input: 5, cacheRead: 5, cacheWrite: 0 } as any;
			expect(sessionSummary("f", row, 4)).toContain("25% of today");
			expect(sessionSummary("f", row, 0)).not.toContain("of today");
		});
	});

	describe("forecast + warnings", () => {
		const cfg = () => ({ ...freshConfig(), budgets: { weekTokens: 1000 as number | undefined, dayCost: 10 as number | undefined } });
		const stat = (tokens: number, cost = 0) => ({ tokens, cost, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, sessions: 0 });
		const rep = (week: number, dayCost = 0) => ({ hour: stat(0), today: stat(0, dayCost), week: stat(week), month: stat(0), year: stat(0), total: stat(0) });
		const n = NOW.getTime();

		it("projects when the budget runs out", () => {
			const start = new Date(2026, 9, 12).getTime();
			const end = nextBucket(start, "week");
			expect(end).toBe(new Date(2026, 9, 19).getTime());
			expect(project(0, 10, start, end, n)).toBeUndefined();
			expect(project(5, 10, n, end, n)).toBeUndefined();
			expect(project(5, 0, start, end, n)).toBeUndefined();
			const p = project(500, 1000, start, end, n)!;
			expect(p.ratio).toBe(0.5);
			expect(p.exhaustAt).toBeGreaterThan(n);
			expect(project(10, 1000, start, end, n)!.exhaustAt).toBeUndefined();
			expect(project(2000, 1000, start, end, n)!.exhaustAt).toBeUndefined();
		});

		it("nextBucket for day and month", () => {
			expect(nextBucket(new Date(2026, 9, 14).getTime(), "day")).toBe(new Date(2026, 9, 15).getTime());
			expect(nextBucket(new Date(2026, 9, 1).getTime(), "month")).toBe(new Date(2026, 10, 1).getTime());
		});

		it("formatWhen", () => {
			expect(formatWhen(new Date(2026, 9, 14, 14, 5).getTime(), n)).toBe("today 14:05");
			expect(formatWhen(new Date(2026, 9, 15, 9, 0).getTime(), n)).toBe("tomorrow 09:00");
			expect(formatWhen(new Date(2026, 9, 17, 9, 0).getTime(), n)).toBe("Sat 09:00");
		});

		it("describes pace, on-track and over for token and cost budgets", () => {
			const lines = forecastLines(rep(500, 12) as any, cfg() as any, n).join("\n");
			expect(lines).toContain("weekly tokens budget: 50% of 1.0k tokens used; at this pace it runs out");
			expect(lines).toContain("daily cost budget: 120% of $10.00 used (over)");
			expect(forecastLines(rep(1) as any, cfg() as any, n).join("\n")).toContain("on track");
			expect(forecastLines(rep(0) as any, cfg() as any, n)).toEqual([]);
			expect(forecastLines(rep(5) as any, freshConfig(), n)).toEqual([]);
		});

		it("warns at the threshold and when over, with once-per-bucket ids", () => {
			const c = cfg() as any;
			expect(budgetWarnings(rep(700) as any, c, n)).toEqual([]);
			const w = budgetWarnings(rep(800, 5) as any, c, n);
			expect(w).toHaveLength(1);
			expect(w[0].level).toBe("warn");
			expect(w[0].message).toContain("80% of the weekly tokens budget");
			const over = budgetWarnings(rep(1200) as any, c, n);
			expect(over[0].level).toBe("over");
			expect(over[0].id).not.toBe(w[0].id);
			expect(budgetWarnings(rep(800) as any, { ...c, warnPct: 0 }, n)).toEqual([]);
			expect(budgetWarnings(rep(1) as any, freshConfig(), n)).toEqual([]);
			expect(budgetWarnings(rep(900, 9) as any, c, n).map((x) => x.message).join()).toContain("$9.00");
		});

		it("sanitizeWarnPct", () => {
			expect(sanitizeWarnPct(50)).toBe(50);
			expect(sanitizeWarnPct(500)).toBe(100);
			expect(sanitizeWarnPct(-1)).toBe(0);
			expect(sanitizeWarnPct("x")).toBe(80);
			expect(sanitizeWarnPct(NaN)).toBe(80);
		});
	});

	describe("status line extras follow the status window", () => {
		const stat = (o: any = {}) => ({ tokens: 2400, cost: 1, input: 10, output: 5, cacheRead: 90, cacheWrite: 0, sessions: 1, cacheBase: 0.5, cacheActual: 0.1, ...o });
		const n = NOW.getTime();
		const rep = (o: any = {}) => ({ hour: stat({ tokens: 100 }), today: stat(), week: stat({ tokens: 4800 }), month: stat(), year: stat(), total: stat(), firstTs: n - 24 * 3_600_000, ...o }) as any;
		const cfg = (o: any = {}) => ({ ...freshConfig(), ...o });

		it("windowStart", () => {
			expect(windowStart("hour", n)).toBe(n - 3_600_000);
			expect(windowStart("total", n)).toBe(0);
			expect(windowStart("today", n)).toBe(new Date(2026, 9, 14).getTime());
			expect(windowStart("week", n)).toBe(new Date(2026, 9, 12).getTime());
		});

		it("rate is averaged over the window, from the first turn, at least one hour", () => {
			expect(windowRate(stat({ tokens: 100 }), "hour", undefined, n).tokensPerHour).toBe(100);
			expect(windowRate(stat({ tokens: 1200 }), "today", n - 12 * 3_600_000, n).tokensPerHour).toBe(100); // 12h since midnight
			expect(windowRate(stat({ tokens: 1200 }), "week", n - 6 * 3_600_000, n).tokensPerHour).toBe(200); // first turn 6h ago
			expect(windowRate(stat({ tokens: 50 }), "today", n - 60_000, n).tokensPerHour).toBe(50); // < 1h floors at 1h
			expect(windowRate(stat({ tokens: 50, cost: 3 }), "total", undefined, n).costPerHour).toBe(3);
		});

		it("shows rate, hit ratio and savings for the selected window, each toggleable", () => {
			expect(statSavings(stat())).toBeCloseTo(0.4, 9);
			expect(statusExtras(rep(), cfg({ statusWindow: "hour" }), n)).toEqual(["100/h", "90% hit", "~$0.40 saved"]);
			expect(statusExtras(rep(), cfg({ statusWindow: "week" }), n)[0]).toBe("200/h"); // 4800 tokens over the 24h since the first turn
			expect(statusExtras(rep(), cfg({ statusWindow: "hour", showRate: false }), n)).toEqual(["90% hit", "~$0.40 saved"]);
			expect(statusExtras(rep(), cfg({ statusWindow: "hour", showHit: false }), n)).toEqual(["100/h", "~$0.40 saved"]);
			expect(statusExtras(rep(), cfg({ statusWindow: "hour", showSaved: false }), n)).toEqual(["100/h", "90% hit"]);
			expect(statusExtras(rep(), cfg({ statusWindow: "hour", showRate: false, showHit: false, showSaved: false }), n)).toEqual([]);
		});

		it("omits what is meaningless (no tokens, no prompt, no savings)", () => {
			const empty = stat({ tokens: 0, input: 0, cacheRead: 0, cacheBase: 0, cacheActual: 0 });
			expect(statusExtras(rep({ hour: empty }), cfg({ statusWindow: "hour" }), n)).toEqual([]);
		});
	});

	describe("export", () => {
		it("aggregates per day x provider x model x project, sorted", async () => {
			const rows = await collectExport(dir, "all", NOW);
			expect(rows).toHaveLength(4);
			expect(rows[0].date).toBe("2026-10-13");
			expect(rows.find((r) => r.model === "opus" && r.date === "2026-10-14")!.cost).toBe(2);
			expect((await collectExport(dir, "hour", NOW)).length).toBe(1);
			expect((await collectExport(dir, "all", NOW, { filter: { model: "gpt" } })).length).toBe(1);
		});

		it("formats CSV (quoting, formula-injection guard) and JSON", () => {
			expect(csvCell("plain")).toBe("plain");
			expect(csvCell('a,"b"')).toBe('"a,""b"""');
			expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
			expect(csvCell(3)).toBe("3");
			expect(csvCell(0.1234567)).toBe("0.123457");
			const row = { date: "d", provider: "p", model: "m", project: "x,y", turns: 1, input: 2, output: 3, cacheRead: 4, cacheWrite: 5, cost: 1.5 };
			const csv = formatExport([row], "csv");
			expect(csv.split("\n")[0]).toBe("date,provider,model,project,turns,input,output,cacheRead,cacheWrite,cost");
			expect(csv.split("\n")[1]).toBe('d,p,m,"x,y",1,2,3,4,5,1.500000');
			expect(JSON.parse(formatExport([row], "json"))).toEqual([row]);
		});
	});

	describe("parseCommand (new commands)", () => {
		it("tables default to all time and take period, limit and filters", () => {
			expect(parseCommand("models")).toEqual({ kind: "table", by: "model", period: "all", filter: {}, limit: undefined });
			expect(parseCommand("provider week")).toEqual({ kind: "table", by: "provider", period: "week", filter: {}, limit: undefined });
			expect(parseCommand("projects hour")).toMatchObject({ by: "project", period: "hour" });
			expect(parseCommand("sessions")).toMatchObject({ by: "session", limit: 10 });
			expect(parseCommand("top today 3")).toMatchObject({ by: "session", period: "day", limit: 3 });
			expect(parseCommand("models total provider=Anthropic model=opus")).toMatchObject({ period: "all", filter: { provider: "Anthropic", model: "opus" } });
			expect(parseCommand("models bogus").kind).toBe("invalid");
			expect(parseCommand("models foo=bar").kind).toBe("invalid");
			expect(parseCommand("models model=").kind).toBe("invalid");
		});

		it("filter", () => {
			expect(parseCommand("filter")).toEqual({ kind: "filter" });
			expect(parseCommand("filter clear")).toEqual({ kind: "filter", clear: true });
			expect(parseCommand("filter all")).toEqual({ kind: "filter", clear: true });
			expect(parseCommand("filter provider Anthropic")).toEqual({ kind: "filter", key: "provider", value: "Anthropic" });
			expect(parseCommand("filter model all")).toEqual({ kind: "filter", key: "model", value: undefined });
			expect(parseCommand("filter project my proj")).toMatchObject({ value: "my proj" });
			expect(parseCommand("filter bogus x").kind).toBe("invalid");
			expect(parseCommand("filter model").kind).toBe("invalid");
		});

		it("export / warn / pricing / price / rate / session", () => {
			expect(parseCommand("export csv")).toEqual({ kind: "export", format: "csv", period: "all", path: undefined });
			expect(parseCommand("export json week out/My File.json")).toEqual({ kind: "export", format: "json", period: "week", path: "out/My File.json" });
			expect(parseCommand("export csv Out.csv")).toMatchObject({ period: "all", path: "Out.csv" });
			expect(parseCommand("export xml").kind).toBe("invalid");
			expect(parseCommand("warn 90")).toEqual({ kind: "warn", pct: 90 });
			expect(parseCommand("warn off")).toEqual({ kind: "warn", pct: 0 });
			for (const bad of ["warn", "warn x", "warn 101", "warn -1"]) expect(parseCommand(bad).kind).toBe("invalid");
			expect(parseCommand("pricing")).toEqual({ kind: "pricing" });
			expect(parseCommand("pricing mode override")).toEqual({ kind: "pricing", mode: "override" });
			expect(parseCommand("pricing mode x").kind).toBe("invalid");
			expect(parseCommand("pricing foo").kind).toBe("invalid");
			expect(parseCommand("price Llama 1 $2")).toEqual({ kind: "price", model: "Llama", input: 1, output: 2, cacheRead: undefined, cacheWrite: undefined });
			expect(parseCommand("price a/b 1 2 0.5 3")).toMatchObject({ cacheRead: 0.5, cacheWrite: 3 });
			expect(parseCommand("price remove Llama")).toEqual({ kind: "price", model: "Llama", remove: true });
			for (const bad of ["price", "price m", "price m 1", "price m x 2", "price m -1 2"]) expect(parseCommand(bad).kind).toBe("invalid");
			expect(parseCommand("rate")).toEqual({ kind: "rate" });
			expect(parseCommand("hit")).toEqual({ kind: "hit" });
			expect(parseCommand("saved")).toEqual({ kind: "saved" });
			expect(parseCommand("hour")).toEqual({ kind: "status", window: "hour" });
			expect(parseCommand("session")).toEqual({ kind: "session" });
		});

		it("completes the new commands and their arguments", () => {
			const top = completions("")!.map((i) => i.label);
			for (const w of ["models", "providers", "projects", "sessions", "session", "filter", "export", "warn", "pricing", "price", "rate", "hit", "saved", "hour"]) expect(top).toContain(w);
			expect(completions("models ")!.map((i) => i.label)).toContain("hour");
			expect(completions("models ")!.map((i) => i.label)).not.toContain("today");
			expect(completions("filter ")!.map((i) => i.label)).toEqual(["provider", "model", "project", "all"]);
			expect(completions("export ")!.map((i) => i.label)).toEqual(["csv", "json"]);
			expect(completions("export csv ")).toBeNull();
		});
	});

	describe("extension wiring", () => {
		let agent: string;
		let prev: string | undefined;
		let handlers: Record<string, Function>;
		let command: any;
		let status: string;
		let notes: string[];
		let sessionFile: string | undefined;
		const ctx = () => ({
			hasUI: true,
			cwd: dir,
			sessionManager: { getSessionFile: () => sessionFile },
			ui: { theme: { fg: (_c: string, t: string) => t }, setStatus: (_k: string, v: string) => (status = v), setWidget() {}, notify: (m: string) => notes.push(m) },
		});

		beforeEach(async () => {
			prev = process.env.PI_CODING_AGENT_DIR;
			agent = mkdtempSync(join(tmpdir(), "pi-tb-agent-"));
			process.env.PI_CODING_AGENT_DIR = agent;
			// put "now" data into the real sessions dir the extension reads
			mkdirSync(join(agent, "sessions", "p"), { recursive: true });
			sessionFile = join(agent, "sessions", "p", "cur.jsonl");
			writeFileSync(
				sessionFile,
				[header("/w/cur"), line(new Date(), { cost: 4, input: 1000, output: 1000, cacheRead: 500, costInput: 0.001 })].join("\n") + "\n",
			);
			clearCache();
			handlers = {};
			notes = [];
			status = "";
			tokenBurn({ on: (e: string, f: Function) => (handlers[e] = f), registerCommand: (_: string, c: any) => (command = c) } as any);
			await handlers.session_start({}, ctx());
		});
		afterEach(() => {
			if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = prev;
			rmSync(agent, { recursive: true, force: true });
		});
		const run = async (a: string) => {
			notes.length = 0;
			await command.handler(a, ctx());
			return notes.join("\n");
		};

		it("shows the burn rate in the status line, and `rate` toggles it", async () => {
			expect(status).toMatch(/\/h/);
			await run("rate");
			expect(status).not.toMatch(/\/h/);
			expect(await run("rate")).toContain("on");
			expect(status).toMatch(/\/h/);
		});

		it("prints tables for models, providers, projects, sessions", async () => {
			expect(await run("models")).toContain("Models · all time");
			expect(await run("providers week")).toContain("Providers · this week");
			expect(await run("projects")).toContain("/w/cur");
			expect(await run("sessions 5")).toContain("Top sessions");
			expect(await run("models provider=zzz")).toContain("no usage");
		});

		it("persistent filter narrows everything and shows in the status line", async () => {
			expect(await run("filter")).toContain("none");
			expect(await run("filter provider zzz")).toContain("provider=zzz");
			expect(status).toContain("provider=zzz");
			expect(await run("filter")).toContain("provider=zzz");
			expect(await run("")).toContain("provider=zzz");
			expect(await run("models")).toContain("no usage");
			expect(JSON.parse(readFileSync(join(agent, "tokenburn.json"), "utf8")).filter).toEqual({ provider: "zzz" });
			expect(await run("filter provider all")).toContain("cleared");
			await run("filter model x");
			expect(await run("filter clear")).toContain("cleared");
			expect(status).not.toContain("model=");
		});

		it("the report includes burn rate, cache efficiency and the budget forecast", async () => {
			await run("budget day $100");
			const out = await run("");
			expect(out).toContain("burn rate:");
			expect(out).toContain("% of prompt tokens read from cache");
			expect(out).toContain("daily cost budget: 4% of $100.00 used");
		});

		it("reports the current session, or explains when there is no file", async () => {
			expect(await run("session")).toContain("This session:");
			sessionFile = undefined;
			expect(await run("session")).toContain("no log file");
			sessionFile = join(agent, "sessions", "p", "none.jsonl");
			expect(await run("session")).toContain("no usage yet");
		});

		it("exports csv and json into the cwd (or a given path) and reports failures", async () => {
			expect(await run("export csv")).toContain("tokenburn-all.csv");
			expect(readFileSync(join(dir, "tokenburn-all.csv"), "utf8")).toContain("provider");
			expect(await run("export json day out.json")).toContain("exported");
			expect(JSON.parse(readFileSync(join(dir, "out.json"), "utf8"))[0].project).toBe("/w/cur");
			expect(await run("export csv /nonexistent-dir-xyz/a.csv")).toContain("export failed");
			expect(existsSync(join(dir, "tokenburn-all.csv"))).toBe(true);
		});

		it("warns once at the threshold, again only after crossing over, and honours `warn`", async () => {
			notes.length = 0;
			await command.handler("budget day $5", ctx()); // 4/5 = 80%
			expect(notes.filter((n) => n.includes("80% of the daily cost budget")).length).toBe(1);
			notes.length = 0;
			await handlers.turn_end({}, ctx());
			await new Promise((r) => setTimeout(r, 30));
			expect(notes.filter((n) => n.includes("daily cost budget"))).toEqual([]); // not repeated
			await command.handler("budget day $3", ctx());
			expect(notes.join("\n")).toContain("over budget");
			expect(await run("warn off")).toContain("off");
			expect(await run("warn 60")).toContain("60%");
		});

		it("`hit` and `saved` toggle the cache hit ratio and savings in the status line; `hour` is a status window", async () => {
			await run("hour");
			expect(status).toContain("[hour]");
			expect(status).toMatch(/\d+% hit/);
			expect(status).toContain("saved");
			expect(await run("hit")).toContain("off");
			expect(status).not.toContain("% hit");
			expect(status).toContain("saved");
			expect(await run("saved")).toContain("off");
			expect(status).not.toContain("saved");
			expect(await run("hit")).toContain("on");
			expect(await run("saved")).toContain("on");
			expect(status).toContain("% hit");
			const saved = JSON.parse(readFileSync(join(agent, "tokenburn.json"), "utf8"));
			expect(saved).toMatchObject({ showHit: true, showSaved: true });
			await run("day");
			expect(status).toContain("[today]");
		});

		it("pricing: set, show, mode, remove", async () => {
			expect(await run("pricing")).toContain("price table: empty");
			expect(await run("price local/llama 1 2")).toContain("price for local/llama set");
			expect(await run("pricing")).toContain("local/llama: 1 / 2 / 1 / 1");
			expect(await run("pricing mode override")).toContain("mode override");
			expect(await run("price remove local/llama")).toContain("removed");
			expect(await run("price remove local/llama")).toContain("no price");
			const saved = JSON.parse(readFileSync(join(agent, "tokenburn.json"), "utf8"));
			expect(saved.priceMode).toBe("override");
			expect(saved.prices).toEqual({});
		});

		it("loads filter, prices, priceMode, warnPct and showRate from the config file", async () => {
			writeFileSync(join(agent, "tokenburn.json"), JSON.stringify({ filter: { model: "x" }, prices: { m: { input: 1, output: 2 } }, priceMode: "override", warnPct: 50, showRate: false, showHit: false, showSaved: false }));
			await handlers.session_start({}, ctx());
			expect(status).toContain("model=x");
			await run("filter clear");
			const saved = JSON.parse(readFileSync(join(agent, "tokenburn.json"), "utf8"));
			expect(saved).toMatchObject({ priceMode: "override", warnPct: 50, showRate: false, showHit: false, showSaved: false, prices: { m: { input: 1, output: 2, cacheRead: 1, cacheWrite: 1 } } });
		});
	});
});
