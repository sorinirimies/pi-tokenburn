#!/usr/bin/env nu
# Tests for scripts/ci/unreleased.nu

use std/assert
use runner.nu *
use ../ci/unreleased.nu [is_releasable, count_releasable]

def "test unreleased: feat fix perf are releasable" [] {
    for s in ["feat: x" "fix: y" "perf: z" "feat(chart): x" "fix(ui)!: breaking" "feat!: big"] {
        assert (is_releasable $s) $"should release on ($s)"
    }
}

def "test unreleased: chore ci docs test refactor deps are not" [] {
    for s in ["chore: x" "chore(deps): nightly" "ci: tweak" "docs: readme" "test: more" "refactor: tidy" "chore: release 0.3.1" "style: fmt"] {
        assert (not (is_releasable $s)) $"should not release on ($s)"
    }
}

def "test unreleased: non-conventional subjects are ignored" [] {
    for s in ["Update stuff" "fixed a bug" "feature: nope" "Merge branch 'main'" ""] {
        assert (not (is_releasable $s)) $"should not release on '($s)'"
    }
}

def "test unreleased: counts only releasable commits" [] {
    assert equal (count_releasable ["feat: a" "chore: b" "fix: c" "docs: d"]) 2
    assert equal (count_releasable []) 0
}

def main [] { run-tests }
