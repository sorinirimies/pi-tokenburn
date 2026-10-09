#!/usr/bin/env nu
# ──────────────────────────────────────────────────────────────────────────────
# Publish the package to npm — idempotent
# ──────────────────────────────────────────────────────────────────────────────
# GitHub and Gitea both run releases independently, and a tag can be re-run, so
# publishing must be safe to repeat: if this exact version is already on the
# registry the script exits 0 without publishing.
#
# Usage:
#   nu scripts/ci/npm_publish.nu [--provenance] [--dry-run]
#
# Auth: NODE_AUTH_TOKEN / NPM_TOKEN must be a granular token with "bypass 2FA".
# --provenance needs a GitHub Actions runner with `id-token: write`.
# ──────────────────────────────────────────────────────────────────────────────

export def published [name: string, version: string]: nothing -> bool {
    let res = (do { ^npm view $"($name)@($version)" version --prefer-online } | complete)
    ($res.exit_code == 0) and (($res.stdout | str trim) == $version)
}

def main [--provenance, --dry-run] {
    let pkg = (open package.json)
    print $"Package: ($pkg.name)@($pkg.version)"

    if (published $pkg.name $pkg.version) {
        print $"(ansi yellow)⚠(ansi reset) ($pkg.name)@($pkg.version) is already on npm — nothing to publish."
        return
    }

    if not $dry_run and (($env | get -o NODE_AUTH_TOKEN | default ($env | get -o NPM_TOKEN | default "")) | is-empty) {
        error make --unspanned { msg: "No npm token: set the NPM_TOKEN secret (granular token with 'bypass 2FA')." }
    }

    mut args = ["publish" "--access" "public"]
    if $provenance { $args = ($args | append "--provenance") }
    if $dry_run { $args = ($args | append "--dry-run") }
    run-external "npm" ...$args
    let verb = if $dry_run { "Dry run OK for" } else { "Published" }
    print $"(ansi green)✓(ansi reset) ($verb) ($pkg.name)@($pkg.version)."
}
