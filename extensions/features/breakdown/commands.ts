/** Commands: usage tables (models / providers / projects / sessions) and the current session. */
import { collectUsage } from "../../core/aggregate.ts";
import { getSessionsDir } from "../../core/config.ts";
import { themePaint } from "../../core/paint.ts";
import { describeFilter } from "../../core/select.ts";
import type { HandlersFor } from "../../command/host.ts";
import { collectGroups } from "./query.ts";
import { renderTable, sessionSummary } from "./table.ts";

export const breakdownCommands: HandlersFor<"table" | "session"> = {
	async table(cmd, { config, usageOpts, ctx }) {
		const opts = usageOpts(cmd.filter);
		const rows = await collectGroups(getSessionsDir(), cmd.by, cmd.period, new Date(), config.includeCache, opts);
		const paint = config.chartColor ? themePaint(ctx.ui.theme) : undefined;
		ctx.ui.notify(renderTable(cmd.by, rows, cmd.period, { limit: cmd.limit, filterText: describeFilter(opts.filter), paint }).join("\n"), "info");
	},

	async session(_cmd, { config, usageOpts, ctx }) {
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
	},
};
