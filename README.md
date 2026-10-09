# pi-tokenburn

[![npm](https://img.shields.io/npm/v/pi-tokenburn.svg)](https://www.npmjs.com/package/pi-tokenburn)
[![npm downloads](https://img.shields.io/npm/dm/pi-tokenburn.svg)](https://www.npmjs.com/package/pi-tokenburn)
[![CI](https://github.com/sorinirimies/pi-tokenburn/actions/workflows/ci.yml/badge.svg)](https://github.com/sorinirimies/pi-tokenburn/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Token usage and cost monitor with budgets, directly in your [Pi](https://github.com/earendil-works/pi-coding-agent) session.

TypeScript port of the pi collector from [tokenburn](https://github.com/sorinirimies/tokenburn).
Reads Pi's local session logs (`~/.pi/agent/sessions/**/*.jsonl`). **No network, zero prompt tokens.**
Totals match the `tokenburn` CLI exactly.

<img src="examples/vhs/generated/overview.gif" alt="pi-tokenburn: the live footer counter, a report with a daily chart, switching the footer period and a weekly chart" width="900">

## Features

- **Status bar:** `🔥 1.20M ($52.79) [today]`, turns red with `OVER BUDGET` past your limit.
- **Report chart:** `/tokenburn` shows the summary plus a vertical column chart (y-axis, budget line, current period marked, over-budget columns in red, peak/avg footer). Daily (14 days), weekly (8 weeks) or monthly (6 months).
- **Status line:** `/tokenburn day|week|month|year|all` (or `cycle`) changes the period shown at the bottom. Charts live under `/tokenburn chart <view>`.
- **Window panel (optional):** Today / Week / Month / Total below the editor, with in/out tokens and cost.
- **Budgets** per day, week and month, in tokens and/or dollars.
- **Live:** the bottom line updates after every assistant message, not only when a turn ends, at no measurable cost (see Performance).
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
| `/tokenburn live` | Toggle refreshing after each assistant message (on by default) |
| `/tokenburn disable` (`off`) | Turn tokenburn off: status line and panel cleared, **nothing runs in the background**. `chart` still works on demand |
| `/tokenburn enable` (`on`) | Turn it back on. Both are remembered across sessions |

### Previews

Recorded from a real pi with only this plugin loaded, on synthetic data.

**Switch what the bottom line shows** (`/tokenburn day|week|month|year|all`, or `cycle`):

![Status line: week, month, year, all, day, then cycle](examples/vhs/generated/status.gif)

**Charts** (`/tokenburn chart day|week|month|year|all`): the current period is green, with a peak and average footer:

![Charts: day, week, month, year and all-time](examples/vhs/generated/charts.gif)

**Budgets** (`/tokenburn budget day 150000`, `budget week $2.5`): the footer turns red past the limit, and the chart draws the budget line with over-budget columns in red:

![Budgets: OVER BUDGET in the footer and red columns in the chart](examples/vhs/generated/budget.gif)

**Live refresh:** the footer updates after every assistant message, not only when a turn ends (here a local mock model answers; pi writes the turn to its session log and the counter moves by itself):

![Live refresh: the counter and cost tick up as the reply lands](examples/vhs/generated/live-refresh.gif)

**Enable / disable:** off means off (nothing runs in the background), and charts still work on demand:

![Disable clears the footer, a chart still works, enable brings it back](examples/vhs/generated/enable-disable.gif)

**Tab-completion** uses pi's own menu, with a description for every option:

![Autocomplete for /tokenburn and its chart sub-menu](examples/vhs/generated/completion.gif)

Tab-completion works for all of these. Unknown input prints usage instead of failing. `report <view>` is kept as an alias of `chart <view>`.

Chart example (`/tokenburn chart day`, with a 150k day budget):

```
Daily tokens · last 14 days  ┄ budget 150.0k
 291.9k │                                 ██ ▄▄    
        │                                 ██ ██    
        │      ▃▃          ▅▅             ██ ██    
        │┄┄┄┄┄┄██┄┄┄┄┄┄┄┄┄┄██┄┄┄┄┄┄┄▆▆┄┄┄┄██┄██┄▅▅┄
 146.0k │      ██          ██       ██    ██ ██ ██ 
        │      ██    ▂▂ ▇▇ ██       ██ ▇▇ ██ ██ ██ 
        │▁▁    ██    ██ ██ ██       ██ ██ ██ ██ ██ 
        │██ ▇▇ ██ ▅▅ ██ ██ ██ ▃▃ ▁▁ ██ ██ ██ ██ ██ 
        └──────────────────────────────────────────
         26 27 28 29 30 01 02 03 04 05 06 07 08 09 
         Sa Su Mo Tu We Th Fr Sa Su Mo Tu We Th Fr 
                                                ▲  
Σ 1.74M ($4.81) · avg 124.4k/day · peak 291.9k (10-07 Wed)
```

Weeks start on Monday, in local time.

## Config

`~/.pi/agent/tokenburn.json` (written by the commands, editable by hand):

```json
{
  "enabled": true,
  "liveRefresh": true,
  "refreshMs": 750,
  "includeCache": true,
  "chartColor": true,
  "showStatus": true,
  "showWidget": false,
  "statusWindow": "today",
  "budgets": { "dayTokens": 5000000, "weekCost": 50 }
}
```

- `includeCache` (default `true`): count cache read/write tokens in totals, like the `tokenburn` CLI. Cache reads dominate (often 95%+ of tokens) but are billed far cheaper; set `false` to budget on input + output only.

- `enabled` (default `true`): master switch, same as `/tokenburn enable|disable`.
- `liveRefresh` (default `true`): refresh after each assistant message. `false` = only when a turn ends. `refreshMs` (default `750`, range 250 to 60000) is the coalescing delay.
- `chartColor` (default `true`): color the chart using your pi theme (current period green, over-budget red, budget line yellow). Set `false` for plain text.

Environment overrides for the session directory: `TOKENBURN_PI_SESSIONS`, `PI_CODING_AGENT_SESSION_DIR`, `PI_CODING_AGENT_DIR`.

## Performance

Refreshing is designed to cost nothing you can notice:

- **Incremental:** pi's session logs are append-only, so after the first parse only the bytes added since then are read (with a cheap integrity check that falls back to a full parse if a file was rewritten or truncated). On a 35 MB active session a refresh after one new message takes **~1.2 ms**, down from ~18 ms, and the cost no longer grows with the session.
- **Coalesced:** a burst of messages triggers one refresh (trailing delay, `refreshMs`), never two at once.
- **Never blocks:** refreshes are fire-and-forget and errors are swallowed; the timer is unref'd and cancelled at shutdown.
- **Off means off:** `/tokenburn disable` (or `"enabled": false`) reads no files and starts no timers.

## Demo recordings

The GIFs above live in [`examples/vhs/generated/`](examples/vhs/generated) and are stored with **Git LFS** (`git lfs install` once). They are recorded with [VHS](https://github.com/charmbracelet/vhs) from a **real pi** that loads only this extension, on **synthetic** data (`examples/vhs/fixture.sh`: 900 days of made-up sessions in `/tmp` with deliberately small numbers, and a local mock model for the live-refresh demo), never from real logs, paths or credentials:

```sh
just vhs-all          # every tape (examples/vhs/*.tape): needs vhs, ttyd, ffmpeg, pi, bun, python3
just vhs-tape charts  # one tape
just vhs-list         # list the tapes
just demo             # try it yourself in a real pi on the same synthetic data
```

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
| **CI** | push / PR | quality gate on Linux; tests on macOS and Windows, and in extreme time zones |
| **Auto-merge library updates** | CI finished on a Dependabot PR | **patch and minor** updates (GitHub Actions) are merged automatically, but only **after CI is green** on that exact commit; a **major** update waits for you. Then it starts the nightly workflow so the update ships |
| **Nightly Dependency Update** | every night (GitHub 02:00 UTC, Gitea 02:30) and after each auto-merge | `bun update` within ranges, verify on all platforms, commit `chore(deps)`; then **build, tag and publish a new patch** whenever a library was upgraded or merged, or `feat`/`fix`/`perf` commits are waiting since the last tag |
| **Release** | tag `vX.Y.Z` | validates the tag against `package.json`, runs the gate, `npm publish` (idempotent, with provenance), creates the release |

So library updates need no human: they are merged once CI passes, built, versioned and published as a patch. A downgrade, a failing check, or a major update stops the chain and waits for review.

Manual release: `just bump patch` (or `minor` / `major` / `X.Y.Z`), then `just release-push`.

**Secrets** (repo settings): `NPM_TOKEN` is an npm *granular access token* with publish rights and "bypass 2FA" (required for CI publishing). Optional: `GH_PAT` (lets a tag push trigger the release itself), `GITEA_TOKEN` (Gitea).

Commits follow [Conventional Commits](https://www.conventionalcommits.org); the changelog is generated by git-cliff.

## Scope

Pi sessions only. For Zed, Claude Code, Codex, Gemini and more, use the Rust [tokenburn](https://github.com/sorinirimies/tokenburn).

## Related plugins

Three small [pi](https://github.com/earendil-works/pi-coding-agent) extensions that save tokens without adding anything to the system prompt:

| Plugin | What it does |
|---|---|
| [**pi-edit-first**](https://github.com/sorinirimies/pi-edit-first) | Blocks whole-file `write` rewrites and hand-written project manifests, steering the agent to targeted `edit` calls and scaffolders |
| [**pi-read-guard**](https://github.com/sorinirimies/pi-read-guard) | Blocks full reads of large files, steering the agent to `offset`/`limit` or search |
| [**pi-tokenburn**](https://github.com/sorinirimies/pi-tokenburn) | Live token and cost counter in pi's footer, with charts and budgets |

```bash
pi install npm:pi-edit-first
pi install npm:pi-read-guard
pi install npm:pi-tokenburn
```

MIT
