#!/usr/bin/env node
// Extracts one section of CHANGELOG.md so the GitHub release body is always the
// same text as the repository's release history. Used by build.yml; run it
// locally to preview exactly what a tag will publish:
//
//   node scripts/release-notes.mjs v1.0.1
//   node scripts/release-notes.mjs v1.0.1 --out release-notes.md
//
// A missing section is a hard error: publishing a release with empty notes is
// how "release history" quietly stops being history.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT_PATH), "..");

/** `refs/tags/v1.0.1` and `v1.0.1` both mean `1.0.1`. */
export function normaliseVersion(value) {
  return String(value ?? "")
    .trim()
    .replace(/^refs\/tags\//, "")
    .replace(/^v(?=\d)/i, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Returns the Markdown body of the `## [version]` section, or null when the
 * changelog has no such section. Stop at the next `## ` heading so adjacent
 * versions never bleed into each other.
 */
export function extractSection(markdown, version) {
  const wanted = normaliseVersion(version);
  if (!wanted || !markdown) return null;

  const lines = markdown.split(/\r?\n/);
  const heading = new RegExp(`^##\\s+\\[?${escapeRegExp(wanted)}\\]?(?:\\s|$)`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return null;

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s/.test(lines[index])) {
      end = index;
      break;
    }
  }

  return lines.slice(start + 1, end).join("\n").trim();
}

function fail(message) {
  if (process.env.GITHUB_ACTIONS === "true") {
    // Turns the failure into an annotation on the run summary.
    const annotation = message.replace(/\r?\n/g, " ");
    console.error(`::error::${annotation}`);
  } else {
    console.error(message);
  }
  process.exit(1);
}

function usage() {
  console.log(`Usage: node scripts/release-notes.mjs <version|tag> [options]

  <version|tag>    e.g. 1.0.1 or v1.0.1; must match a "## [x.y.z]" heading
  --out <file>     also write the notes to a file
  --github-output  also expose them as the "body" step output
  -h, --help       show this help`);
}

function main(argv) {
  let version = "";
  let outFile = "";
  let githubOutput = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      usage();
      return;
    }
    if (arg === "--github-output") {
      githubOutput = true;
    } else if (arg === "--out") {
      outFile = argv[index + 1] ?? "";
      index += 1;
      if (!outFile) fail("--out needs a file path");
    } else if (arg.startsWith("--")) {
      fail(`Unknown option: ${arg}`);
    } else if (!version) {
      version = arg;
    } else {
      fail(`Unexpected argument: ${arg}`);
    }
  }

  if (!version) {
    usage();
    process.exit(1);
  }

  let markdown;
  try {
    markdown = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
  } catch {
    fail(`Cannot read ${join(ROOT, "CHANGELOG.md")}`);
  }

  const body = extractSection(markdown, version);
  if (!body) {
    fail(
      [
        `CHANGELOG.md has no "## [${normaliseVersion(version)}]" section.`,
        "Add one (see docs/RELEASING.md), commit it, and move the tag.",
        "Refusing to publish a release with empty notes.",
      ].join("\n"),
    );
  }

  if (outFile) {
    writeFileSync(resolve(process.cwd(), outFile), `${body}\n`, "utf8");
  }

  if (githubOutput) {
    const target = process.env.GITHUB_OUTPUT;
    if (!target) fail("--github-output requires GITHUB_OUTPUT to be set");
    const delimiter = `EOF_${randomUUID()}`;
    appendFileSync(target, `body<<${delimiter}\n${body}\n${delimiter}\n`, "utf8");
  }

  process.stdout.write(`${body}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  main(process.argv.slice(2));
}
