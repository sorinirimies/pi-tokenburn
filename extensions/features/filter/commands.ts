/** Command: limit everything to a provider / model / project. */
import { describeFilter, hasFilter } from "../../core/select.ts";
import type { HandlersFor } from "../../command/host.ts";

export const filterCommands: HandlersFor<"filter"> = {
	async filter(cmd, { config, persist, note, ctx }) {
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
	},
};
