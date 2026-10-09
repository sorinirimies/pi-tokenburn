import { describe, it, expect } from "bun:test";
import { createCoalescer, type Timers } from "../extensions/tokenburn.ts";

/** Manual timers: nothing fires until the test says so. */
function fakeTimers() {
	let next = 1;
	const pending = new Map<number, () => void>();
	const delays: number[] = [];
	const timers: Timers = {
		set: (fn, ms) => {
			const id = next++;
			pending.set(id, fn);
			delays.push(ms);
			return id;
		},
		clear: (h) => void pending.delete(h as number),
	};
	return { timers, delays, pendingCount: () => pending.size, fireAll: () => { for (const [id, fn] of [...pending]) { pending.delete(id); fn(); } } };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createCoalescer", () => {
	it("a burst of 100 schedules sets ONE timer and runs ONCE", async () => {
		let runs = 0;
		const f = fakeTimers();
		const c = createCoalescer(async () => void runs++, 750, f.timers);
		for (let i = 0; i < 100; i++) c.schedule();
		expect(f.pendingCount()).toBe(1);
		expect(f.delays).toEqual([750]);
		expect(c.isPending()).toBe(true);
		f.fireAll();
		await tick();
		expect(runs).toBe(1);
		expect(c.isPending()).toBe(false);
	});

	it("schedules again after a run, one run per window", async () => {
		let runs = 0;
		const f = fakeTimers();
		const c = createCoalescer(async () => void runs++, 10, f.timers);
		for (let w = 1; w <= 3; w++) {
			c.schedule();
			c.schedule();
			f.fireAll();
			await tick();
			expect(runs).toBe(w);
		}
	});

	it("never runs two at once: a request during a run causes exactly one follow-up", async () => {
		const f = fakeTimers();
		let active = 0;
		let maxActive = 0;
		let runs = 0;
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const c = createCoalescer(async () => {
			runs++;
			active++;
			maxActive = Math.max(maxActive, active);
			if (runs === 1) await gate;
			active--;
		}, 5, f.timers);
		c.schedule();
		f.fireAll(); // run #1 starts and blocks on the gate
		await tick();
		c.schedule(); // arrives mid-run
		f.fireAll(); // its timer fires while run #1 is still going → must not start a second run
		await tick();
		expect(runs).toBe(1);
		release();
		await tick();
		expect(f.pendingCount()).toBe(1); // the follow-up was scheduled
		f.fireAll();
		await tick();
		expect(runs).toBe(2);
		expect(maxActive).toBe(1);
	});

	it("flush runs now, drops the pending timer, and returns the run's promise", async () => {
		let runs = 0;
		const f = fakeTimers();
		const c = createCoalescer(async () => void runs++, 750, f.timers);
		c.schedule();
		await c.flush();
		expect(runs).toBe(1);
		expect(f.pendingCount()).toBe(0);
		await c.flush(); // flush with nothing pending also runs
		expect(runs).toBe(2);
	});

	it("flush during a run marks it dirty and a follow-up runs after", async () => {
		const f = fakeTimers();
		let runs = 0;
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const c = createCoalescer(async () => { runs++; if (runs === 1) await gate; }, 5, f.timers);
		const first = c.flush();
		await tick();
		void c.flush(); // second flush while the first is running
		expect(runs).toBe(1);
		release();
		await first;
		await tick();
		expect(f.pendingCount()).toBe(1);
		f.fireAll();
		await tick();
		expect(runs).toBe(2);
	});

	it("cancel drops a pending run and a pending follow-up", async () => {
		const f = fakeTimers();
		let runs = 0;
		const c = createCoalescer(async () => void runs++, 5, f.timers);
		c.schedule();
		c.cancel();
		expect(f.pendingCount()).toBe(0);
		f.fireAll();
		await tick();
		expect(runs).toBe(0);
		c.cancel(); // idempotent
	});

	it("a throwing run is swallowed and does not stop later runs", async () => {
		const f = fakeTimers();
		let runs = 0;
		const c = createCoalescer(async () => { runs++; throw new Error("boom"); }, 5, f.timers);
		c.schedule();
		f.fireAll();
		await tick();
		await expect(c.flush()).resolves.toBeUndefined();
		expect(runs).toBe(2);
	});

	it("reads the delay from a function at schedule time", () => {
		const f = fakeTimers();
		let ms = 300;
		const c = createCoalescer(async () => {}, () => ms, f.timers);
		c.schedule();
		f.fireAll();
		ms = 900;
		c.schedule();
		expect(f.delays).toEqual([300, 900]);
	});

	it("with real timers: runs once after the delay, and the timer is unref'd", async () => {
		let runs = 0;
		const c = createCoalescer(async () => void runs++, 20);
		for (let i = 0; i < 10; i++) c.schedule();
		expect(runs).toBe(0);
		await new Promise((r) => setTimeout(r, 80));
		expect(runs).toBe(1);
		c.schedule();
		c.cancel();
		await new Promise((r) => setTimeout(r, 50));
		expect(runs).toBe(1);
	});
});
