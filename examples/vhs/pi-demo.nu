#!/usr/bin/env nu
# Starts a real pi with ONLY the pi-tokenburn extension loaded, against the synthetic
# fixture data (see fixture.nu): no real sessions, skills, MCP servers, network or
# project files are touched.
#
#   eval "$(nu examples/vhs/fixture.nu env)" && nu examples/vhs/pi-demo.nu

# pi's arguments; PI_DEMO_LIVE=1 keeps pi's real session log (the live-refresh demo needs pi to write turns).
export def pi_args [repo: string, live: bool]: nothing -> list<string> {
    let base = [--no-extensions -e ($repo | path join extensions tokenburn.ts) --no-skills --no-prompt-templates --no-context-files --no-mcp --no-tools --offline]
    if $live { $base } else { $base | append "--no-session" }
}

def main [] {
    let repo = $env.FILE_PWD | path join .. .. | path expand
    cd ($env.HOME | path join projects my-app)
    exec pi ...(pi_args $repo (($env.PI_DEMO_LIVE? | default "") == "1"))
}
