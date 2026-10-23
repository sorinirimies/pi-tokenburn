/** Command parsing + completions (pure, unit-tested). */
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
	| { kind: "invalid"; message: string };

export const USAGE =
	"Usage: /tokenburn [day|week|month|year|all] (status-bar period) · chart [day|week|month|year|all] · status <today|week|month|year|total> · cycle · window · budget <day|week|month> <tokens|$cost> · cache · live · enable · disable";

/** Words that pick the status-bar period: `day` shows today, `all` shows the all-time total. */
const WORD_TO_WINDOW: Record<string, Window> = {
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

export function parseCommand(args: string | undefined): Command {
	const [cmd, p1, p2] = (args ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
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
	{ value: "day", label: "day", description: "Status bar: today" },
	{ value: "week", label: "week", description: "Status bar: this week" },
	{ value: "month", label: "month", description: "Status bar: this month" },
	{ value: "year", label: "year", description: "Status bar: this year" },
	{ value: "all", label: "all", description: "Status bar: all-time total" },
	{ value: "chart ", label: "chart", description: "Report + chart: day, week, month, year or all" },
	{ value: "status ", label: "status", description: "Set the status-bar period explicitly" },
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
	else if (/^(report|chart) /.test(text)) {
		const head = text.split(" ")[0];
		pool = sub(head, REPORT_VIEWS, (w) => `Chart: ${CHART_SPAN[w as ReportView]}`);
	} else pool = TOP_LEVEL;

	const out = pool.filter((i) => i.value.startsWith(text));
	return out.length > 0 ? out : null;
}
