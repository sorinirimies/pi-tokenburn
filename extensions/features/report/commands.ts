/** Command: the summary report with a chart. */
import { collectAllSeries, collectSeries, collectUsage, DEFAULT_COUNT } from "../../core/aggregate.ts";
import { budgetsFor, getSessionsDir } from "../../core/config.ts";
import { themePaint } from "../../core/paint.ts";
import { describeFilter } from "../../core/select.ts";
import type { Window } from "../../core/types.ts";
import type { HandlersFor } from "../../command/host.ts";
import { collectGroups, sumRows } from "../breakdown/query.ts";
import { renderChart } from "./chart.ts";
import { renderReport } from "./report.ts";

export const reportCommands: HandlersFor<"report"> = {
	async report(cmd, { config, usageOpts, ctx }) {
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
			const budgetWindow: Window | undefined = cmd.view === "day" ? "today" : cmd.view === "year" ? undefined : cmd.view;
			chart = renderChart(series, cmd.view, { paint, budget: budgetWindow ? budgetsFor(config, budgetWindow) : undefined });
		}

		const models = sumRows(await collectGroups(root, "model", "all", now, config.includeCache, opts));
		ctx.ui.notify(renderReport({ report, chart, models, config, now: now.getTime(), filterText: describeFilter(opts.filter) }).join("\n"), "info");
	},
};
