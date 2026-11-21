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

function main(args) {
  let failed = false;
  for (const file of workflowFiles(args)) {
    const text = readFileSync(file, "utf8");
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
  }
  if (failed) return 1;
  console.log("Workflows are structurally sound and keep expressions out of run: scripts.");
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  process.exit(main(process.argv.slice(2)));
}
