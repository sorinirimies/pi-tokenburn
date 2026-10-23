/**
 * pi-tokenburn: token usage monitor with budget alerts in your Pi session.
 *
 * Reads local Pi session JSONL logs directly (0 network, 0 prompt tokens).
 * This file is wiring only: it connects pi's events and the /tokenburn command to the pieces below.
 *
 *   core/       types, config, session-log parser (incremental cache), aggregation, filters + prices
 *   command/    parse + completions (pure), the handler table, the Host handlers receive
 *   features/   one folder per feature, each with its logic and its commands:
 *     status-line  footer text, optional panel, burn rate / cache hit / savings, status period
 *     report       the /tokenburn summary and the column charts
 *     budgets      budgets, projection ("runs out Thu 14:05"), one-time warnings
 *     breakdown    tables per model / provider / project / session, current session
 *     filter       limit everything to a provider / model / project
 *     pricing      cost sources, price table
 *     export       csv / json
 *     live         refresh scheduling
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { handlers } from "./command/handlers.ts";
import type { Host } from "./command/host.ts";
import { completions } from "./command/completions.ts";
import { parseCommand } from "./command/parse.ts";
import { collectUsage } from "./core/aggregate.ts";
import { freshConfig, getSessionsDir, loadConfig, saveConfig, type TokenBurnConfig } from "./core/config.ts";
import type { UsageFilter, UsageOptions } from "./core/select.ts";
import { budgetWarnings } from "./features/budgets/budgets.ts";
import { createCoalescer } from "./features/live/coalescer.ts";
import { renderStatusLine, renderWidget } from "./features/status-line/render.ts";

// Public API (tests and other tools import from here).
export * from "./core/types.ts";
export * from "./core/config.ts";
export * from "./core/format.ts";
export * from "./core/parser.ts";
export * from "./core/time.ts";
export * from "./core/aggregate.ts";
export * from "./core/paint.ts";
export * from "./core/select.ts";
export * from "./command/parse.ts";
export * from "./command/completions.ts";
export * from "./features/report/chart.ts";
export * from "./features/report/report.ts";
export * from "./features/live/coalescer.ts";
export * from "./features/budgets/budgets.ts";
export * from "./features/status-line/status.ts";
export * from "./features/breakdown/query.ts";
export * from "./features/breakdown/table.ts";
export * from "./features/pricing/report.ts";
export * from "./features/export/export.ts";

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

	/** Redraw the status line and panel, and show any budget warning that is due. */
	const updateUI = async (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		if (!config.enabled) {
			// Disabled: show nothing and read nothing.
			ctx.ui.setStatus("tokenburn", "");
			ctx.ui.setWidget("tokenburn-panel", []);
			return;
		}
		const now = new Date();
		const report = await collectUsage(getSessionsDir(), now, config.includeCache, usageOpts());
		const theme = ctx.ui.theme;

		ctx.ui.setStatus("tokenburn", config.showStatus ? renderStatusLine(report, config, theme, now.getTime()) : "");

		for (const w of budgetWarnings(report, config, now.getTime())) {
			if (warned.has(w.id)) continue;
			warned.add(w.id);
			ctx.ui.notify(w.message, "warning");
		}

		if (config.showWidget) ctx.ui.setWidget("tokenburn-panel", renderWidget(report, config, theme), { placement: "belowEditor" });
		else ctx.ui.setWidget("tokenburn-panel", []);
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
		description: "TokenBurn: /tokenburn [hour|day|week|month|year|all] sets the status bar; models, providers, projects, sessions show tables; chart <view> shows the chart",
		getArgumentCompletions: (prefix: string) => completions(prefix),
		handler: async (args, ctx) => {
			latestCtx = ctx;
			const host: Host = {
				ctx,
				config,
				usageOpts,
				persist: async () => {
					await saveConfig(config);
					await updateUI(ctx);
				},
				// Settings changed while disabled are kept, but nothing shows until it is enabled.
				note: (msg) => ctx.ui.notify(config.enabled ? msg : `${msg} (tokenburn is disabled; /tokenburn enable to show it)`, "info"),
				cancelRefresh: () => refresher.cancel(),
				resetWarnings: () => warned.clear(),
			};
			const cmd = parseCommand(args);
			await (handlers[cmd.kind] as (c: typeof cmd, h: Host) => Promise<void>)(cmd, host);
		},
	});
}
