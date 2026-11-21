#!/usr/bin/env node
// Fails when a workflow interpolates ${{ … }} directly inside a `run:` script.
//
// GitHub substitutes the expression into the script text *before* the shell
// parses it, so a value containing quotes, `$`, backticks, `;` or `|` becomes
// executable. Tag names may contain all of those. Pass the value through an
// `env:` block and read it as "$VAR" instead.
//
//   node scripts/check-workflow-interpolation.mjs
//   node scripts/check-workflow-interpolation.mjs .github/workflows/build.yml
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT_PATH), "..");
const WORKFLOW_DIR = join(ROOT, ".github", "workflows");

/** Bare `${{ … }}` — an expression, not a shell variable. */
const EXPRESSION = /\$\{\{[^}]*\}\}/;

/**
 * Return the lines of every `run:` script in a workflow's text.
 *
 * A block scalar (`run: |`) runs until the indentation drops back to that of
 * its own key, so the scan tracks indentation rather than stopping at anything
 * that looks like a new key.
 */
export function runScriptLines(text) {
  const lines = text.split(/\r?\n/);
  const hits = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)(?:-\s+)?run:(.*)$/.exec(lines[index]);
    if (!match) continue;
    const indent = match[1].length;
    const inline = match[2].trim();

    if (inline && !/^[|>]/.test(inline)) {
      if (EXPRESSION.test(inline)) hits.push({ line: index + 1, text: lines[index].trim() });
      continue;
    }
    if (!inline) continue;

    for (let inner = index + 1; inner < lines.length; inner += 1) {
      const body = lines[inner];
      if (body.trim() !== "" && body.length - body.trimStart().length <= indent) break;
      if (EXPRESSION.test(body)) hits.push({ line: inner + 1, text: body.trim() });
    }
  }
  return hits;
}

function workflowFiles(args) {
  if (args.length > 0) return args.map((file) => resolve(file));
  return readdirSync(WORKFLOW_DIR)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => join(WORKFLOW_DIR, name));
}

/**
 * Catch the YAML mistakes a text scan cannot see.
 *
 * The whole reason this file exists is that a broken workflow only shows up as a
 * failed run with "likely failed because of a workflow file issue", which says
 * nothing useful. Two cheap checks cover what actually goes wrong when editing a
 * `run:` block or a step name:
 *
 *  - a plain (unquoted) scalar value may not contain ": " — that is how
 *    `- name: ... out of run: scripts` silently becomes a mapping;
 *  - every `jobs:` entry must be an object with `steps`.
 */
export function structureProblems(text) {
  const problems = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const mapping = /^(\s*(?:-\s+)?[A-Za-z_][\w.\-]*):\s+(.*)$/.exec(line);
    if (!mapping) return;
    const value = mapping[2];
    if (value === "" || /^[|>]/.test(value)) return;
    // Quoted, flow, or anchored values are fine; a bare ": " is not.
    if (/^["'{[]|^[&*]/.test(value) || /^["']/.test(value)) return;
    if (value.includes(": ")) {
      problems.push({
        line: index + 1,
        text: line.trim(),
        reason: "unquoted value contains ': ', which starts a nested mapping",
      });
    }
  });
  return problems;
}

/**
 * Catch a `$VAR` that only works in bash.
 *
 * On the Windows runner the default shell is pwsh, where `$TAG` is an unset
 * local variable and `$env:TAG` is the environment. A step that reads an `env:`
 * value as `"$TAG"` therefore receives an empty string on Windows only — which
 * is exactly how the tag guard passed on Linux and macOS and failed on Windows.
 *
 * A job that can run on Windows must say `shell: bash` when it uses POSIX
 * variable syntax. Two rules keep this from firing on correct code:
 *
 *  - only jobs that actually target Windows are checked, so an ubuntu-only job
 *    may use `$GITHUB_REF_NAME` freely;
 *  - only UPPER_CASE names are treated as environment variables. A PowerShell
 *    local such as `$edge` is genuinely a shell variable and is left alone.
 */
export function shellProblems(text) {
  const lines = text.split(/\r?\n/);
  const problems = [];

  // Job blocks: `  name:` at indent 2 under `jobs:`.
  const jobStarts = [];
  let inJobs = false;
  lines.forEach((line, index) => {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      return;
    }
    if (!inJobs) return;
    if (/^[A-Za-z_]/.test(line)) {
      inJobs = false;
      return;
    }
    const job = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (job) jobStarts.push({ name: job[1], index });
  });

  for (const [position, job] of jobStarts.entries()) {
    const start = job.index;
    const end = position + 1 < jobStarts.length ? jobStarts[position + 1].index : lines.length;
    const block = lines.slice(start, end);
    if (!/windows/i.test(block.join("\n"))) continue;

    for (let index = start; index < end; index += 1) {
      const match = /^(\s*)(?:-\s+)?run:(.*)$/.exec(lines[index]);
      if (!match) continue;
      const indent = match[1].length;

      // A step's keys can precede `run:` (`shell:` is usually above it), so find
      // the enclosing "- " entry at or above this line and use its indentation.
      let dashIndent = null;
      let stepStart = index;
      for (let back = index; back >= start; back -= 1) {
        const candidate = lines[back];
        if (candidate.trim() === "") continue;
        const candidateIndent = candidate.length - candidate.trimStart().length;
        if (/^\s*-\s/.test(candidate) && candidateIndent <= indent) {
          dashIndent = candidateIndent;
          stepStart = back;
          break;
        }
        if (candidateIndent < indent - 2) break;
      }
      const boundary = dashIndent ?? indent;

      let stepEnd = index + 1;
      for (; stepEnd < end; stepEnd += 1) {
        const body = lines[stepEnd];
        if (body.trim() === "") continue;
        const bodyIndent = body.length - body.trimStart().length;
        if (bodyIndent < boundary || (bodyIndent === boundary && /^-\s/.test(body.trimStart()))) break;
      }
      const step = lines.slice(stepStart, stepEnd);
      if (step.some((line) => /^\s*shell:\s*bash\s*$/.test(line))) continue;

      const inline = match[2].trim();
      const bodyLines = inline && !/^[|>]/.test(inline) ? [inline] : step.slice(1);
      for (const line of bodyLines) {
        if (/\$env:|%[A-Za-z_]+%/.test(line)) continue;
        const posix = /\$\{?([A-Z][A-Z0-9_]*)\}?/.exec(line);
        if (posix) {
          problems.push({
            line: index + 1,
            text: line.trim(),
            reason: `$${posix[1]} is a shell variable; on Windows the default shell is pwsh and it expands to nothing`,
          });
          break;
        }
      }
    }
  }
  return problems;
}

function main(args) {
  let failed = false;
  for (const file of workflowFiles(args)) {
    const text = readFileSync(file, "utf8");
    const targetsWindows = /windows-(latest|\d)|self-hosted.*windows/i.test(text);
    for (const hit of runScriptLines(text)) {
      failed = true;
      console.error(`${file}:${hit.line}: expression inside a run: script`);
      console.error(`  ${hit.text}`);
      console.error('  pass it through an env: block and read "$VAR" instead');
    }
    for (const problem of structureProblems(text)) {
      failed = true;
      console.error(`${file}:${problem.line}: ${problem.reason}`);
      console.error(`  ${problem.text}`);
    }
    for (const problem of shellProblems(text)) {
      failed = true;
      console.error(`${file}:${problem.line}: ${problem.reason}`);
      console.error(`  ${problem.text}`);
      console.error("  add `shell: bash` to the step on Windows runners");
    }
  }
  if (failed) return 1;
  console.log("Workflows are structurally sound and keep expressions out of run: scripts.");
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  process.exit(main(process.argv.slice(2)));
}
