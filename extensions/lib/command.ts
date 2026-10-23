/** Command parsing + completions (pure, unit-tested). */
import { EXPORT_FORMATS, type ExportFormat } from "./export.ts";
import { FILTER_KEYS_LIST, type FilterKey, type PriceMode, type UsageFilter } from "./pricing.ts";
import { PERIOD_ALIASES, type GroupBy, type Period } from "./query.ts";
import { STATUS_WINDOWS, type Window } from "./types.ts";

export const REPORT_VIEWS = ["day", "week", "month", "year", "all"] as const;
export type ReportView = (typeof REPORT_VIEWS)[number];
export const BUDGET_PERIODS = ["day", "week", "month"] as const;

export type Command =
	| { kind: "report"; view: ReportView }
	| { kind: "status"; window: Window }
	| { kind: "cycle" }
	| { kind: "window" }
	| { kind: "cache" }
	| { kind: "enable" }
	| { kind: "disable" }
	| { kind: "live" }
	| { kind: "budget"; period: (typeof BUDGET_PERIODS)[number]; amount: number; isCost: boolean }
	| { kind: "rate" }
	| { kind: "hit" }
	| { kind: "saved" }
	| { kind: "session" }
	| { kind: "table"; by: GroupBy; period: Period; filter: UsageFilter; limit?: number }
	| { kind: "filter"; key?: FilterKey; value?: string; clear?: boolean }
	| { kind: "export"; format: ExportFormat; period: Period; path?: string }
	| { kind: "warn"; pct: number }
	| { kind: "pricing"; mode?: PriceMode }
	| { kind: "price"; model: string; input?: number; output?: number; cacheRead?: number; cacheWrite?: number; remove?: boolean }
	| { kind: "invalid"; message: string };

export const USAGE =
	"Usage: /tokenburn [hour|day|week|month|year|all] (status-bar period) · chart [day|week|month|year|all] · status <hour|today|week|month|year|total> · models|providers|projects [hour|day|week|month|year|all] [provider=x model=x project=x] · sessions [period] [n] · session · filter [provider|model|project] <value|all> · export <csv|json> [period] [path] · warn <pct|off> · pricing · price <model> <in> <out> · rate · hit · saved · cycle · window · budget <day|week|month> <tokens|$cost> · cache · live · enable · disable";

/** Words that pick the status-bar period: `day` shows today, `all` shows the all-time total. */
const WORD_TO_WINDOW: Record<string, Window> = {
	hour: "hour",
	day: "today",
	today: "today",
	week: "week",
	month: "month",
	year: "year",
	all: "total",
	total: "total",
};

/** Views the chart can show. */
const asView = (w: string | undefined): ReportView | undefined =>
	w === "today" ? "day" : w === "total" ? "all" : (REPORT_VIEWS as readonly string[]).includes(w ?? "") ? (w as ReportView) : undefined;

const TABLE_WORDS: Record<string, GroupBy> = {
	model: "model", models: "model", provider: "provider", providers: "provider",
	project: "project", projects: "project", sessions: "session", top: "session",
};
const DEFAULT_TOP = 10;

/** `[period] [n] [key=value ...]` after a table command. */
function parseTableArgs(by: GroupBy, rest: string[]): Command {
	let period: Period = "all";
	let limit: number | undefined = by === "session" ? DEFAULT_TOP : undefined;
	const filter: UsageFilter = {};
	for (const raw of rest) {
		const word = raw.toLowerCase();
		const eq = raw.indexOf("=");
		if (eq > 0) {
			const key = word.slice(0, eq) as FilterKey;
			const value = raw.slice(eq + 1);
			if (!FILTER_KEYS_LIST.includes(key) || value === "") return { kind: "invalid", message: `Bad filter "${raw}". Use provider=<x> model=<x> project=<x>` };
			filter[key] = value;
		} else if (PERIOD_ALIASES[word]) period = PERIOD_ALIASES[word];
		else if (/^\d+$/.test(word) && Number(word) > 0) limit = Number(word);
		else return { kind: "invalid", message: `Unknown argument "${raw}". ${USAGE}` };
	}
	return { kind: "table", by, period, filter, limit };
}

export function parseCommand(args: string | undefined): Command {
	const rawParts = (args ?? "").trim().split(/\s+/).filter(Boolean);
	const [cmd, p1, p2] = rawParts.map((p) => p.toLowerCase());
	if (!cmd) return { kind: "report", view: "day" };

	// /tokenburn day|week|month|year|all → what the bottom status line shows
	const window = WORD_TO_WINDOW[cmd];
	if (window) return { kind: "status", window };

	switch (cmd) {
		case "chart":
		case "report": {
			if (p1 === undefined) return { kind: "report", view: "day" };
			const v = asView(p1);
			return v ? { kind: "report", view: v } : { kind: "invalid", message: `Unknown chart "${p1}". ${USAGE}` };
		}
		case "status":
			return (STATUS_WINDOWS as readonly string[]).includes(p1 ?? "")
				? { kind: "status", window: p1 as Window }
				: { kind: "invalid", message: `Usage: /tokenburn status <${STATUS_WINDOWS.join("|")}>` };
		case "cycle":
			return { kind: "cycle" };
		case "window":
		case "widget":
			return { kind: "window" };
		case "cache":
			return { kind: "cache" };
		case "enable":
		case "on":
			return { kind: "enable" };
		case "disable":
		case "off":
			return { kind: "disable" };
		case "live":
			return { kind: "live" };
		case "rate":
			return { kind: "rate" };
		case "hit":
			return { kind: "hit" };
		case "saved":
			return { kind: "saved" };
		case "session":
			return { kind: "session" };
		case "model":
		case "models":
		case "provider":
		case "providers":
		case "project":
		case "projects":
		case "sessions":
		case "top":
			return parseTableArgs(TABLE_WORDS[cmd], rawParts.slice(1));
		case "filter": {
			if (p1 === undefined) return { kind: "filter" };
			if (p1 === "clear" || p1 === "all") return { kind: "filter", clear: true };
			const value = rawParts.slice(2).join(" ");
			if (!FILTER_KEYS_LIST.includes(p1 as FilterKey)) return { kind: "invalid", message: "Usage: /tokenburn filter [provider|model|project] <value | all>" };
			if (value === "") return { kind: "invalid", message: `Usage: /tokenburn filter ${p1} <value | all>` };
			return { kind: "filter", key: p1 as FilterKey, value: value.toLowerCase() === "all" ? undefined : value };
		}
		case "export": {
			if (!(EXPORT_FORMATS as readonly string[]).includes(p1 ?? "")) return { kind: "invalid", message: "Usage: /tokenburn export <csv|json> [hour|day|week|month|year|all] [path]" };
			const rest = rawParts.slice(2);
			const period = rest[0] && PERIOD_ALIASES[rest[0].toLowerCase()];
			return { kind: "export", format: p1 as ExportFormat, period: period || "all", path: (period ? rest.slice(1) : rest).join(" ") || undefined };
		}
		case "warn": {
			const pct = p1 === "off" ? 0 : Number(p1);
			if (!Number.isFinite(pct) || pct < 0 || pct > 100 || p1 === undefined) return { kind: "invalid", message: "Usage: /tokenburn warn <1-100 | off>" };
			return { kind: "warn", pct };
		}
		case "pricing":
			if (p1 === undefined) return { kind: "pricing" };
			if (p1 === "mode" && (p2 === "fill" || p2 === "override")) return { kind: "pricing", mode: p2 };
			return { kind: "invalid", message: "Usage: /tokenburn pricing [mode <fill|override>]" };
		case "price": {
			const model = rawParts[1];
			if (model === undefined) return { kind: "invalid", message: "Usage: /tokenburn price <model | provider/model> <$in/M> <$out/M> [$cacheRead/M] [$cacheWrite/M] · price remove <model>" };
			if (model.toLowerCase() === "remove" && rawParts[2]) return { kind: "price", model: rawParts[2], remove: true };
			const n = rawParts.slice(2, 6).map((v) => Number(v.replace(/^\$/, "")));
			if (n.length < 2 || n.some((v) => !Number.isFinite(v) || v < 0))
				return { kind: "invalid", message: "Usage: /tokenburn price <model | provider/model> <$in/M> <$out/M> [$cacheRead/M] [$cacheWrite/M]" };
			return { kind: "price", model, input: n[0], output: n[1], cacheRead: n[2], cacheWrite: n[3] };
		}
		case "budget": {
			const isCost = (p2 ?? "").startsWith("$");
			const amount = Number((p2 ?? "").replace(/^\$/, ""));
			if (!(BUDGET_PERIODS as readonly string[]).includes(p1 ?? "") || !Number.isFinite(amount) || amount <= 0) {
				return { kind: "invalid", message: "Usage: /tokenburn budget <day|week|month> <tokens | $cost>" };
			}
			return { kind: "budget", period: p1 as (typeof BUDGET_PERIODS)[number], amount, isCost };
		}
		default:
			return { kind: "invalid", message: `Unknown option "${cmd}". ${USAGE}` };
	}
}

export interface CompletionItem {
	value: string;
	/** Required by pi: it calls `label.endsWith(...)` when applying a completion. */
	label: string;
	description?: string;
}

const CHART_SPAN: Record<ReportView, string> = {
	day: "last 14 days",
	week: "last 8 weeks",
	month: "last 6 months",
	year: "last 5 years",
	all: "whole history",
};

const TOP_LEVEL: CompletionItem[] = [
	{ value: "hour", label: "hour", description: "Status bar: last 60 minutes" },
	{ value: "day", label: "day", description: "Status bar: today" },
	{ value: "week", label: "week", description: "Status bar: this week" },
	{ value: "month", label: "month", description: "Status bar: this month" },
	{ value: "year", label: "year", description: "Status bar: this year" },
	{ value: "all", label: "all", description: "Status bar: all-time total" },
	{ value: "chart ", label: "chart", description: "Report + chart: day, week, month, year or all" },
	{ value: "status ", label: "status", description: "Set the status-bar period explicitly" },
	{ value: "models ", label: "models", description: "Table: usage per model (default all time)" },
	{ value: "providers ", label: "providers", description: "Table: usage per provider" },
	{ value: "projects ", label: "projects", description: "Table: usage per project (default all projects)" },
	{ value: "sessions ", label: "sessions", description: "Leaderboard: costliest sessions" },
	{ value: "session", label: "session", description: "Spend of the current session" },
	{ value: "filter ", label: "filter", description: "Limit everything to a provider / model / project" },
	{ value: "export ", label: "export", description: "Write usage to a csv or json file" },
	{ value: "warn ", label: "warn", description: "Budget warning threshold in percent (or off)" },
	{ value: "pricing", label: "pricing", description: "Where costs come from; price table status" },
	{ value: "price ", label: "price", description: "Set a $/M-token price for a model" },
	{ value: "rate", label: "rate", description: "Toggle the tokens/hour burn rate in the status line" },
	{ value: "hit", label: "hit", description: "Toggle the cache hit ratio in the status line" },
	{ value: "saved", label: "saved", description: "Toggle the estimated cache savings in the status line" },
	{ value: "cycle", label: "cycle", description: "Rotate the status-bar period" },
	{ value: "window", label: "window", description: "Toggle the panel below the editor" },
	{ value: "budget ", label: "budget", description: "Set a day/week/month budget" },
	{ value: "cache", label: "cache", description: "Toggle counting cache tokens" },
	{ value: "live", label: "live", description: "Toggle refreshing after each message" },
	{ value: "enable", label: "enable", description: "Turn tokenburn on (status line, panel, refresh)" },
	{ value: "disable", label: "disable", description: "Turn tokenburn off: nothing runs in the background" },
];

/** `prefix` is the whole argument text typed so far (pi replaces it with `value`). */
export function completions(prefix: string): CompletionItem[] | null {
	const text = (prefix ?? "").toLowerCase().replace(/^\s+/, "");
	// `tail` = " " when the completed text still needs another word (a budget amount).
	const sub = (head: string, words: readonly string[], desc: (w: string) => string, tail = ""): CompletionItem[] =>
		words.map((w) => ({ value: `${head} ${w}${tail}`, label: w, description: desc(w) }));

	let pool: CompletionItem[];
	if (text.startsWith("status ")) pool = sub("status", STATUS_WINDOWS, (w) => `Show ${w} in the status bar`);
	else if (text.startsWith("budget ") && !/^budget \S+ /.test(text))
		pool = sub("budget", BUDGET_PERIODS, (w) => `Set the ${w} budget (tokens or $cost)`, " ");
	else if (/^(models?|providers?|projects?|sessions|top) /.test(text)) {
		const head = text.split(" ")[0];
		pool = sub(head, Object.keys(PERIOD_ALIASES).filter((w) => w !== "today" && w !== "total"), (w) => `Usage ${w === "all" ? "over all time" : `for ${w}`}`);
	} else if (text.startsWith("filter ") && !/^filter \S+ /.test(text)) pool = [
			...sub("filter", FILTER_KEYS_LIST, (w) => `Only this ${w}`, " "), // still needs a value
			...sub("filter", ["all"], () => "Clear the filter"), // complete as it is
		];
	else if (text.startsWith("export ") && !/^export \S+ /.test(text)) pool = sub("export", EXPORT_FORMATS, (w) => `Export as ${w}`);
	else if (/^(report|chart) /.test(text)) {
		const head = text.split(" ")[0];
		pool = sub(head, REPORT_VIEWS, (w) => `Chart: ${CHART_SPAN[w as ReportView]}`);
	} else pool = TOP_LEVEL;

	const out = pool.filter((i) => i.value.startsWith(text));
	return out.length > 0 ? out : null;
}
