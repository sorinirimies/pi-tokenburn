/**
 * pi-context-diet's savings log: one JSON line per request it trimmed, in pi's agent dir
 * (`{"ts":"2026-01-02T09:15:00.000Z","tokens":18400,...}`). Only `ts` and `tokens` are read.
 * A missing or unreadable file means "no savings"; lines that do not parse are skipped.
 */
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { getConfigDir } from "./config.ts";

export const DIET_LOG = "context-diet-savings.jsonl";

export interface DietRecord {
	ts: number;
	tokens: number;
}

export const dietLogPath = (dir: string = getConfigDir()) => join(dir, DIET_LOG);

export function parseDietLog(text: string): DietRecord[] {
	const out: DietRecord[] = [];
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

// The status line refreshes after every message: re-read the log only when it changed.
let cache: { path: string; mtimeMs: number; size: number; records: DietRecord[] } | undefined;

export async function loadDietLog(path: string = dietLogPath()): Promise<DietRecord[]> {
	try {
		const s = await stat(path);
		if (cache && cache.path === path && cache.mtimeMs === s.mtimeMs && cache.size === s.size) return cache.records;
		const records = parseDietLog(await readFile(path, "utf8"));
		cache = { path, mtimeMs: s.mtimeMs, size: s.size, records };
		return records;
	} catch {
		return [];
	}
}

export const clearDietCache = () => {
	cache = undefined;
};
