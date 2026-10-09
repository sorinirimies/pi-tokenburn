# pi-tokenburn

Token usage and cost monitor with budgets, directly in your [Pi](https://github.com/earendil-works/pi-coding-agent) session.

TypeScript port of the pi collector from [tokenburn](https://github.com/sorinirimies/tokenburn).
Reads Pi's local session logs (`~/.pi/agent/sessions/**/*.jsonl`). **No network, zero prompt tokens.**
Totals match the `tokenburn` CLI exactly.

## Features

- **Status bar:** `🔥 1.20M ($52.79) [today]`, turns red with `OVER BUDGET` past your limit.
- **Window panel (optional):** Today / Week / Month / Total below the editor, with in/out tokens and cost.
- **Budgets** per day, week and month, in tokens and/or dollars.
- **Fast:** per-file cache keyed on mtime+size. First scan of ~400 MB of sessions takes under a second; refreshes after that take milliseconds. Refresh never blocks the agent loop.

## Install

```bash
pi install npm:pi-tokenburn
# or
pi install git:github.com/sorinirimies/pi-tokenburn
```

## Commands

| Command | What it does |
|---|---|
| `/tokenburn` | Print the Today / Week / Month / All-time report |
| `/tokenburn window` | Toggle the panel below the editor |
| `/tokenburn status <today\|week\|month\|total>` | Period shown in the status bar |
| `/tokenburn budget <day\|week\|month> <tokens>` | Token budget, e.g. `budget day 5000000` |
| `/tokenburn budget <day\|week\|month> $<cost>` | Dollar budget, e.g. `budget week $50` |
| `/tokenburn cache` | Toggle counting cache read/write tokens |

Weeks start on Monday, in local time.

## Config

`~/.pi/agent/tokenburn.json` (written by the commands, editable by hand):

```json
{
  "includeCache": true,
  "showStatus": true,
  "showWidget": false,
  "statusWindow": "today",
  "budgets": { "dayTokens": 5000000, "weekCost": 50 }
}
```

- `includeCache` (default `true`): count cache read/write tokens in totals, like the `tokenburn` CLI. Cache reads dominate (often 95%+ of tokens) but are billed far cheaper; set `false` to budget on input + output only.

Environment overrides for the session directory: `TOKENBURN_PI_SESSIONS`, `PI_CODING_AGENT_SESSION_DIR`, `PI_CODING_AGENT_DIR`.

## Develop

```bash
bun test
```

## Scope

Pi sessions only. For Zed, Claude Code, Codex, Gemini and more, use the Rust [tokenburn](https://github.com/sorinirimies/tokenburn).

MIT
