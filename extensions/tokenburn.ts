/**
 * pi-tokenburn — token usage monitor with budget alerts in your Pi session.
 *
 * Reads local Pi session JSONL logs directly (0 network, 0 prompt tokens).
 * Module layout (all under ./lib):
 *   types · config · format · parser (incremental cache) · time · aggregate · chart · coalescer · command
 * This file wires them to pi and re-exports the public API.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { collectAllSeries, collectSeries, collectUsage, DEFAULT_COUNT } from "./lib/aggregate.ts";
import { renderChart, themePaint } from "./lib/chart.ts";
import { createCoalescer } from "./lib/coalescer.ts";
import { completions, parseCommand } from "./lib/command.ts";
import { budgetsFor, freshConfig, getSessionsDir, isOverBudget, loadConfig, saveConfig, type TokenBurnConfig } from "./lib/config.ts";
import { collectExport, formatExport } from "./lib/export.ts";
import { budgetWarnings, burnRate, forecastLines } from "./lib/forecast.ts";
import { formatCost, formatNum } from "./lib/format.ts";
import { applyPricing, describeFilter, hasFilter, sanitizePrices, type UsageFilter, type UsageOptions } from "./lib/pricing.ts";
import { collectPricing, renderPricing } from "./lib/pricing-report.ts";
import { cacheHitRatio, cacheSavings, collectGroups, sumRows } from "./lib/query.ts";
import { renderTable, sessionSummary } from "./lib/table.ts";
import { STATUS_WINDOWS, type PeriodStats, type Window } from "./lib/types.ts";

export * from "./lib/types.ts";
export * from "./lib/config.ts";
export * from "./lib/format.ts";
export * from "./lib/parser.ts";
export * from "./lib/time.ts";
export * from "./lib/aggregate.ts";
export * from "./lib/chart.ts";
export * from "./lib/coalescer.ts";
export * from "./lib/command.ts";
export * from "./lib/pricing.ts";
export * from "./lib/pricing-report.ts";
export * from "./lib/query.ts";
export * from "./lib/forecast.ts";
export * from "./lib/table.ts";
export * from "./lib/export.ts";

export default function tokenBurnExtension(pi: ExtensionAPI) {
	let config: TokenBurnConfig = freshConfig();
	/** Budget warnings already shown (id = budget + period bucket + level): each shows once. */
	const warned = new Set<string>();

	/** Config filter (+ price table) merged with per-command filters. */
	const usageOpts = (extra?: UsageFilter): UsageOptions => ({
		filter: { ...config.filter, ...extra },
		prices: config.prices,
		priceMode: config.priceMode,
	});

	const updateUI = async (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		if (!config.enabled) {
			// Disabled: show nothing and read nothing.
			ctx.ui.setStatus("tokenburn", "");
			ctx.ui.setWidget("tokenburn-panel", []);
			return;
		}
		const nowDate = new Date();
		const report = await collectUsage(getSessionsDir(), nowDate, config.includeCache, usageOpts());
		const theme = ctx.ui.theme;

		// Status bar update
		if (config.showStatus) {
			const stat = report[config.statusWindow];
			const isOver = isOverBudget(stat, budgetsFor(config, config.statusWindow));
			const fire = isOver ? theme.fg("error", "🔥 OVER BUDGET") : theme.fg("warning", "🔥");
			const tokensText = theme.fg(isOver ? "error" : "accent", formatNum(stat.tokens));
			const costText = theme.fg("dim", `(${formatCost(stat.cost)})`);
			const filterText = describeFilter(config.filter);
			const label = theme.fg("dim", `[${config.statusWindow}${filterText ? ` · ${filterText}` : ""}]`);
			const rate = config.showRate && report.hour.tokens > 0 ? theme.fg("dim", ` · ${formatNum(burnRate(report.hour).tokensPerHour)}/h`) : "";

			ctx.ui.setStatus("tokenburn", `${fire} ${tokensText} ${costText} ${label}${rate}`);
		} else {
			ctx.ui.setStatus("tokenburn", "");
		}

		// One-time budget warnings (once per budget, period and level).
		for (const w of budgetWarnings(report, config, nowDate.getTime())) {
			if (warned.has(w.id)) continue;
			warned.add(w.id);
			ctx.ui.notify(w.message, "warning");
		}

		// Widget panel update
		if (config.showWidget) {
			const border = theme.fg("dim", "─".repeat(46));
			const header = theme.fg("accent", " 🔥 TokenBurn Dashboard ");
			const line = (label: string, p: PeriodStats, b: { tokens?: number; cost?: number } = {}) => {
				const over = isOverBudget(p, b);
				const tokStr = (over ? theme.fg("error", "!") : " ") + formatNum(p.tokens).padStart(8);
				const inStr = `(in:${formatNum(p.input)} out:${formatNum(p.output)})`.padEnd(20);
				const costStr = formatCost(p.cost).padStart(8);
				return `  ${theme.fg("muted", label.padEnd(8))} ${tokStr}  ${theme.fg("dim", inStr)} ${costStr}`;
			};

			const lines = [
				`┌${header}${"─".repeat(21)}┐`,
				line("Today", report.today, budgetsFor(config, "today")),
				line("Week", report.week, budgetsFor(config, "week")),
				line("Month", report.month, budgetsFor(config, "month")),
				line("Year", report.year),
				line("Total", report.total),
				`└${"─".repeat(46)}┘`,
			];

			ctx.ui.setWidget("tokenburn-panel", lines, { placement: "belowEditor" });
		} else {
			ctx.ui.setWidget("tokenburn-panel", []);
		}
	};

	// The latest context, used by the (delayed) live refresh. Dropped at shutdown so a reloaded
	// runtime never touches a stale one.
	let latestCtx: ExtensionContext | undefined;
	const refresher = createCoalescer(
		async () => {
			if (latestCtx && config.enabled) await updateUI(latestCtx);
		},
		() => config.refreshMs,
	);

	pi.on("session_start", async (_event, ctx) => {
		latestCtx = ctx;
		config = await loadConfig();
		// A failing refresh must never break session start.
		await updateUI(ctx).catch(() => {});
	});

	// Live: after each assistant message, coalesced. Never blocks, never throws into pi, and
	// must return undefined (a message_end handler may otherwise replace the message).
	pi.on("message_end", (event, ctx) => {
		if (!config.enabled || !config.liveRefresh) return undefined;
		if ((event.message as { role?: string } | undefined)?.role !== "assistant") return undefined;
		latestCtx = ctx;
		refresher.schedule();
		return undefined;
	});

	// Final, exact refresh when a turn ends (fire-and-forget).
	pi.on("turn_end", (_event, ctx) => {
		if (!config.enabled) return;
		latestCtx = ctx;
		void refresher.flush();
	});

	pi.on("session_shutdown", () => {
		refresher.cancel();
		latestCtx = undefined;
	});

	pi.registerCommand("tokenburn", {
		description: "TokenBurn: /tokenburn [day|week|month|year|all] sets the status bar; /tokenburn chart <day|week|month|year|all> shows the chart",
		getArgumentCompletions: (prefix: string) => completions(prefix),
		handler: async (args, ctx) => {
			const cmd = parseCommand(args);
			latestCtx = ctx;
			const persist = async () => {
				await saveConfig(config);
				await updateUI(ctx);
			};
			// Settings changed while disabled are kept, but nothing shows until it is enabled.
			const note = (msg: string) => ctx.ui.notify(config.enabled ? msg : `${msg} (tokenburn is disabled; /tokenburn enable to show it)`, "info");

			switch (cmd.kind) {
				case "window":
					config.showWidget = !config.showWidget;
					await persist();
					note(`tokenburn widget: ${config.showWidget ? "enabled" : "hidden"}`);
					return;

				case "status":
					config.statusWindow = cmd.window;
					await persist();
					note(`tokenburn status window: ${cmd.window}`);
					return;

				case "cycle": {
					const next = STATUS_WINDOWS[(STATUS_WINDOWS.indexOf(config.statusWindow) + 1) % STATUS_WINDOWS.length];
					config.statusWindow = next;
					await persist();
					note(`tokenburn status window: ${next}`);
					return;
				}

				case "cache":
					config.includeCache = !config.includeCache;
					await persist();
					note(`tokenburn: cache tokens ${config.includeCache ? "included" : "excluded"}`);
					return;

				case "budget": {
					const key = `${cmd.period}${cmd.isCost ? "Cost" : "Tokens"}` as keyof TokenBurnConfig["budgets"];
					config.budgets[key] = cmd.amount;
					await persist();
					note(`tokenburn ${cmd.period} budget: ${cmd.isCost ? formatCost(cmd.amount) : formatNum(cmd.amount) + " tokens"}`);
					return;
				}

				case "enable":
					if (config.enabled) {
						ctx.ui.notify("tokenburn is already enabled", "info");
						return;
					}
					config.enabled = true;
					await persist();
					ctx.ui.notify("tokenburn enabled", "info");
					return;

				case "disable":
					if (!config.enabled) {
						ctx.ui.notify("tokenburn is already disabled", "info");
						return;
					}
					config.enabled = false;
					refresher.cancel();
					await persist(); // clears the status line and the panel
					ctx.ui.notify("tokenburn disabled: nothing runs in the background. /tokenburn enable turns it back on (charts still work on demand)", "info");
					return;

				case "live":
					config.liveRefresh = !config.liveRefresh;
					if (!config.liveRefresh) refresher.cancel();
					await persist();
					note(`tokenburn live refresh ${config.liveRefresh ? "on (after each assistant message)" : "off (only when a turn ends)"}`);
					return;

				case "rate":
					config.showRate = !config.showRate;
					await persist();
					note(`tokenburn burn rate in the status line: ${config.showRate ? "on" : "off"}`);
					return;

				case "warn":
					config.warnPct = cmd.pct;
					warned.clear();
					await persist();
					note(cmd.pct === 0 ? "tokenburn budget warnings: off" : `tokenburn: warning when a budget reaches ${cmd.pct}%`);
					return;

				case "filter": {
					if (cmd.clear) config.filter = {};
					else if (cmd.key) {
						if (cmd.value === undefined) delete config.filter[cmd.key];
						else config.filter[cmd.key] = cmd.value;
					} else {
						ctx.ui.notify(hasFilter(config.filter) ? `tokenburn filter: ${describeFilter(config.filter)}` : "tokenburn filter: none (all providers, models and projects)", "info");
						return;
					}
					await persist();
					note(hasFilter(config.filter) ? `tokenburn filter: ${describeFilter(config.filter)}` : "tokenburn filter cleared: showing everything");
					return;
				}

				case "table": {
					const opts = usageOpts(cmd.filter);
					const rows = await collectGroups(getSessionsDir(), cmd.by, cmd.period, new Date(), config.includeCache, opts);
					const paint = config.chartColor ? themePaint(ctx.ui.theme) : undefined;
					ctx.ui.notify(renderTable(cmd.by, rows, cmd.period, { limit: cmd.limit, filterText: describeFilter(opts.filter), paint }).join("\n"), "info");
					return;
				}

				case "session": {
					const file = ctx.sessionManager?.getSessionFile?.();
					if (!file) {
						ctx.ui.notify("tokenburn: this session has no log file yet (in-memory session)", "info");
						return;
					}
					const root = getSessionsDir();
					const now = new Date();
					const [rows, report] = await Promise.all([
						collectGroups(root, "session", "all", now, config.includeCache, usageOpts()),
						collectUsage(root, now, config.includeCache, usageOpts()),
					]);
					ctx.ui.notify(sessionSummary(file, rows.find((r) => r.key === file), report.today.cost), "info");
					return;
				}

				case "export": {
					const now = new Date();
					const rows = await collectExport(getSessionsDir(), cmd.period, now, usageOpts());
					const path = resolve(ctx.cwd ?? process.cwd(), cmd.path ?? `tokenburn-${cmd.period}.${cmd.format}`);
					try {
						await writeFile(path, formatExport(rows, cmd.format), "utf8");
						ctx.ui.notify(`tokenburn: exported ${rows.length} rows (${cmd.period}) to ${path}`, "info");
					} catch (e) {
						ctx.ui.notify(`tokenburn: export failed: ${(e as Error).message}`, "warning");
					}
					return;
				}

				case "pricing": {
					if (cmd.mode) {
						config.priceMode = cmd.mode;
						await persist();
					}
					const rep = await collectPricing(getSessionsDir(), config.prices, config.priceMode, config.filter);
					ctx.ui.notify(renderPricing(rep, config.prices, config.priceMode).join("\n"), "info");
					return;
				}

				case "price": {
					if (cmd.remove) {
						const had = cmd.model in config.prices;
						delete config.prices[cmd.model];
						await persist();
						note(had ? `tokenburn: removed price for ${cmd.model}` : `tokenburn: no price for ${cmd.model}`);
						return;
					}
					const next = sanitizePrices({ [cmd.model]: { input: cmd.input, output: cmd.output, cacheRead: cmd.cacheRead, cacheWrite: cmd.cacheWrite } });
					Object.assign(config.prices, next);
					await persist();
					note(`tokenburn: price for ${cmd.model} set ($/M in ${cmd.input}, out ${cmd.output}); mode ${config.priceMode}`);
					return;
				}

				case "invalid":
					ctx.ui.notify(cmd.message, "warning");
					return;

				case "report": {
					const root = getSessionsDir();
					const now = new Date();
					const opts = usageOpts();
					const report = await collectUsage(root, now, config.includeCache, opts);
					const paint = config.chartColor ? themePaint(ctx.ui.theme) : undefined;

					let chart: string[];
					if (cmd.view === "all") {
						const all = await collectAllSeries(root, now, config.includeCache, opts);
						chart = renderChart(all.series, all.unit, { paint, title: "All time" });
					} else {
						const series = await collectSeries(root, cmd.view, DEFAULT_COUNT[cmd.view], now, config.includeCache, opts);
						const budgetWindow: Window | undefined =
							cmd.view === "day" ? "today" : cmd.view === "year" ? undefined : cmd.view;
						chart = renderChart(series, cmd.view, {
							paint,
							budget: budgetWindow ? budgetsFor(config, budgetWindow) : undefined,
						});
					}

					const models = sumRows(await collectGroups(root, "model", "all", now, config.includeCache, opts));
					const rate = burnRate(report.hour);
					const extra = [
						`burn rate: ${formatNum(rate.tokensPerHour)} tokens/h · ${formatCost(rate.costPerHour)}/h (last 60 min)`,
						...(models.cacheRead + models.cacheWrite > 0
							? [`cache: ${Math.round(cacheHitRatio(models) * 100)}% of prompt tokens read from cache${cacheSavings(models) > 0 ? ` · saved ~${formatCost(cacheSavings(models))}` : ""}`]
							: []),
						...forecastLines(report, config, now.getTime()),
					];
					const filterText = describeFilter(opts.filter);

					const row = (name: string, p: PeriodStats) =>
						`${name.padEnd(10)} ${formatNum(p.tokens).padStart(8)} tokens ${formatCost(p.cost).padStart(9)} · in:${formatNum(p.input)} out:${formatNum(p.output)} cache:${formatNum(p.cacheRead + p.cacheWrite)} · ${p.sessions} sess`;
					const rule = "─".repeat(60);
					ctx.ui.notify(
						[
							`🔥 TokenBurn Report${filterText ? ` · ${filterText}` : ""}`,
							rule,
							row("Today", report.today),
							row("This Week", report.week),
							row("This Month", report.month),
							row("This Year", report.year),
							row("All Time", report.total),
							rule,
							...chart,
							rule,
							...extra,
							rule,
							"models · providers · projects · sessions · session · filter · export · pricing · chart <view> · <view> sets the status bar · cycle · window · budget · cache · live · on|off",
						].join("\n"),
						"info",
					);
					return;
				}
			}
		},
	});
}
