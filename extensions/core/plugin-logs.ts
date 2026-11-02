/**
 * The savings logs of pi plugins, in pi's agent dir: one JSON line per saving
 * (`{"ts":"2026-01-02T09:15:00.000Z","tokens":18400,...}`). Only `ts` and `tokens` are read.
 *
 * - pi-context-diet: `context-diet-savings.jsonl`, one line per request it trimmed;
 * - pi-squeeze: `squeeze-savings.jsonl`, one line per bash output it shortened.
 *
 * A missing or unreadable file means "no savings"; lines that do not parse are skipped.
 */
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { getConfigDir } from "./config.ts";

export const DIET_LOG = "context-diet-savings.jsonl";
export const SQUEEZE_LOG = "squeeze-savings.jsonl";

export interface LogRecord {
	ts: number;
	tokens: number;
}

/** Where a plugin's log is: `file` in pi's agent dir. */
export const pluginLogPath = (file: string, dir: string = getConfigDir()) => join(dir, file);

export function parsePluginLog(text: string): LogRecord[] {
	const out: LogRecord[] = [];
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		try {
			const r = JSON.parse(line) as { ts?: unknown; tokens?: unknown };
			const ts = typeof r.ts === "string" ? Date.parse(r.ts) : NaN;
			const tokens = r.tokens;
			if (Number.isFinite(ts) && typeof tokens === "number" && Number.isFinite(tokens) && tokens > 0) out.push({ ts, tokens });
		} catch {
			/* a torn or foreign line */
		}
	}
	return out;
}

// The status line refreshes after every message: re-read a log only when it changed.
const cache = new Map<string, { mtimeMs: number; size: number; records: LogRecord[] }>();

export async function loadPluginLog(path: string): Promise<LogRecord[]> {
	try {
		const s = await stat(path);
		const hit = cache.get(path);
		if (hit && hit.mtimeMs === s.mtimeMs && hit.size === s.size) return hit.records;
		const records = parsePluginLog(await readFile(path, "utf8"));
		cache.set(path, { mtimeMs: s.mtimeMs, size: s.size, records });
		return records;
	} catch {
		return [];
	}
}

export const clearPluginLogCache = () => cache.clear();
