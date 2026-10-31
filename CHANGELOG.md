# Changelog

Generated from [Conventional Commits](https://www.conventionalcommits.org) by
[git-cliff](https://git-cliff.org). Do not edit by hand.

## [0.7.1](https://github.com/sorinirimies/pi-tokenburn/releases/tag/v0.7.1) — 2026-10-31


### 🔧 Build & CI

- **deps:** Bump hustcer/setup-nu from 3.28 to 3.29 (#6) ([`62b3ce5`](https://github.com/sorinirimies/pi-tokenburn/commit/62b3ce51fd838aa778db5c920b5a84b2d39b8e65))
- **deps:** Bump taiki-e/install-action from 2.87.29 to 2.87.31 (#7) ([`c062f59`](https://github.com/sorinirimies/pi-tokenburn/commit/c062f59bb5fd30cb58b3ba5c1611ab8351d962e9))
- Give the nightly fuzz run a long per-test timeout (200k runs exceeded bun's 5 s default) ([`8e8efaa`](https://github.com/sorinirimies/pi-tokenburn/commit/8e8efaa52263292b6e5afeaaf8733cfe81fe35a8))
- Keep .gitea workflow actions up to date; auto-merge needs GH_PAT for action bumps ([`3945616`](https://github.com/sorinirimies/pi-tokenburn/commit/3945616774fa6762ad52955da3e6a2c013707291))
- **deps:** Bump Gitea workflow actions ([`da7a668`](https://github.com/sorinirimies/pi-tokenburn/commit/da7a668d18f67045057c5fb9bc3ff1eb1e1ce218))
- One nightly (GitHub); Gitea mirrors GitHub's main and tags hourly ([`55b42ad`](https://github.com/sorinirimies/pi-tokenburn/commit/55b42adc46f62f678d7945354201cfa7406a3a4a))

### 🧹 Chores

- Nightly dev-tooling lockfile update 2026-10-27 (not released) ([`508ea17`](https://github.com/sorinirimies/pi-tokenburn/commit/508ea17bb4d33951552dbf41d19f7f233d38092e))
- Nightly dev-tooling lockfile update 2026-10-29 (not released) ([`111bf78`](https://github.com/sorinirimies/pi-tokenburn/commit/111bf787b367b860b08c1ec2ea8889f095de7a71))
- Nightly dev-tooling lockfile update 2026-10-30 (not released) ([`57fb116`](https://github.com/sorinirimies/pi-tokenburn/commit/57fb1162c088019585f24edc090c854d5f0b8ba1))
- Nightly dev-tooling lockfile update 2026-10-31 (not released) ([`4195858`](https://github.com/sorinirimies/pi-tokenburn/commit/4195858adb6fe5e7f84c056a1f984b8f893b6e09))
- Nightly dev-tooling lockfile update 2026-10-31 (not released) ([`a0de1d8`](https://github.com/sorinirimies/pi-tokenburn/commit/a0de1d80ad821752e9d16eba2d84be1b2c6da0e7))
- Merge Gitea's main (both hosts ran their own nightly) ([`a263e7a`](https://github.com/sorinirimies/pi-tokenburn/commit/a263e7a22cbfc38c2e636934c6844f37618bf1a7))
## [0.7.0](https://github.com/sorinirimies/pi-tokenburn/releases/tag/v0.7.0) — 2026-10-25


### ✨ Features

- **chart:** Zero label on the axis, dotted empty buckets, current value under the marker ([`75778c3`](https://github.com/sorinirimies/pi-tokenburn/commit/75778c34d82dfdf2ab181cf41f418f424ccd5d69))

### ♻️ Refactor

- One cacheValue helper for cache savings, shared hour constant, atomic config save, fix misplaced doc comment ([`be7e918`](https://github.com/sorinirimies/pi-tokenburn/commit/be7e91886d7deef0a4ae892f20f209be40783730))

### 📚 Docs

- Re-record charts and overview demos with the improved chart ([`6028ae9`](https://github.com/sorinirimies/pi-tokenburn/commit/6028ae9cfb69ea4d385c4587d1da2b7779e4f75a))

### 🧹 Chores

- Nightly dev-tooling lockfile update 2026-10-20 (not released) ([`718d170`](https://github.com/sorinirimies/pi-tokenburn/commit/718d170434af72180834d4573f15fb09c5f800f3))
- Nightly dev-tooling lockfile update 2026-10-21 (not released) ([`945f9ce`](https://github.com/sorinirimies/pi-tokenburn/commit/945f9ce202d430c2451a784dcf2ee9660958be53))
- Nightly dev-tooling lockfile update 2026-10-22 (not released) ([`764c94b`](https://github.com/sorinirimies/pi-tokenburn/commit/764c94b537a85ead806b6696eb9f37680ec1ca1c))
- Nightly dev-tooling lockfile update 2026-10-23 (not released) ([`d244826`](https://github.com/sorinirimies/pi-tokenburn/commit/d24482618012f7f41acdf0e507648083f944d5f2))
## [0.6.0](https://github.com/sorinirimies/pi-tokenburn/releases/tag/v0.6.0) — 2026-10-24


### ✨ Features

- Model/provider/project/session tables, filters, burn rate + projection, budget warnings, current-session cost, export, cache efficiency, price table ([`83bdd3d`](https://github.com/sorinirimies/pi-tokenburn/commit/83bdd3ddffa5c6f57d87b46f537e938be4f38e37))
- Status line shows burn rate, cache hit and savings for the status window (toggleable); add hour window; harden non-finite log numbers ([`6fd55c9`](https://github.com/sorinirimies/pi-tokenburn/commit/6fd55c92ab6f6646d4a971d8bb73655c7e24b17f))

### 🐛 Fixes

- 'filter all' completes without a trailing space; assert it ([`9f194d9`](https://github.com/sorinirimies/pi-tokenburn/commit/9f194d9b766c70a41be11a9c5a4777835c492b65))

### ♻️ Refactor

- Split extensions/tokenburn.ts into lib/ modules (types, config, format, parser, time, aggregate, chart, coalescer, command) ([`5d928aa`](https://github.com/sorinirimies/pi-tokenburn/commit/5d928aa5b1b6581ad4a694a58d0c9808c8557eb5))
- Feature folders (core, command, features/*), per-feature command handlers, entry file is wiring only ([`3d4c783`](https://github.com/sorinirimies/pi-tokenburn/commit/3d4c783647d2bce9da33bab632f3108fbda23112))

### 📚 Docs

- New demos (tables, filter-export, statusline, pricing), richer fixture (providers, models, projects), hide sub-cent savings in the footer ([`679d80b`](https://github.com/sorinirimies/pi-tokenburn/commit/679d80bede7eb7042fc36a30a6cdea2dd6024cff))

### 🧪 Tests

- Seeded fuzz tests + nightly fuzz and bun-audit workflows; cap bar() width, tolerate invalid dates in charts ([`19339fb`](https://github.com/sorinirimies/pi-tokenburn/commit/19339fbf22dc950287813a73a9282bd3bdfdf76f))
- Give the fixture determinism test a 30 s timeout ([`b56461a`](https://github.com/sorinirimies/pi-tokenburn/commit/b56461a3775dd94871f49c7796547340a10ff6fd))

### 🔧 Build & CI

- Ignore commits already released via the other host's parallel nightly (no phantom patch release) ([`17bdbc8`](https://github.com/sorinirimies/pi-tokenburn/commit/17bdbc81e2b5ca51961108fa5b98b240d682bdd6))
- **deps:** Bump taiki-e/install-action from 2.87.27 to 2.87.29 (#5) ([`f63aac2`](https://github.com/sorinirimies/pi-tokenburn/commit/f63aac2194a2765017c0010905b004ef393141e7))

### 🧹 Chores

- Nightly dev-tooling lockfile update 2026-10-15 (not released) ([`1dbdab7`](https://github.com/sorinirimies/pi-tokenburn/commit/1dbdab7c43c4748f3c2e718c74a3c819c733a591))
- Nightly dev-tooling lockfile update 2026-10-18 (not released) ([`9f340b0`](https://github.com/sorinirimies/pi-tokenburn/commit/9f340b066464ddca5160e8add69bde063f35d6e7))
- Nightly dev-tooling lockfile update 2026-10-20 (not released) ([`fb05bfb`](https://github.com/sorinirimies/pi-tokenburn/commit/fb05bfb0a40e94afe2cffdd8e30f9adfb3dd5e50))
- Nightly dev-tooling lockfile update 2026-10-21 (not released) ([`8a14a2e`](https://github.com/sorinirimies/pi-tokenburn/commit/8a14a2e7ddd4c5e4a16341f7390d3a662ea0392e))
- Nightly dev-tooling lockfile update 2026-10-22 (not released) ([`d9441cc`](https://github.com/sorinirimies/pi-tokenburn/commit/d9441cc6ea384a0e1b4ac93f9d30ef0735691764))
- Nightly dev-tooling lockfile update 2026-10-23 (not released) ([`4bb30b0`](https://github.com/sorinirimies/pi-tokenburn/commit/4bb30b0ee7bef356910ad9d5dec5fdc9463bbb6f))

### Justfile

- Skip unreachable remotes gracefully (5s SSH timeout, warn instead of fail) ([`e7ae588`](https://github.com/sorinirimies/pi-tokenburn/commit/e7ae5886e5a211b7175fe59ac5aa5de596910837))
## [0.5.8](https://github.com/sorinirimies/pi-tokenburn/releases/tag/v0.5.8) — 2026-10-15


### 🧹 Chores

- **justfile:** Push/pull current branch instead of hardcoded main ([`8a82d42`](https://github.com/sorinirimies/pi-tokenburn/commit/8a82d421c8b515c129cc808b1ea1cccd75856420))
- Nightly dev-tooling lockfile update 2026-10-15 (not released) ([`a7d59a8`](https://github.com/sorinirimies/pi-tokenburn/commit/a7d59a86bfbebac6076af4d4965afb2a762ad8cc))
## [0.5.7](https://github.com/sorinirimies/pi-tokenburn/releases/tag/v0.5.7) — 2026-10-14


### 📚 Docs

- Separate install commands for individual copy ([`fb38f4a`](https://github.com/sorinirimies/pi-tokenburn/commit/fb38f4a671ee887b3812e83191071025239f628a))

### 🔧 Build & CI

- Don't release on ci(deps) (GitHub Actions) bumps ([`6159ef4`](https://github.com/sorinirimies/pi-tokenburn/commit/6159ef487b5af9166f98368c3e28779dec37c65b))
- Publish only when a runtime dependency really upgrades (or feat/fix/perf); dev-tooling updates no longer release ([`95e5110`](https://github.com/sorinirimies/pi-tokenburn/commit/95e5110685335acb4fd7539aaaf84dd473b57a45))
## [0.5.6](https://github.com/sorinirimies/pi-tokenburn/releases/tag/v0.5.6) — 2026-10-13


### 📚 Docs

- Separate install commands for individual copy ([`4286dda`](https://github.com/sorinirimies/pi-tokenburn/commit/4286dda7a77656082fea9c98bd411709217bf522))

### 🔧 Build & CI

- Don't release on ci(deps) (GitHub Actions) bumps ([`75046bc`](https://github.com/sorinirimies/pi-tokenburn/commit/75046bc553ea69bf8eb5e993f3c3bf788acd49ad))

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

