/**
 * pi-tokenburn — token usage monitor with budget alerts in your Pi session.
 *
 * Reads local Pi session JSONL logs directly (0 network, 0 prompt tokens).
 * Module layout (all under ./lib):
 *   types · config · format · parser (incremental cache) · time · aggregate · chart · coalescer · command
 * This file wires them to pi and re-exports the public API.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { collectAllSeries, collectSeries, collectUsage, DEFAULT_COUNT } from "./lib/aggregate.ts";
import { renderChart, themePaint } from "./lib/chart.ts";
import { createCoalescer } from "./lib/coalescer.ts";
import { completions, parseCommand } from "./lib/command.ts";
import { budgetsFor, freshConfig, getSessionsDir, isOverBudget, loadConfig, saveConfig, type TokenBurnConfig } from "./lib/config.ts";
import { formatCost, formatNum } from "./lib/format.ts";
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

export default function tokenBurnExtension(pi: ExtensionAPI) {
	let config: TokenBurnConfig = freshConfig();

	const updateUI = async (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		if (!config.enabled) {
			// Disabled: show nothing and read nothing.
			ctx.ui.setStatus("tokenburn", "");
			ctx.ui.setWidget("tokenburn-panel", []);
			return;
		}
		const report = await collectUsage(getSessionsDir(), new Date(), config.includeCache);
		const theme = ctx.ui.theme;

		// Status bar update
		if (config.showStatus) {
			const stat = report[config.statusWindow];
			const isOver = isOverBudget(stat, budgetsFor(config, config.statusWindow));
			const fire = isOver ? theme.fg("error", "🔥 OVER BUDGET") : theme.fg("warning", "🔥");
			const tokensText = theme.fg(isOver ? "error" : "accent", formatNum(stat.tokens));
			const costText = theme.fg("dim", `(${formatCost(stat.cost)})`);
			const label = theme.fg("dim", `[${config.statusWindow}]`);

			ctx.ui.setStatus("tokenburn", `${fire} ${tokensText} ${costText} ${label}`);
		} else {
			ctx.ui.setStatus("tokenburn", "");
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

				case "invalid":
					ctx.ui.notify(cmd.message, "warning");
					return;

				case "report": {
					const root = getSessionsDir();
					const now = new Date();
					const report = await collectUsage(root, now, config.includeCache);
					const paint = config.chartColor ? themePaint(ctx.ui.theme) : undefined;

					let chart: string[];
					if (cmd.view === "all") {
						const all = await collectAllSeries(root, now, config.includeCache);
						chart = renderChart(all.series, all.unit, { paint, title: "All time" });
					} else {
						const series = await collectSeries(root, cmd.view, DEFAULT_COUNT[cmd.view], now, config.includeCache);
						const budgetWindow: Window | undefined =
							cmd.view === "day" ? "today" : cmd.view === "year" ? undefined : cmd.view;
						chart = renderChart(series, cmd.view, {
							paint,
							budget: budgetWindow ? budgetsFor(config, budgetWindow) : undefined,
						});
					}

					const row = (name: string, p: PeriodStats) =>
						`${name.padEnd(10)} ${formatNum(p.tokens).padStart(8)} tokens ${formatCost(p.cost).padStart(9)} · in:${formatNum(p.input)} out:${formatNum(p.output)} cache:${formatNum(p.cacheRead + p.cacheWrite)} · ${p.sessions} sess`;
					const rule = "─".repeat(60);
					ctx.ui.notify(
						[
							"🔥 TokenBurn Report",
							rule,
							row("Today", report.today),
							row("This Week", report.week),
							row("This Month", report.month),
							row("This Year", report.year),
							row("All Time", report.total),
							rule,
							...chart,
							rule,
							"chart <view> · <view> sets the status bar · cycle · window · budget · cache · live · on|off",
						].join("\n"),
						"info",
					);
					return;
				}
			}
		},
	});
}
