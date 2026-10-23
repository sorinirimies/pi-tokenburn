/** Tab-completion for /tokenburn (pure, unit-tested). */
import { EXPORT_FORMATS } from "../features/export/export.ts";
import { FILTER_KEYS_LIST } from "../core/select.ts";
import { PERIOD_ALIASES } from "../features/breakdown/query.ts";
import { STATUS_WINDOWS } from "../core/types.ts";
import { BUDGET_PERIODS, REPORT_VIEWS, type ReportView } from "./parse.ts";

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
