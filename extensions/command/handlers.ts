/** Every command kind mapped to the feature that handles it (compile-time exhaustive). */
import { budgetCommands } from "../features/budgets/commands.ts";
import { breakdownCommands } from "../features/breakdown/commands.ts";
import { exportCommands } from "../features/export/commands.ts";
import { filterCommands } from "../features/filter/commands.ts";
import { pricingCommands } from "../features/pricing/commands.ts";
import { reportCommands } from "../features/report/commands.ts";
import { statusLineCommands } from "../features/status-line/commands.ts";
import type { Handlers } from "./host.ts";

export const handlers: Handlers = {
	...statusLineCommands,
	...budgetCommands,
	...breakdownCommands,
	...filterCommands,
	...exportCommands,
	...pricingCommands,
	...reportCommands,
	async invalid(cmd, { ctx }) {
		ctx.ui.notify(cmd.message, "warning");
	},
};
