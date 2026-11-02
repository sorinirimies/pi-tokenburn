#!/usr/bin/env nu
# Builds the throw-away data the pi-tokenburn demos (VHS tapes) run on, so no real
# session log, path or setting ever ends up in a recording.
#
#   nu examples/vhs/fixture.nu          create /tmp/pi-tokenburn-demo (900 days of pi
#                                       session logs, a demo config): deterministic
#   nu examples/vhs/fixture.nu append   add one fresh assistant turn "now"
#   nu examples/vhs/fixture.nu env      print the environment the demos run with
#
# Run pi against it with:   eval "$(nu examples/vhs/fixture.nu env)"

const SEED = 20261009       # deterministic: same demo history every time
const DAYS = 900            # ~2.5 years: enough for the year and all-time charts
const PROJECTS = [android-app api-gateway pi-extensions docs-site data-pipeline]
# Made-up providers and models with their own $/M-token prices: a big one most of the
# time, a cheap one for small jobs, and a second provider now and then.
const MODELS = [
    {weight: 6, provider: acme, model: acme-large, price: {input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75}}
    {weight: 3, provider: acme, model: acme-small, price: {input: 0.8, output: 4.0, cacheRead: 0.08, cacheWrite: 1.0}}
    {weight: 2, provider: nova, model: nova-mini, price: {input: 0.4, output: 1.6, cacheRead: 0.04, cacheWrite: 0.5}}
]

# Next state of a 31-bit linear congruential generator (seeded, so builds repeat).
export def lcg [s: int]: nothing -> int { ($s * 1103515245 + 12345) mod 2147483648 }
# A draw from a state, without the generator's weak low bits.
export def draw [s: int]: nothing -> int { $s // 256 }
# An integer in [lo, hi] from a draw.
export def between [d: int, lo: int, hi: int]: nothing -> int { $lo + ($d mod ($hi - $lo + 1)) }
# The model a draw picks, by weight.
export def pick_model [d: int]: nothing -> record {
    mut left = $d mod ($MODELS | get weight | math sum)
    for m in $MODELS { if $left < $m.weight { return $m }; $left = $left - $m.weight }
    $MODELS | last
}
# Token counts priced in $/M tokens, with the total rounded like pi does.
export def cost [usage: record, price: record]: nothing -> record {
    let c = {input: ($usage.input * $price.input / 1e6), output: ($usage.output * $price.output / 1e6), cacheRead: ($usage.cacheRead * $price.cacheRead / 1e6), cacheWrite: ($usage.cacheWrite * $price.cacheWrite / 1e6)}
    $c | insert total ($c | values | math sum | math round --precision 6)
}
export def iso [t: datetime]: nothing -> string { $t | date to-timezone UTC | format date "%Y-%m-%dT%H:%M:%S.000Z" }
# The environment the demos run with, as `export K=V` lines for `eval`.
export def env_lines [demo: string]: nothing -> string {
    [$"export HOME=($demo)/home" $"export PI_CODING_AGENT_DIR=($demo)/agent" "export PI_OFFLINE=1" "export TZ=UTC"] | str join "\n"
}

# Resolve symlinks (/tmp is /private/tmp on macOS) so pi's footer can show `~/…` for the project.
def demo_dir [] { mkdir /tmp/pi-tokenburn-demo; "/tmp/pi-tokenburn-demo" | path expand }

def "main env" [] { print (env_lines (demo_dir)) }

def "main append" [] {
    let demo = demo_dir
    let f = ls ($demo | path join agent sessions * *.jsonl | into glob) | sort-by modified --reverse | first | get name
    let usage = {input: (random int 2..12), output: (random int 300..1800), cacheRead: (random int 1200..9000), cacheWrite: (random int 0..1200)}
    let line = {timestamp: (iso (date now)), message: {role: assistant, provider: acme, model: acme-large, usage: ($usage | insert cost (cost $usage ($MODELS.0.price)))}}
    $"($line | to json -r)\n" | save --append --raw $f
}

def main [] {
    let demo = demo_dir
    rm -rf $demo
    mkdir ($demo | path join home projects my-app) ($demo | path join agent sessions)
    let now = date now | date to-timezone UTC
    let midnight = $"($now | format date '%Y-%m-%d')T00:00:00Z" | into datetime
    mut s = $SEED
    for ago in ($DAYS - 1)..0 {
        let day = $midnight - ($ago * 1day)
        # busier on weekdays, a steady upward trend, the odd quiet day
        $s = lcg $s
        let w = (if ($day | format date "%u" | into int) >= 6 { 0.2 } else { 1.0 }) * (0.2 + 0.9 * ($DAYS - $ago) / $DAYS) * ([0.15 0.6 1 1 1.2 1.7] | get (draw $s | $in mod 6))
        let turns = [1 (22 * $w | math floor) (if $ago == 0 { 12 } else { 0 })] | math max   # today always has something to show
        $s = lcg $s
        let project = $PROJECTS | get ((draw $s) mod ($PROJECTS | length))
        let dir = $demo | path join agent sessions $"--home-demo-projects-($project)--"
        mkdir $dir
        let start = $day + 8hr + 30min
        mut lines = []
        for i in 1..$turns {
            $s = lcg $s
            mut t = $start + ((between (draw $s) 0 600) * 1min)
            if $t > $now {   # never write the future, nor slip into yesterday after midnight
                $s = lcg $s
                $t = ([$midnight ($now - ((between (draw $s) 1 240) * 1min))] | math max)
            }
            $lines = ($lines | append {t: $t, rec: {timestamp: (iso $t), message: {role: user, content: "…"}}})
            $s = lcg $s; let m = pick_model (draw $s)
            $s = lcg $s; let inp = between (draw $s) 2 14
            $s = lcg $s; let out = between (draw $s) 300 1800
            $s = lcg $s; let cr = between (draw $s) 1200 9000
            $s = lcg $s; let cw = between (draw $s) 0 1200
            let usage = {input: $inp, output: $out, cacheRead: $cr, cacheWrite: $cw}
            let reply = [($t + 20sec) ([$t $now] | math max)] | math min
            $lines = ($lines | append {t: $reply, rec: {timestamp: (iso $reply), message: {role: assistant, provider: $m.provider, model: $m.model, usage: ($usage | insert cost (cost $usage $m.price))}}})
        }
        $s = lcg $s
        let name = $"($day | format date '%Y-%m-%d')T08-30-00-000Z_((draw $s) | format number | get lowerhex | str replace '0x' '' | fill --alignment right --character '0' --width 8).jsonl"
        # pi's session header: the project path is what `/tokenburn projects` groups by
        let header = {type: session, id: $name, timestamp: (iso $start), cwd: $"/home/demo/projects/($project)"} | to json -r
        $lines | sort-by t | each {|l| $l.rec | to json -r } | prepend $header | str join "\n" | $in + "\n" | save --raw ($dir | path join $name)
    }
    let agent = $demo | path join agent
    # demo config: a quick refresh so the live behaviour is visible, no panel to start with
    {enabled: true, statusWindow: today, showWidget: false, refreshMs: 250} | to json | save -f ($agent | path join tokenburn.json)
    # A local demo model served by examples/vhs/mock-llm.ts: pi starts without a "no models / please
    # log in" banner (which would print real install paths), and the live-refresh demo gets a real reply.
    {providers: {demo: {baseUrl: "http://127.0.0.1:8989/v1", api: openai-completions, apiKey: demo, models: [{id: demo-model, name: demo-model, contextWindow: 200000, maxTokens: 8192, cost: {input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75}}]}}} | to json | save -f ($agent | path join models.json)
    {defaultProvider: demo, defaultModel: demo-model, theme: dark, defaultThinkingLevel: off, lastChangelogVersion: "9.9.9", quietStartup: header} | to json | save -f ($agent | path join settings.json)
    print $"fixture ready: ($demo)"
}
