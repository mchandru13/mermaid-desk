import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { TARGETS, applyVersion, readTargets, versionProblems } from "./set-version.mjs";

const CARGO_TOML = TARGETS.find((target) => target.file === "src-tauri/Cargo.toml");
const CARGO_LOCK = TARGETS.find((target) => target.file === "src-tauri/Cargo.lock");
const PACKAGE_JSON = TARGETS.find((target) => target.file === "package.json");

test("bumping keeps the existing formatting", () => {
  const text = '{\n    "name": "mermaid-desk",\n    "version":  "1.0.0",\n    "private": true\n}\n';
  const bumped = applyVersion(text, PACKAGE_JSON.pattern, "1.0.1");
  assert.equal(bumped, text.replace('"1.0.0"', '"1.0.1"'));
  assert.ok(bumped.includes('"version":  "1.0.1"'), "spacing must survive");
});

test("only the mermaid-desk entry in Cargo.lock changes", () => {
  const lock = [
    "[[package]]",
    'name = "mermaid-desk"',
    'version = "1.0.0"',
    "dependencies = []",
    "",
    "[[package]]",
    'name = "serde"',
    'version = "1.0.0"',
    "",
  ].join("\n");
  const bumped = applyVersion(lock, CARGO_LOCK.pattern, "2.3.4");
  assert.match(bumped, /name = "mermaid-desk"\nversion = "2\.3\.4"/);
  assert.match(bumped, /name = "serde"\nversion = "1\.0\.0"/);
});

test("Cargo.toml bumps the package version, not a dependency", () => {
  const toml = '[package]\nname = "mermaid-desk"\nversion = "1.0.0"\n\n[dependencies]\nserde = "1"\n';
  const bumped = applyVersion(toml, CARGO_TOML.pattern, "1.1.0");
  assert.match(bumped, /name = "mermaid-desk"\nversion = "1\.1\.0"/);
  assert.match(bumped, /serde = "1"/);
});

test("reports disagreeing files", () => {
  const entries = [
    { file: "package.json", version: "1.0.0" },
    { file: "src-tauri/Cargo.toml", version: "1.0.1" },
  ];
  const problems = versionProblems(entries);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /disagree/);
});

test("reports files that do not match the tag", () => {
  const entries = [
    { file: "package.json", version: "1.0.0" },
    { file: "src-tauri/Cargo.toml", version: "1.0.0" },
  ];
  assert.deepEqual(versionProblems(entries, "v1.0.1"), [
    "package.json is 1.0.0, but the tag is v1.0.1",
    "src-tauri/Cargo.toml is 1.0.0, but the tag is v1.0.1",
  ]);
  assert.deepEqual(versionProblems(entries, "1.0.0"), []);
  assert.deepEqual(versionProblems(entries), []);
});

test("every version file in the repository agrees", () => {
  const entries = readTargets();
  assert.deepEqual(
    versionProblems(entries),
    [],
    entries.map((entry) => `${entry.file}=${entry.version}`).join(", "),
  );
});

test("a real repository bump would only touch the version value", () => {
  const entry = readTargets().find((candidate) => candidate.file === "package.json");
  const bumped = applyVersion(entry.text, PACKAGE_JSON.pattern, "9.9.9");
  const expected = entry.text.replace(`"${entry.version}"`, '"9.9.9"');
  assert.equal(bumped, expected);
});

test("readTargets fails loudly when the tree is not a project", () => {
  const empty = mkdtempSync(join(tmpdir(), "set-version-"));
  mkdirSync(join(empty, "src-tauri"));
  writeFileSync(join(empty, "package.json"), '{ "name": "x" }');
  assert.throws(() => readTargets(empty), /could not find a version field/);
  // Keep the fixture minimal and local to this process.
  assert.ok(readFileSync(join(empty, "package.json"), "utf8").includes("x"));
});
