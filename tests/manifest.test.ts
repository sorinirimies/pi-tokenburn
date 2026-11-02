import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Supply-chain guard: the published package has zero dependencies of any kind.
// Socket (and similar scanners) score a package by its whole dependency tree,
// including peers, so a `"*"` peer on the pi host pulls in hundreds of
// transitive packages. Pi types are only needed at compile time (devDependency).
const ROOT = join(import.meta.dir, "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const files = (dir: string): string[] =>
	readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
	});

describe("package manifest", () => {
	it("declares no runtime, peer or optional dependencies", () => {
		for (const key of ["dependencies", "peerDependencies", "optionalDependencies", "bundleDependencies"]) {
			expect(pkg[key] ?? {}).toEqual({});
		}
	});

	it("imports only node: builtins and relative files at runtime", () => {
		const runtimeImport = /^\s*import\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gm;
		for (const file of files(join(ROOT, "extensions"))) {
			for (const [, spec] of readFileSync(file, "utf8").matchAll(runtimeImport)) {
				expect({ file, spec, ok: spec.startsWith("node:") || spec.startsWith(".") }).toEqual({ file, spec, ok: true });
			}
		}
	});
});
