/** Commands that change what the status line shows and how tokenburn runs. */
import { STATUS_WINDOWS } from "../../core/types.ts";
import type { HandlersFor } from "../../command/host.ts";

const onOff = (v: boolean) => (v ? "on" : "off");

export const statusLineCommands: HandlersFor<"window" | "status" | "cycle" | "cache" | "live" | "enable" | "disable" | "rate" | "hit" | "saved"> = {
	async window(_cmd, { config, persist, note }) {
		config.showWidget = !config.showWidget;
		await persist();
		note(`tokenburn widget: ${config.showWidget ? "enabled" : "hidden"}`);
	},

	async status(cmd, { config, persist, note }) {
		config.statusWindow = cmd.window;
		await persist();
		note(`tokenburn status window: ${cmd.window}`);
	},

	async cycle(_cmd, { config, persist, note }) {
		const next = STATUS_WINDOWS[(STATUS_WINDOWS.indexOf(config.statusWindow) + 1) % STATUS_WINDOWS.length];
		config.statusWindow = next;
		await persist();
		note(`tokenburn status window: ${next}`);
	},

	async cache(_cmd, { config, persist, note }) {
		config.includeCache = !config.includeCache;
		await persist();
		note(`tokenburn: cache tokens ${config.includeCache ? "included" : "excluded"}`);
	},

	async live(_cmd, { config, persist, note, cancelRefresh }) {
		config.liveRefresh = !config.liveRefresh;
		if (!config.liveRefresh) cancelRefresh();
		await persist();
		note(`tokenburn live refresh ${config.liveRefresh ? "on (after each assistant message)" : "off (only when a turn ends)"}`);
	},

	async enable(_cmd, { config, persist, ctx }) {
		if (config.enabled) {
			ctx.ui.notify("tokenburn is already enabled", "info");
			return;
		}
		config.enabled = true;
		await persist();
		ctx.ui.notify("tokenburn enabled", "info");
	},

	async disable(_cmd, { config, persist, ctx, cancelRefresh }) {
		if (!config.enabled) {
			ctx.ui.notify("tokenburn is already disabled", "info");
			return;
		}
		config.enabled = false;
		cancelRefresh();
		await persist(); // clears the status line and the panel
		ctx.ui.notify("tokenburn disabled: nothing runs in the background. /tokenburn enable turns it back on (charts still work on demand)", "info");
	},

	async rate(_cmd, { config, persist, note }) {
		config.showRate = !config.showRate;
		await persist();
		note(`tokenburn burn rate in the status line: ${onOff(config.showRate)}`);
	},

	async hit(_cmd, { config, persist, note }) {
		config.showHit = !config.showHit;
		await persist();
		note(`tokenburn cache hit ratio in the status line: ${onOff(config.showHit)}`);
	},

	async saved(_cmd, { config, persist, note }) {
		config.showSaved = !config.showSaved;
		await persist();
		note(`tokenburn estimated cache savings in the status line: ${onOff(config.showSaved)}`);
	},
};
