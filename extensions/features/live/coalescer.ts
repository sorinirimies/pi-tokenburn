/** Live refresh scheduling. */

export interface Timers {
	set: (fn: () => void, ms: number) => unknown;
	clear: (handle: unknown) => void;
}

const realTimers: Timers = {
	set: (fn, ms) => setTimeout(fn, ms),
	clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * Runs `run` at most once per `delayMs` window however often `schedule()` is called
 * (trailing edge), and never two runs at once: a request that arrives mid-run triggers one
 * more run afterwards. A burst of 50 messages costs one refresh. Failures are swallowed;
 * the timer never keeps the process alive.
 */
export function createCoalescer(
	run: () => Promise<void>,
	delayMs: number | (() => number),
	timers: Timers = realTimers,
) {
	let timer: unknown;
	let running = false;
	let dirty = false;

	const execute = async () => {
		if (running) {
			dirty = true;
			return;
		}
		running = true;
		try {
			await run();
		} catch {
			/* a failed refresh must never surface */
		} finally {
			running = false;
		}
		if (dirty) {
			dirty = false;
			schedule();
		}
	};

	const schedule = () => {
		if (timer !== undefined) return; // one is already pending: coalesce
		const ms = typeof delayMs === "function" ? delayMs() : delayMs;
		timer = timers.set(() => {
			timer = undefined;
			void execute();
		}, ms);
		(timer as { unref?: () => void } | undefined)?.unref?.();
	};

	const cancel = () => {
		if (timer !== undefined) timers.clear(timer);
		timer = undefined;
		dirty = false;
	};

	/** Run now (dropping any pending delayed run). */
	const flush = () => {
		if (timer !== undefined) timers.clear(timer);
		timer = undefined;
		return execute();
	};

	return { schedule, cancel, flush, isPending: () => timer !== undefined };
}
