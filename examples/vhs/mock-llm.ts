/**
 * A tiny OpenAI-compatible chat endpoint for the demos (no network, no API key, no real model).
 * It answers every request with a short canned reply and a realistic token `usage`, so pi writes
 * a genuine assistant turn to its session log and pi-tokenburn's live refresh has something to show.
 *
 *   bun examples/vhs/mock-llm.ts [port]      (default 8989)
 */
const port = Number(process.argv[2] ?? 8989);

const REPLY = "Sure. Here is a short answer from the demo model: tokens in, tokens out, nothing leaves this machine.";
const USAGE = { prompt_tokens: 152_000, completion_tokens: 2_300, total_tokens: 154_300, prompt_tokens_details: { cached_tokens: 148_000 } };

const chunk = (delta: object, finish: string | null = null, usage?: object) =>
	`data: ${JSON.stringify({ id: "demo", object: "chat.completion.chunk", created: 0, model: "demo-model", choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`;

Bun.serve({
	port,
	hostname: "127.0.0.1",
	async fetch(req) {
		const url = new URL(req.url);
		if (req.method === "GET" && url.pathname.endsWith("/models")) {
			return Response.json({ object: "list", data: [{ id: "demo-model", object: "model" }] });
		}
		if (req.method !== "POST" || !url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 });
		const body = (await req.json().catch(() => ({}))) as { stream?: boolean };
		if (!body.stream) {
			return Response.json({
				id: "demo", object: "chat.completion", created: 0, model: "demo-model", usage: USAGE,
				choices: [{ index: 0, message: { role: "assistant", content: REPLY }, finish_reason: "stop" }],
			});
		}
		const enc = new TextEncoder();
		const stream = new ReadableStream({
			async start(controller) {
				const send = (s: string) => controller.enqueue(enc.encode(s));
				send(chunk({ role: "assistant", content: "" }));
				for (const word of REPLY.split(" ")) {
					send(chunk({ content: word + " " }));
					await new Promise((r) => setTimeout(r, 25));
				}
				send(chunk({}, "stop", USAGE));
				send("data: [DONE]\n\n");
				controller.close();
			},
		});
		return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
	},
});
console.error(`mock-llm listening on http://127.0.0.1:${port}`);
