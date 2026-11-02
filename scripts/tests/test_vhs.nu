#!/usr/bin/env nu
# Tests for scripts/vhs.nu and the demo helpers in examples/vhs/

use std/assert
use runner.nu *
use ../vhs.nu [tape_names missing parse_env]
use ../../examples/vhs/fixture.nu [lcg draw between pick_model cost env_lines]
use ../../examples/vhs/pi-demo.nu [pi_args]

def "test vhs: tape names are sorted and only tapes" [] {
    assert equal (tape_names [examples/vhs/status.tape examples/vhs/charts.tape examples/vhs/fixture.nu]) [charts status]
}

def "test vhs: missing tools" [] {
    assert equal (missing [vhs pi bun]) []
    assert equal (missing [bun]) [vhs pi]
}

def "test vhs: fixture env round-trips into load-env" [] {
    let e = parse_env (env_lines /tmp/demo)
    assert equal $e {HOME: /tmp/demo/home, PI_CODING_AGENT_DIR: /tmp/demo/agent, PI_OFFLINE: "1", TZ: UTC}
}

def "test vhs: fixture generator repeats and stays in range" [] {
    assert equal (lcg 20261009) (lcg 20261009)
    let draws = 1..200 | reduce --fold [20261009] {|_, acc| $acc | append (lcg ($acc | last)) } | each {|s| between (draw $s) 300 1800 }
    assert (($draws | math min) >= 300 and ($draws | math max) <= 1800)
    assert (($draws | uniq | length) > 150)
}

def "test vhs: every model is picked by weight" [] {
    assert equal (0..10 | each {|d| (pick_model $d).model } | uniq --count | sort-by count | get count) [2 3 6]
}

def "test vhs: cost is per million tokens with a rounded total" [] {
    let c = cost {input: 1000000, output: 0, cacheRead: 0, cacheWrite: 0} {input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75}
    assert equal $c.input 3.0
    assert equal $c.total 3.0
}

def "test vhs: pi runs with only this plugin, no session unless live" [] {
    let a = pi_args /r false
    assert equal ($a | take 3) [--no-extensions -e /r/extensions/tokenburn.ts]
    assert ("--no-session" in $a)
    assert not ("--no-session" in (pi_args /r true))
}

def main [] { run-tests }
