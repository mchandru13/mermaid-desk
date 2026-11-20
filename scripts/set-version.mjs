#!/usr/bin/env node
// Keeps every version field in step, because a tag that disagrees with the
// binaries makes the release history a lie.
//
//   node scripts/set-version.mjs 1.0.1            # bump all four files
//   node scripts/set-version.mjs --check          # do they agree?
//   node scripts/set-version.mjs --check --tag v1.0.1   # ...and match the tag?
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normaliseVersion } from "./release-notes.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT_PATH), "..");

// The capture groups keep the surrounding formatting byte-identical, so a bump
// never reformats package.json or Cargo.toml.
export const TARGETS = [
  {
    file: "package.json",
    pattern: /("version"\s*:\s*")([^"]*)(")/,
  },
  {
    file: "src-tauri/tauri.conf.json",
    pattern: /("version"\s*:\s*")([^"]*)(")/,
  },
  {
    file: "src-tauri/Cargo.toml",
    pattern: /(^version = ")([^"]*)(")/m,
  },
  {
    // Cargo rewrites this on the next build; keep it correct in the commit too.
    file: "src-tauri/Cargo.lock",
    pattern: /(name = "mermaid-desk"\r?\nversion = ")([^"]*)(")/,
  },
];

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function applyVersion(text, pattern, version) {
  if (!pattern.test(text)) throw new Error("version field not found");
  return text.replace(pattern, (_match, before, _old, after) => `${before}${version}${after}`);
}

export function readTargets(root = ROOT) {
  return TARGETS.map((target) => {
    const path = join(root, target.file);
    const text = readFileSync(path, "utf8");
    const match = text.match(target.pattern);
    if (!match) throw new Error(`${target.file}: could not find a version field`);
    return { file: target.file, path, text, version: match[2] };
  });
}

/** Empty array means the files agree (and match the tag, when one is given). */
export function versionProblems(entries, expectedTag = "") {
  const expected = normaliseVersion(expectedTag);
  const problems = [];

  if (expected) {
    for (const entry of entries) {
      if (entry.version !== expected) {
        problems.push(`${entry.file} is ${entry.version}, but the tag is v${expected}`);
      }
    }
    return problems;
  }

  const distinct = new Set(entries.map((entry) => entry.version));
  if (distinct.size > 1) {
    problems.push(
      `version files disagree: ${entries.map((entry) => `${entry.file}=${entry.version}`).join(", ")}`,
    );
  }
  return problems;
}

function fail(message) {
  if (process.env.GITHUB_ACTIONS === "true") {
    console.error(`::error::${message.replace(/\r?\n/g, " ")}`);
  } else {
    console.error(message);
  }
  process.exit(1);
}

function usage() {
  console.log(`Usage:
  node scripts/set-version.mjs <version>              set every version file
  node scripts/set-version.mjs --check [--tag TAG]    verify they agree

Examples:
  node scripts/set-version.mjs 1.0.1
  node scripts/set-version.mjs --check --tag v1.0.1`);
}

function main(argv) {
  let version = "";
  let check = false;
  let tag = "";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      usage();
      return;
    }
    if (arg === "--check") {
      check = true;
    } else if (arg === "--tag") {
      tag = argv[index + 1] ?? "";
      index += 1;
      if (!tag) fail("--tag needs a tag name");
    } else if (arg.startsWith("--")) {
      fail(`Unknown option: ${arg}`);
    } else if (!version) {
      version = arg;
    } else {
      fail(`Unexpected argument: ${arg}`);
    }
  }

  if (check) {
    if (version) fail("--check does not take a version; use --tag instead");
    const entries = readTargets();
    const problems = versionProblems(entries, tag);
    if (problems.length > 0) fail(problems.join("\n"));
    const current = entries[0]?.version ?? "?";
    console.log(
      tag
        ? `Version ${current} in all ${entries.length} files, matching tag ${tag}.`
        : `Version ${current} in all ${entries.length} files.`,
    );
    return;
  }

  if (!version) {
    usage();
    process.exit(1);
  }
  if (!SEMVER.test(version)) {
    fail(`"${version}" is not a semantic version (expected e.g. 1.0.1).`);
  }

  const entries = readTargets();
  const changed = [];

  for (const target of TARGETS) {
    const entry = entries.find((candidate) => candidate.file === target.file);
    if (!entry) continue;
    if (entry.version === version) continue;
    const updated = applyVersion(entry.text, target.pattern, version);
    writeFileSync(entry.path, updated, "utf8");
    changed.push(`${relative(ROOT, entry.path)}: ${entry.version} -> ${version}`);
  }

  if (changed.length === 0) {
    console.log(`All ${entries.length} files already say ${version}; nothing to do.`);
    return;
  }

  console.log(`Set version ${version} in ${changed.length} file(s):`);
  for (const line of changed) console.log(`  ${line}`);
  console.log("\nNext: update CHANGELOG.md, then commit and tag.");
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  main(process.argv.slice(2));
}
