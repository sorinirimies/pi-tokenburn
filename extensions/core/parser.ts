/**
 * Session-log parser with a per-file incremental cache. Pi session logs are append-only
 * JSONL, so after the first parse only the appended bytes are read.
 */
import { readdirSync, statSync } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export interface Turn {
	ts: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	/** Cost split, used to estimate what prompt caching saved. */
	costInput: number;
	costCacheRead: number;
	provider: string;
	model: string;
	/** Working directory of the session (falls back to the session directory name). */
	project: string;
	/** Session file path. */
	session: string;
}

/** Per-file context for a parse: where the file is and the cwd from its header line. */
interface Meta {
	file: string;
	cwd?: string;
}

/** What was read from disk, for tests and tuning: refreshes must cost O(new bytes). */
export const stats = { bytesRead: 0, fullParses: 0, incrementalParses: 0 };

export function resetStats(): void {
	stats.bytesRead = 0;
	stats.fullParses = 0;
	stats.incrementalParses = 0;
}

/**
 * Per-session-file parse state. Pi session logs are append-only JSONL, so after the first
 * parse only the bytes added since then are read. The state is dropped (full reparse) when
 * the file shrank, was rewritten in place, or its head / last-parsed bytes no longer match.
 */
interface FileEntry {
	size: number;
	mtimeMs: number;
	/** End of the last COMPLETE (newline-terminated) line that was parsed. */
	offset: number;
	turns: Turn[];
	/** Turn from an unterminated final line; counted now, re-parsed once the line completes. */
	tail: Turn[];
	cwd?: string;
	/** First bytes of the file, to notice a rewrite. */
	head: Buffer;
	/** The bytes just before `offset`, same purpose. */
	guard: Buffer;
}

const FILE_CACHE = new Map<string, FileEntry>();
const GUARD_BYTES = 64;
const HEAD_BYTES = 256;
export const CHUNK_BYTES = 1 << 20;

/** A finite number, else 0 (logs can hold 1e999, strings, junk). */
const finite = (v: unknown): number => {
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
};

/** A Turn from one JSONL line, or undefined when it carries no usage. */
function turnFromLine(line: Buffer, meta: Meta): Turn | undefined {
	if (meta.cwd === undefined && line.includes('"type":"session"')) {
		try {
			const h = JSON.parse(line.toString("utf8"));
			if (h.type === "session" && typeof h.cwd === "string") meta.cwd = h.cwd;
		} catch {
			/* not a header */
		}
		return undefined;
	}
	if (!line.includes('"usage"')) return undefined; // most lines: skip without a JSON parse
	try {
		const obj = JSON.parse(line.toString("utf8"));
		const usage = obj.message?.usage;
		if (!obj.timestamp || !usage) return undefined;
		const ts = new Date(obj.timestamp).getTime();
		if (!Number.isFinite(ts)) return undefined;
		return {
			ts,
			input: finite(usage.input),
			output: finite(usage.output),
			cacheRead: finite(usage.cacheRead),
			cacheWrite: finite(usage.cacheWrite),
			cost: finite(usage.cost?.total),
			costInput: finite(usage.cost?.input),
			costCacheRead: finite(usage.cost?.cacheRead),
			provider: String(obj.message?.provider ?? "unknown"),
			model: String(obj.message?.model ?? "unknown"),
			project: meta.cwd ?? basename(dirname(meta.file)),
			session: meta.file,
		};
	} catch {
		return undefined;
	}
}

async function readAt(fd: FileHandle, buf: Buffer, position: number): Promise<number> {
	const { bytesRead } = await fd.read(buf, 0, buf.length, position);
	stats.bytesRead += bytesRead;
	return bytesRead;
}

/** Parse complete lines in [start, end). Returns their turns, where they stop, and the unterminated rest. */
async function scan(
	fd: FileHandle,
	start: number,
	end: number,
	chunkSize: number,
	meta: Meta,
): Promise<{ turns: Turn[]; consumed: number; rest: Buffer }> {
	const turns: Turn[] = [];
	const buf = Buffer.allocUnsafe(Math.min(chunkSize, Math.max(1, end - start)));
	let pos = start;
	let consumed = start;
	let carry: Buffer = Buffer.alloc(0);
	while (pos < end) {
		const want = Math.min(buf.length, end - pos);
		const n = await readAt(fd, want === buf.length ? buf : buf.subarray(0, want), pos);
		if (n === 0) break;
		const base = pos - carry.length;
		const data = carry.length > 0 ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
		let lineStart = 0;
		for (let nl = data.indexOf(10, lineStart); nl !== -1; nl = data.indexOf(10, lineStart)) {
			const t = turnFromLine(data.subarray(lineStart, nl), meta);
			if (t) turns.push(t);
			lineStart = nl + 1;
		}
		if (lineStart > 0) consumed = base + lineStart;
		carry = Buffer.from(data.subarray(lineStart)); // copy: `buf` is reused
		pos += n;
	}
	return { turns, consumed, rest: carry };
}

async function bytesAt(fd: FileHandle, position: number, length: number): Promise<Buffer> {
	if (length <= 0) return Buffer.alloc(0);
	const buf = Buffer.alloc(length);
	const n = await readAt(fd, buf, position);
	return buf.subarray(0, n);
}

/** Is the prefix we parsed earlier still what is on disk? */
async function stillAppendOnly(fd: FileHandle, prev: FileEntry): Promise<boolean> {
	const head = await bytesAt(fd, 0, prev.head.length);
	if (!head.equals(prev.head)) return false;
	const guard = await bytesAt(fd, prev.offset - prev.guard.length, prev.guard.length);
	return guard.equals(prev.guard);
}

async function refreshEntry(
	file: string,
	st: { size: number; mtimeMs: number },
	prev: FileEntry | undefined,
	chunkSize: number,
): Promise<FileEntry | undefined> {
	let fd: FileHandle;
	try {
		fd = await open(file, "r");
	} catch {
		return undefined;
	}
	try {
		const grew = prev !== undefined && st.size > prev.size;
		const incremental = grew && (await stillAppendOnly(fd, prev!));
		const start = incremental ? prev!.offset : 0;
		const turns = incremental ? prev!.turns : [];
		if (incremental) stats.incrementalParses++;
		else stats.fullParses++;

		const meta: Meta = { file, cwd: incremental ? prev!.cwd : undefined };
		const r = await scan(fd, start, st.size, chunkSize, meta);
		for (const t of r.turns) turns.push(t);
		const tailTurn = r.rest.length > 0 ? turnFromLine(r.rest, meta) : undefined;
		return {
			size: st.size,
			mtimeMs: st.mtimeMs,
			offset: r.consumed,
			turns,
			tail: tailTurn ? [tailTurn] : [],
			cwd: meta.cwd,
			head: incremental ? prev!.head : await bytesAt(fd, 0, Math.min(HEAD_BYTES, st.size)),
			guard: await bytesAt(fd, Math.max(0, r.consumed - GUARD_BYTES), Math.min(GUARD_BYTES, r.consumed)),
		};
	} catch {
		return undefined;
	} finally {
		await fd.close();
	}
}

/** Size and mtime of a file, or undefined when it cannot be stat'ed. */
export function fileStat(file: string): { size: number; mtimeMs: number } | undefined {
	try {
		const st = statSync(file);
		return { size: st.size, mtimeMs: st.mtimeMs };
	} catch {
		return undefined;
	}
}

function listSessionFiles(root: string): string[] {
	const files: string[] = [];
	const walk = (dir: string) => {
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			const full = join(dir, e.name);
			if (e.isDirectory()) walk(full);
			else if (e.isFile() && e.name.endsWith(".jsonl")) files.push(full);
		}
	};
	walk(root);
	return files;
}

/** Bring the per-file cache up to date (reading only what changed) and return every file's turns. */
export async function loadAll(sessionsRoot: string, chunkSize = CHUNK_BYTES): Promise<Turn[][]> {
	const files = listSessionFiles(sessionsRoot);
	const live = new Set(files);
	for (const key of FILE_CACHE.keys()) if (!live.has(key)) FILE_CACHE.delete(key);

	const out: Turn[][] = [];
	for (const file of files) {
		const st = fileStat(file);
		if (st === undefined) continue; // vanished between listing and stat
		let entry = FILE_CACHE.get(file);
		if (!entry || entry.size !== st.size || entry.mtimeMs !== st.mtimeMs) {
			const fresh = await refreshEntry(file, st, entry, chunkSize);
			if (fresh) FILE_CACHE.set(file, fresh);
			else FILE_CACHE.delete(file);
			entry = fresh;
		}
		if (entry) out.push(entry.tail.length > 0 ? entry.turns.concat(entry.tail) : entry.turns);
	}
	return out;
}

/** Test hooks: parse with a tiny chunk size (chunk boundaries) / refresh one file directly. */
export const __loadAllForTests = loadAll;
export const __refreshEntryForTests = refreshEntry;

export function clearCache(): void {
	FILE_CACHE.clear();
}
