#!/usr/bin/env bash
# Starts a real pi with ONLY the pi-tokenburn extension loaded, against the synthetic
# fixture data (see fixture.sh): no real sessions, skills, MCP servers, network or
# project files are touched.
#
#   eval "$(examples/vhs/fixture.sh env)" && bash examples/vhs/pi-demo.sh
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$HOME/projects/my-app"
# PI_DEMO_LIVE=1 keeps pi's real session log (the live-refresh demo needs pi to write turns).
# (The ${arr[@]+...} form keeps an empty array legal under `set -u` on macOS bash 3.2.)
SESSION_FLAG=(--no-session)
[ "${PI_DEMO_LIVE:-}" = "1" ] && SESSION_FLAG=()
exec pi --no-extensions -e "$REPO/extensions/tokenburn.ts" \
    --no-skills --no-prompt-templates --no-context-files --no-mcp --no-tools --offline ${SESSION_FLAG[@]+"${SESSION_FLAG[@]}"}
