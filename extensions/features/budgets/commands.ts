/** Commands: set a budget, set the warning threshold. */
import { formatCost, formatNum } from "../../core/format.ts";
import type { TokenBurnConfig } from "../../core/config.ts";
import type { HandlersFor } from "../../command/host.ts";

export const budgetCommands: HandlersFor<"budget" | "warn"> = {
	async budget(cmd, { config, persist, note }) {
		const key = `${cmd.period}${cmd.isCost ? "Cost" : "Tokens"}` as keyof TokenBurnConfig["budgets"];
		config.budgets[key] = cmd.amount;
		await persist();
		note(`tokenburn ${cmd.period} budget: ${cmd.isCost ? formatCost(cmd.amount) : formatNum(cmd.amount) + " tokens"}`);
	},

	async warn(cmd, { config, persist, note, resetWarnings }) {
		config.warnPct = cmd.pct;
		resetWarnings();
		await persist();
		note(cmd.pct === 0 ? "tokenburn budget warnings: off" : `tokenburn: warning when a budget reaches ${cmd.pct}%`);
	},
};
