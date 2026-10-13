# Changelog

Generated from [Conventional Commits](https://www.conventionalcommits.org) by
[git-cliff](https://git-cliff.org). Do not edit by hand.

## [0.5.6](https://github.com/sorinirimies/pi-tokenburn/releases/tag/v0.5.6) — 2026-10-13


### 🧹 Chores

- Just recipes to push, pull and force-push to several remotes (push-all, pull-all, push-tags-all, *-force, sync-starscream, setup-remotes; release-push goes to every remote) ([`c581139`](https://github.com/sorinirimies/pi-tokenburn/commit/c5811395f98576e9a117b686ab0fa85a685e7984))
- Justfile remotes and release recipes in the gitkraft style (gitea-microlab, gitea-starscream, gitea-nexus-lab: push, pull, release, sync, all-remotes and force variants; unconfigured remotes are skipped) ([`66b27a0`](https://github.com/sorinirimies/pi-tokenburn/commit/66b27a0517a67384d9b33982c6406b17c9384efb))
## [0.5.5](https://github.com/sorinirimies/pi-tokenburn/releases/tag/v0.5.5) — 2026-10-12


### 📚 Docs

- List pi-context-diet in the related plugins ([`c1952c3`](https://github.com/sorinirimies/pi-tokenburn/commit/c1952c3ec1b388a8523f0a972aac636802f800a9))

### 🧪 Tests

- No test may touch the real ~/.pi/agent (preload sets a temp config dir; the autocomplete test persisted mode=always into it) ([`264913e`](https://github.com/sorinirimies/pi-tokenburn/commit/264913e7124714e1a618d0e861d101579c874522))

### 🔧 Build & CI

- **deps:** Bump actions/setup-node from 7.0.0 to 7.1.0 (#4) ([`6f3c03c`](https://github.com/sorinirimies/pi-tokenburn/commit/6f3c03c33c6a6e5e093a2ddb07734e2e5a7b90fa))
- Restore the Gitea nightly and release workflows (both hosts run the full pipeline in parallel) ([`2bfd29a`](https://github.com/sorinirimies/pi-tokenburn/commit/2bfd29aaa5e9991859cfefc2a282b3abf2bd54dd))
## [0.5.4](https://github.com/sorinirimies/pi-tokenburn/releases/tag/v0.5.4) — 2026-10-12


### 🔧 Build & CI

- **deps:** Bump taiki-e/install-action from 2.87.26 to 2.87.27 (#3) ([`51bb5a3`](https://github.com/sorinirimies/pi-tokenburn/commit/51bb5a31d55b20b502f1bb89c930020bb4754ab5))
## [0.5.1](https://github.com/sorinirimies/pi-tokenburn/releases/tag/v0.5.1) — 2026-10-09


### 🐛 Fixes

- **report:** Shorter footer hint that fits a narrow terminal; docs: re-record the demos on a smaller canvas with larger text and small, believable numbers (fixture, mock model, budgets, README chart example) ([`92b66d1`](https://github.com/sorinirimies/pi-tokenburn/commit/92b66d1cdb59c5d4c954750935900086b3a82385))

### 📚 Docs

- VHS demo recordings of the real plugin in real pi (synthetic data, mock model) tracked with Git LFS; just vhs-*/demo; tests keep tapes, README and fixture honest ([`2c12999`](https://github.com/sorinirimies/pi-tokenburn/commit/2c12999a597e3c24d7151b324f277a9512cbc8fd))
- README badges, related plugins and the new automatic release flow ([`16f12ce`](https://github.com/sorinirimies/pi-tokenburn/commit/16f12cec63dcce237e20210e050cd0711b8849cc))

### 🧪 Tests

- Windows-safe line endings for tapes and scripts (.gitattributes eol=lf) ([`b44185b`](https://github.com/sorinirimies/pi-tokenburn/commit/b44185bfec8326a55604845093558c55eb2d8136))

### 🔧 Build & CI

- Auto-merge library updates only after CI is green, and publish a patch automatically (any library update ships; major updates wait for review) ([`d8a2840`](https://github.com/sorinirimies/pi-tokenburn/commit/d8a2840862254971341d220bfd32aa5139def809))
- **deps:** Bump actions/setup-node from 4.4.0 to 7.0.0 ([`2345ec3`](https://github.com/sorinirimies/pi-tokenburn/commit/2345ec36c9b5927ebf674a50fa93396d1c31da10))
## [0.5.0](https://github.com/sorinirimies/pi-tokenburn/releases/tag/v0.5.0) — 2026-10-09


### ✨ Features

- Live status-line refresh after each assistant message (incremental parsing, coalesced, ~1.3 ms), /tokenburn enable|disable|live, refreshMs config ([`7fed0c1`](https://github.com/sorinirimies/pi-tokenburn/commit/7fed0c1e2e0ae4ed2879196a549f1f398aac71e3))
## [0.4.0](https://github.com/sorinirimies/pi-tokenburn/releases/tag/v0.4.0) — 2026-10-09


### ✨ Features

- Bare day|week|month|year|all switch the status line, charts moved to /tokenburn chart <view>; sanitise hand-edited budgets; pin actions to SHAs and pass tags via env ([`3a151df`](https://github.com/sorinirimies/pi-tokenburn/commit/3a151df0db28655772fdef8e18e0d3b09d58e610))

### 🐛 Fixes

- **completions:** Budget periods leave the cursor ready for the amount; test against pi's real autocomplete provider and every README command ([`313e73e`](https://github.com/sorinirimies/pi-tokenburn/commit/313e73ea486702a8babc932f214acd2347f3a11c))

### 🧪 Tests

- Raise coverage to ~100% and enforce 95% thresholds (bunfig), coverage summary in CI, nu tests for every script; extract resolveAgentDir for testability ([`455baba`](https://github.com/sorinirimies/pi-tokenburn/commit/455babad01477322381ef2f97a95220037012c32))

### 🔧 Build & CI

- Nushell quality gate, GitHub + Gitea workflows (CI, nightly deps + patch release, npm publish), justfile, typecheck; tests timezone-safe ([`38276d0`](https://github.com/sorinirimies/pi-tokenburn/commit/38276d010090a30cacda9cf92ed6cadb5e0a8008))
## [0.3.0](https://github.com/sorinirimies/pi-tokenburn/releases/tag/v0.3.0) — 2026-10-09


### 🐛 Fixes

- Completions crash (missing label); feat: day|week|month|year|all views, year window; fix shared budgets state; tests ([`f9825ad`](https://github.com/sorinirimies/pi-tokenburn/commit/f9825ad1e15498f2b2e34c1a2648cc6783d917f5))
## [0.2.0](https://github.com/sorinirimies/pi-tokenburn/releases/tag/v0.2.0) — 2026-10-09


### ✨ Features

- Vertical column chart (day/week/month), status-window shortcuts + cycle, chartColor ([`459781f`](https://github.com/sorinirimies/pi-tokenburn/commit/459781ff6b41d0b58c5b06a71bbb06f54910e8b7))
## [0.1.0](https://github.com/sorinirimies/pi-tokenburn/releases/tag/v0.1.0) — 2026-10-09


### ✨ Features

- Pi-tokenburn v0.1.0 — token/cost monitor with budgets ([`76b8c6e`](https://github.com/sorinirimies/pi-tokenburn/commit/76b8c6eaf390ec7759f713cdfb0fc481aa83145f))

