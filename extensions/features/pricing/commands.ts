/** Commands: where costs come from, and the price table. */
import { getSessionsDir } from "../../core/config.ts";
import { sanitizePrices } from "../../core/select.ts";
import type { HandlersFor } from "../../command/host.ts";
import { collectPricing, renderPricing } from "./report.ts";

export const pricingCommands: HandlersFor<"pricing" | "price"> = {
	async pricing(cmd, { config, persist, ctx }) {
		if (cmd.mode) {
			config.priceMode = cmd.mode;
			await persist();
		}
		const rep = await collectPricing(getSessionsDir(), config.prices, config.priceMode, config.filter);
		ctx.ui.notify(renderPricing(rep, config.prices, config.priceMode).join("\n"), "info");
	},

	async price(cmd, { config, persist, note }) {
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
	},
};
