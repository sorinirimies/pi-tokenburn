/** Command: write usage to a csv / json file. */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getSessionsDir } from "../../core/config.ts";
import type { HandlersFor } from "../../command/host.ts";
import { collectExport, formatExport } from "./export.ts";

export const exportCommands: HandlersFor<"export"> = {
	async export(cmd, { usageOpts, ctx }) {
		const rows = await collectExport(getSessionsDir(), cmd.period, new Date(), usageOpts());
		const path = resolve(ctx.cwd ?? process.cwd(), cmd.path ?? `tokenburn-${cmd.period}.${cmd.format}`);
		try {
			await writeFile(path, formatExport(rows, cmd.format), "utf8");
			ctx.ui.notify(`tokenburn: exported ${rows.length} rows (${cmd.period}) to ${path}`, "info");
		} catch (e) {
			ctx.ui.notify(`tokenburn: export failed: ${(e as Error).message}`, "warning");
		}
	},
};
