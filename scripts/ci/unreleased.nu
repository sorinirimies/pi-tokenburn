#!/usr/bin/env nu
# ──────────────────────────────────────────────────────────────────────────────
# Are there user-facing commits since the last release tag?
# ──────────────────────────────────────────────────────────────────────────────
# `feat`, `fix` and `perf` commits are worth a patch release. chore / ci / docs /
# test / refactor / deps commits are not. With no release tag at all nothing is
# released automatically (create a baseline tag first).
#
# Usage:
#   nu scripts/ci/unreleased.nu [--output "$GITHUB_OUTPUT"]
# Writes `releasable=true|false` and `unreleased=N`.
# ──────────────────────────────────────────────────────────────────────────────

# A commit subject counts when it is feat/fix/perf (optionally scoped, optionally breaking).
export def is_releasable [subject: string]: nothing -> bool {
    ($subject | find --regex '^(feat|fix|perf)(\([^)]*\))?!?:' | is-not-empty)
}

export def count_releasable [subjects: list]: nothing -> int {
    $subjects | where {|s| is_releasable $s } | length
}

def main [--output: string = ""] {
    let tag = (do { ^git describe --tags --abbrev=0 --match "v*" } | complete)
    mut releasable = false
    mut count = 0
    if $tag.exit_code != 0 {
        print "No release tag found: not releasing automatically. Create a baseline tag (git tag vX.Y.Z)."
    } else {
        let last = ($tag.stdout | str trim)
        let subjects = (^git log $"($last)..HEAD" --no-merges --format=%s | lines)
        $count = (count_releasable $subjects)
        $releasable = ($count > 0)
        print $"($last)..HEAD: ($subjects | length) commit\(s\), ($count) releasable \(feat/fix/perf\)."
    }
    if $output != "" {
        $"releasable=($releasable)\nunreleased=($count)\n" | save --append $output
    }
}
