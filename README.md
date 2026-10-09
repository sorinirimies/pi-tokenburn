# pi-tokenburn

Token usage and cost monitor with budgets, directly in your [Pi](https://github.com/earendil-works/pi-coding-agent) session.

TypeScript port of the pi collector from [tokenburn](https://github.com/sorinirimies/tokenburn).
Reads Pi's local session logs (`~/.pi/agent/sessions/**/*.jsonl`). **No network, zero prompt tokens.**
Totals match the `tokenburn` CLI exactly.

## Features

- **Status bar:** `🔥 1.20M ($52.79) [today]`, turns red with `OVER BUDGET` past your limit.
- **Report chart:** `/tokenburn` shows the summary plus a vertical column chart (y-axis, budget line, current period marked, over-budget columns in red, peak/avg footer). Daily (14 days), weekly (8 weeks) or monthly (6 months).
- **Status line:** `/tokenburn day|week|month|year|all` (or `cycle`) changes the period shown at the bottom. Charts live under `/tokenburn chart <view>`.
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
| `/tokenburn day\|week\|month\|year\|all` | **Switch the bottom status line**: today, this week, this month, this year, or the all-time total |
| `/tokenburn chart <view>` | Report + **chart**. Views: `day` (14 days), `week` (8 weeks), `month` (6 months), `year` (5 years), `all` (whole history; monthly columns up to 18 months, yearly beyond) |
| `/tokenburn` | Report + daily chart (same as `/tokenburn chart day`) |
| `/tokenburn cycle` | Rotate the status line: today → week → month → year → total |
| `/tokenburn status <today\|week\|month\|year\|total>` | Explicit form of the first row |
| `/tokenburn window` | Toggle the panel below the editor |
| `/tokenburn budget <day\|week\|month> <tokens>` | Token budget, e.g. `budget day 5000000` |
| `/tokenburn budget <day\|week\|month> $<cost>` | Dollar budget, e.g. `budget week $50` |
| `/tokenburn cache` | Toggle counting cache read/write tokens |

Tab-completion works for all of these. Unknown input prints usage instead of failing. `report <view>` is kept as an alias of `chart <view>`.

Chart example (`/tokenburn chart day`, with a 600M day budget):

```
Daily tokens · last 14 days  ┄ budget 600.00M
   1.13B │         ██
         │         ██
         │┄┄┄┄┄┄┄┄┄██┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄██┄▆▆┄┄┄┄┄┄┄┄┄┄
 565.16M │         ██                ██ ██ ▇▇
         │      ▅▅ ██    ▂▂ ██    ▁▁ ██ ██ ██ ▄▄ ▇▇
         └──────────────────────────────────────────
          26 27 28 29 30 01 02 03 04 05 06 07 08 09
          Sa Su Mo Tu We Th Fr Sa Su Mo Tu We Th Fr
                                                 ▲
Σ 3.83B ($1264.30) · avg 273.80M/day · peak 1.13B (09-29 Tue)
```

Weeks start on Monday, in local time.

## Config

`~/.pi/agent/tokenburn.json` (written by the commands, editable by hand):

```json
{
  "includeCache": true,
  "chartColor": true,
  "showStatus": true,
  "showWidget": false,
  "statusWindow": "today",
  "budgets": { "dayTokens": 5000000, "weekCost": 50 }
}
```

- `includeCache` (default `true`): count cache read/write tokens in totals, like the `tokenburn` CLI. Cache reads dominate (often 95%+ of tokens) but are billed far cheaper; set `false` to budget on input + output only.

- `chartColor` (default `true`): color the chart using your pi theme (current period green, over-budget red, budget line yellow). Set `false` for plain text.

Environment overrides for the session directory: `TOKENBURN_PI_SESSIONS`, `PI_CODING_AGENT_SESSION_DIR`, `PI_CODING_AGENT_DIR`.

## Security notes

- **Local and read-only.** It reads pi's session logs and its own `tokenburn.json`. Nothing leaves your machine: no network, no telemetry, no shell commands, **zero runtime dependencies**.
- **Never breaks pi.** Stats refreshes are fire-and-forget and swallow their own errors, so a failure here cannot interrupt a turn or a session start.
- **Hand-edited config is sanitised.** Unknown or non-numeric budget values are dropped.

## Development

```bash
bun install
just check          # typecheck + tests + pack check + nushell tests (what CI runs)
just test           # bun test only (with coverage)
just coverage       # tests + a coverage table
```

**Coverage:** every `bun test` collects coverage (`bunfig.toml`) and **fails below 95% lines / 95% functions**. CI shows the table on the run page and uploads `lcov.info`.

CI scripts are [nushell](https://www.nushell.sh) (`scripts/`), the same ones locally and in GitHub / Gitea Actions.
`just --list` shows every task.

## Releases (automatic)

| Workflow | When | What |
|---|---|---|
| **CI** | push / PR | quality gate on Linux; tests on macOS, Windows and extreme time zones |
| **Nightly Dependency Update** | every night (GitHub 02:00 UTC, Gitea 02:30) | `bun update` within ranges, verify on all platforms, commit `chore(deps)`; then **publish a patch** when a *runtime* dependency was upgraded or `feat`/`fix`/`perf` commits are waiting since the last tag |
| **Release** | tag `vX.Y.Z` | validates the tag against `package.json`, runs the gate, `npm publish` (idempotent), creates the release |

Dev-tooling-only bumps are committed but never released on their own. A downgrade blocks the whole update.

Manual release: `just bump patch` (or `minor` / `major` / `X.Y.Z`), then `just release-push`.

**Secrets** (repo settings): `NPM_TOKEN` — npm *granular access token* with publish rights and "bypass 2FA" (required for CI publishing). Optional: `GH_PAT` (lets a tag push trigger the release itself), `GITEA_TOKEN` (Gitea).

Commits follow [Conventional Commits](https://www.conventionalcommits.org); the changelog is generated by git-cliff.

## Scope

Pi sessions only. For Zed, Claude Code, Codex, Gemini and more, use the Rust [tokenburn](https://github.com/sorinirimies/tokenburn).

MIT
