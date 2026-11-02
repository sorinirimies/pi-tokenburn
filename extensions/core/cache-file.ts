/**
 * The session-log parse cache, saved between pi runs in `tokenburn-cache.json` (pi's agent dir).
 *
 * Without it every pi start re-reads the whole session history (gigabytes for a long-used pi)
 * before the status line can show anything. With it, a start reads only what was appended since.
 * The parser still checks size, mtime and the head / last-parsed bytes of every file, so a stale
 * or foreign cache file only costs a re-parse, never wrong numbers. Any read or write failure
 * is ignored: the cache is an optimization.
 */
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getConfigDir } from "./config.ts";
import { cacheGeneration, exportCache, importCache, type FileEntry, type Turn } from "./parser.ts";

export const CACHE_FILE = "tokenburn-cache.json";
const VERSION = 1;
/** Rewrite the file at most this often while pi runs; the last state is written at shutdown. */
export const SAVE_EVERY_MS = 60_000;

export const cacheFilePath = (dir: string = getConfigDir()) => join(dir, CACHE_FILE);

/** A turn without its session (the file it belongs to); strings are indexes into `strings`. */
type Row = [ts: number, input: number, output: number, cacheRead: number, cacheWrite: number, cost: number, costInput: number, costCacheRead: number, provider: number, model: number, project: number];

interface SavedEntry {
	size: number;
	mtimeMs: number;
	offset: number;
	cwd?: string;
	head: string;
	guard: string;
	turns: Row[];
	tail: Row[];
}

interface Saved {
	version: number;
	strings: string[];
	files: Record<string, SavedEntry>;
}

export function encodeCache(entries: [string, FileEntry][]): Saved {
	const strings: string[] = [];
	const index = new Map<string, number>();
	const id = (s: string) => {
		let i = index.get(s);
		if (i === undefined) {
			i = strings.push(s) - 1;
			index.set(s, i);
		}
		return i;
	};
	const row = (t: Turn): Row => [t.ts, t.input, t.output, t.cacheRead, t.cacheWrite, t.cost, t.costInput, t.costCacheRead, id(t.provider), id(t.model), id(t.project)];
	const files: Record<string, SavedEntry> = {};
	for (const [file, e] of entries) {
		files[file] = {
			size: e.size,
			mtimeMs: e.mtimeMs,
			offset: e.offset,
			...(e.cwd === undefined ? {} : { cwd: e.cwd }),
			head: e.head.toString("base64"),
			guard: e.guard.toString("base64"),
			turns: e.turns.map(row),
			tail: e.tail.map(row),
		};
	}
	return { version: VERSION, strings, files };
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The entries of a saved cache; anything malformed is dropped (that file is simply re-parsed). */
export function decodeCache(data: unknown): [string, FileEntry][] {
	const saved = data as Partial<Saved> | null;
	if (!saved || saved.version !== VERSION || !Array.isArray(saved.strings) || typeof saved.files !== "object" || saved.files === null) return [];
	const strings = saved.strings;
	const str = (i: unknown) => (Number.isInteger(i) && typeof strings[i as number] === "string" ? strings[i as number] : undefined);
	const turn = (r: unknown, session: string): Turn | undefined => {
		if (!Array.isArray(r) || r.length !== 11 || !r.slice(0, 8).every(isNum)) return undefined;
		const [provider, model, project] = [str(r[8]), str(r[9]), str(r[10])];
		if (provider === undefined || model === undefined || project === undefined) return undefined;
		const [ts, input, output, cacheRead, cacheWrite, cost, costInput, costCacheRead] = r as number[];
		return { ts: ts!, input: input!, output: output!, cacheRead: cacheRead!, cacheWrite: cacheWrite!, cost: cost!, costInput: costInput!, costCacheRead: costCacheRead!, provider, model, project, session };
	};
	const turns = (rows: unknown, session: string): Turn[] | undefined => {
		if (!Array.isArray(rows)) return undefined;
		const out: Turn[] = [];
		for (const r of rows) {
			const t = turn(r, session);
			if (!t) return undefined;
			out.push(t);
		}
		return out;
	};
	const out: [string, FileEntry][] = [];
	for (const [file, e] of Object.entries(saved.files as Record<string, Partial<SavedEntry>>)) {
		if (!e || !isNum(e.size) || !isNum(e.mtimeMs) || !isNum(e.offset) || typeof e.head !== "string" || typeof e.guard !== "string") continue;
		if (e.cwd !== undefined && typeof e.cwd !== "string") continue;
		const [t, tail] = [turns(e.turns, file), turns(e.tail, file)];
		if (!t || !tail) continue;
		out.push([file, { size: e.size, mtimeMs: e.mtimeMs, offset: e.offset, cwd: e.cwd, head: Buffer.from(e.head, "base64"), guard: Buffer.from(e.guard, "base64"), turns: t, tail }]);
	}
	return out;
}

let savedGeneration = -1;
let lastSave = -Infinity;

/** Seed the parser from the cache file (a no-op when it is missing or broken, or the parser is warm). */
export async function restoreCache(path: string = cacheFilePath()): Promise<void> {
	try {
		importCache(decodeCache(JSON.parse(await readFile(path, "utf8"))));
		savedGeneration = cacheGeneration();
	} catch {
		/* no cache yet, or a broken one: the first refresh parses everything */
	}
}

/**
 * Write the parse state when it changed, at most every SAVE_EVERY_MS unless `force` (shutdown).
 * Written to a temp file and renamed, so a crash never leaves a torn cache. Returns whether it wrote.
 */
export async function persistCache(path: string = cacheFilePath(), opts: { force?: boolean; now?: number } = {}): Promise<boolean> {
	const now = opts.now ?? Date.now();
	const gen = cacheGeneration();
	if (gen === savedGeneration || (!opts.force && now - lastSave < SAVE_EVERY_MS)) return false;
	try {
		const tmp = `${path}.${process.pid}.tmp`;
		await writeFile(tmp, JSON.stringify(encodeCache(exportCache())));
		await rename(tmp, path);
		savedGeneration = gen;
		lastSave = now;
		return true;
	} catch {
		return false;
	}
}

/** Test hook: forget what was saved and when. */
export function resetCacheFileState(): void {
	savedGeneration = -1;
	lastSave = -Infinity;
}
