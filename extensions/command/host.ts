/** What a command handler gets, and the shape of a feature's command handlers. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TokenBurnConfig } from "../core/config.ts";
import type { UsageFilter, UsageOptions } from "../core/select.ts";
import type { Command } from "./parse.ts";

export interface Host {
	ctx: ExtensionContext;
	/** Live settings: handlers mutate this, then call `persist()`. */
	config: TokenBurnConfig;
	/** Config filter + price table, merged with per-command filters. */
	usageOpts(extra?: UsageFilter): UsageOptions;
	/** Save the config and refresh the status line / panel. */
	persist(): Promise<void>;
	/** Info notification; mentions when tokenburn is disabled (settings still apply). */
	note(message: string): void;
	/** Drop a pending live refresh. */
	cancelRefresh(): void;
	/** Forget budget warnings already shown (after the threshold changed). */
	resetWarnings(): void;
}

/** One handler per command kind; a feature exports the subset it owns. */
export type Handlers = { [K in Command["kind"]]: (cmd: Extract<Command, { kind: K }>, host: Host) => Promise<void> };
export type HandlersFor<K extends Command["kind"]> = Pick<Handlers, K>;
