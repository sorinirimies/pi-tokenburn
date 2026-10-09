import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { collectAllSeries, collectUsage, parseCommand } from "../extensions/tokenburn.ts";

const ROOT = join(import.meta.dir, "..");
const VHS = join(ROOT, "examples", "vhs");
const read = (p: string) => readFileSync(p, "utf8");
const tapes = readdirSync(VHS).filter((f) => f.endsWith(".tape")).sort();
const gifRefsInReadme = [...read(join(ROOT, "README.md")).matchAll(/examples\/vhs\/generated\/([\w-]+\.gif)/g)].map((m) => m[1]);
const posix = process.platform !== "win32";

describe("VHS tapes", () => {
	it("there is a tape for every feature we show off", () => {
		for (const name of ["overview", "status", "charts", "budget", "enable-disable", "completion", "live-refresh"]) {
			expect(tapes, name).toContain(`${name}.tape`);
		}
	});

	for (const tape of tapes) {
		const name = tape.replace(/\.tape$/, "");
		const text = read(join(VHS, tape));

		it(`${tape}: header, output path and the shared Set block match the house style`, () => {
			expect(text.split("\n")[0]).toBe(`# VHS tape: ${name}`);
			expect(text).toContain(`Output examples/vhs/generated/${name}.gif`);
			for (const setting of ['Set Shell "bash"', "Set FontSize 14", "Set Width 1600", "Set Height 900", "Set PlaybackSpeed 1.0", 'Set Theme "Catppuccin Mocha"']) {
				expect(text, setting).toContain(setting);
			}
			// recordings only ever run on the synthetic fixture, with the real pi but only this extension
			expect(text).toContain("examples/vhs/fixture.sh");
			expect(text).toContain("examples/vhs/pi-demo.sh");
			expect(text).toContain("Wait+Screen@30s");
			expect(text).toContain("never reads your real sessions");
		});

		it(`${tape}: every /tokenburn command it types is valid, and is run with pi's two-step Enter`, () => {
			const lines = text.split("\n");
			let checked = 0;
			lines.forEach((line, i) => {
				const m = line.match(/^Type "(\/tokenburn[^"]*)"$/);
				if (!m || m[1].endsWith(" ")) return; // a bare `/tokenburn ` only opens the menu
				const arg = m[1].replace(/^\/tokenburn\s*/, "");
				expect(parseCommand(arg).kind, `"${m[1]}" in ${tape}`).not.toBe("invalid");
				// Enter #1 accepts pi's autocomplete suggestion, Enter #2 runs the command
				let enters = 0;
				for (let j = i + 1; j < lines.length && !lines[j].startsWith("Type "); j++) if (lines[j] === "Enter") enters++;
				expect(enters, `"${m[1]}" needs two Enters in ${tape}`).toBe(2);
				checked++;
			});
			if (name !== "completion" && name !== "live-refresh") expect(checked).toBeGreaterThan(0);
		});
	}

	it("the live-refresh tape quits pi and stops its mock model", () => {
		const text = read(join(VHS, "live-refresh.tape"));
		expect(text).toContain("mock-llm.ts");
		expect(text).toContain("PI_DEMO_LIVE=1");
		expect(text).toMatch(/Ctrl\+D[\s\S]*pkill -f mock-llm/);
	});
});

describe("README previews and Git LFS", () => {
	it("every GIF the README shows is produced by a tape, and every tape's GIF is shown", () => {
		const produced = tapes.map((t) => t.replace(/\.tape$/, ".gif"));
		for (const gif of new Set(gifRefsInReadme)) expect(produced, `README shows ${gif}`).toContain(gif);
		for (const gif of produced) expect(gifRefsInReadme, `README should show ${gif}`).toContain(gif);
	});

	it("the GIFs exist (real files, or LFS pointers in a checkout without LFS)", () => {
		for (const gif of new Set(gifRefsInReadme)) {
			const p = join(VHS, "generated", gif);
			expect(existsSync(p), gif).toBe(true);
			expect(statSync(p).size, gif).toBeGreaterThan(50); // an LFS pointer is ~130 bytes
		}
	});

	it("GIFs and generated PNGs are tracked with Git LFS, like the Rust tokenburn project", () => {
		const attrs = read(join(ROOT, ".gitattributes"));
		expect(attrs).toContain("*.gif filter=lfs diff=lfs merge=lfs -text");
		expect(attrs).toContain("examples/vhs/generated/*.png filter=lfs diff=lfs merge=lfs -text");
	});

	it("the demo assets never ship in the npm package", () => {
		const pkg = JSON.parse(read(join(ROOT, "package.json")));
		expect(pkg.files).not.toContain("examples");
		expect((pkg.files as string[]).every((f) => !f.startsWith("examples"))).toBe(true);
	});

	it("documents how to regenerate and how LFS is used", () => {
		const md = read(join(ROOT, "README.md"));
		for (const s of ["Git LFS", "git lfs install", "just vhs-all", "just vhs-tape", "just demo", "synthetic"]) expect(md, s).toContain(s);
	});
});

describe.skipIf(!posix)("synthetic fixture (examples/vhs/fixture.sh)", () => {
	const run = (...args: string[]) => Bun.spawnSync(["bash", join(VHS, "fixture.sh"), ...args], { cwd: ROOT });
	const sessions = () => {
		const env = Object.fromEntries(run("env").stdout.toString().split("\n").filter(Boolean).map((l) => l.replace(/^export /, "").split("=")));
		return { env, dir: join(env.PI_CODING_AGENT_DIR, "sessions") };
	};
	const totals = async (dir: string) => {
		const r = await collectUsage(dir);
		return { r, history: r.total.tokens - r.today.tokens };
	};

	beforeAll(() => {
		expect(run().exitCode).toBe(0);
	});

	it("`env` points pi at the throw-away dirs, offline and in UTC", () => {
		const { env } = sessions();
		expect(env.HOME).toMatch(/pi-tokenburn-demo\/home$/);
		expect(env.PI_CODING_AGENT_DIR).toMatch(/pi-tokenburn-demo\/agent$/);
		expect(env.PI_OFFLINE).toBe("1");
		expect(env.TZ).toBe("UTC");
		expect(env.HOME).not.toBe(homedir());
	});

	it("builds ~2.5 years of sessions with data for every window the demos show", async () => {
		const { dir } = sessions();
		const { r } = await totals(dir);
		for (const w of ["today", "week", "month", "year", "total"] as const) expect(r[w].tokens, w).toBeGreaterThan(0);
		expect(r.total.tokens).toBeGreaterThan(r.year.tokens); // history older than this year
		const all = await collectAllSeries(dir);
		expect(all.unit).toBe("year"); // so `chart all` is a yearly chart
		expect(all.series.length).toBeGreaterThanOrEqual(3);
	});

	it("is deterministic (history is identical on every build; only today's cut-off moves)", async () => {
		const { dir } = sessions();
		const first = (await totals(dir)).history;
		expect(run().exitCode).toBe(0);
		expect((await totals(dir)).history).toBe(first);
	});

	it("`append` adds one fresh assistant turn", async () => {
		const { dir } = sessions();
		const before = (await collectUsage(dir)).today.tokens;
		expect(run("append").exitCode).toBe(0);
		expect((await collectUsage(dir)).today.tokens).toBeGreaterThan(before);
	});

	it("writes a demo config, a mock model and settings, and leaks nothing about the real machine", () => {
		const { env } = sessions();
		const agent = env.PI_CODING_AGENT_DIR;
		const cfg = JSON.parse(read(join(agent, "tokenburn.json")));
		expect(cfg).toMatchObject({ enabled: true, statusWindow: "today", showWidget: false, refreshMs: 250 });
		const models = JSON.parse(read(join(agent, "models.json")));
		expect(models.providers.demo.baseUrl).toBe("http://127.0.0.1:8989/v1");
		expect(models.providers.demo.models[0].id).toBe("demo-model");
		expect(JSON.parse(read(join(agent, "settings.json")))).toMatchObject({ defaultProvider: "demo", defaultModel: "demo-model" });

		const leaks: string[] = [];
		const secrets = [homedir(), userInfo().username].filter((s) => s.length > 3);
		const walk = (d: string) => {
			for (const e of readdirSync(d, { withFileTypes: true })) {
				const full = join(d, e.name);
				if (e.isDirectory()) walk(full);
				else if (secrets.some((s) => read(full).includes(s) || full.includes(s))) leaks.push(full);
			}
		};
		walk(join(agent, ".."));
		expect(leaks).toEqual([]);
	});

	it("pi-demo.sh and fixture.sh are valid bash", () => {
		for (const f of ["pi-demo.sh", "fixture.sh"]) expect(Bun.spawnSync(["bash", "-n", join(VHS, f)]).exitCode, f).toBe(0);
	});
});

describe("mock model (examples/vhs/mock-llm.ts)", () => {
	const port = 18900 + Math.floor(Math.random() * 400);
	const base = `http://127.0.0.1:${port}`;
	let proc: ReturnType<typeof Bun.spawn>;

	beforeAll(async () => {
		proc = Bun.spawn(["bun", join(VHS, "mock-llm.ts"), String(port)], { stdout: "ignore", stderr: "ignore" });
		for (let i = 0; i < 60; i++) {
			try {
				if ((await fetch(`${base}/v1/models`)).ok) return;
			} catch {}
			await new Promise((r) => setTimeout(r, 100));
		}
		throw new Error("mock-llm did not start");
	});
	afterAll(() => proc?.kill());

	it("lists the demo model", async () => {
		const body = (await (await fetch(`${base}/v1/models`)).json()) as { data: { id: string }[] };
		expect(body.data.map((m) => m.id)).toEqual(["demo-model"]);
	});

	it("answers a non-streaming chat with a reply and token usage", async () => {
		const res = await fetch(`${base}/v1/chat/completions`, { method: "POST", body: JSON.stringify({ model: "demo-model", messages: [] }) });
		const body = (await res.json()) as any;
		expect(body.choices[0].message.content).toContain("demo model");
		expect(body.usage.total_tokens).toBe(body.usage.prompt_tokens + body.usage.completion_tokens);
		expect(body.usage.prompt_tokens_details.cached_tokens).toBeGreaterThan(0);
	});

	it("streams SSE: role, words, a final chunk carrying usage, then [DONE]", async () => {
		const res = await fetch(`${base}/v1/chat/completions`, { method: "POST", body: JSON.stringify({ model: "demo-model", stream: true, messages: [] }) });
		expect(res.headers.get("content-type")).toContain("text/event-stream");
		const text = await res.text();
		const events = text.split("\n\n").filter((e) => e.startsWith("data: ") && !e.includes("[DONE]")).map((e) => JSON.parse(e.slice(6)));
		expect(events[0].choices[0].delta.role).toBe("assistant");
		const content = events.map((e) => e.choices[0].delta.content ?? "").join("");
		expect(content).toContain("nothing leaves this machine");
		const last = events.at(-1);
		expect(last.choices[0].finish_reason).toBe("stop");
		expect(last.usage.completion_tokens).toBeGreaterThan(0);
		expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
	});

	it("tolerates a malformed body and 404s everything else", async () => {
		const res = await fetch(`${base}/v1/chat/completions`, { method: "POST", body: "{not json" });
		expect(res.status).toBe(200);
		expect((await fetch(`${base}/v1/nope`)).status).toBe(404);
		expect((await fetch(`${base}/v1/chat/completions`)).status).toBe(404);
	});
});
