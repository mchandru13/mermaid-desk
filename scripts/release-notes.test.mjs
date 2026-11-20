import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { extractSection, normaliseVersion } from "./release-notes.mjs";

const CHANGELOG = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const PACKAGE = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const SAMPLE = [
  "# Changelog",
  "",
  "## [Unreleased]",
  "",
  "Nothing yet.",
  "",
  "## [1.0.0] - 2026-11-20",
  "",
  "First release.",
  "",
  "### Added",
  "",
  "- Things.",
  "",
  "## [0.9.0] - 2026-10-01",
  "",
  "Older.",
  "",
].join("\n");

test("normalises tags, refs and plain versions", () => {
  assert.equal(normaliseVersion("refs/tags/v1.0.0"), "1.0.0");
  assert.equal(normaliseVersion("v1.0.0"), "1.0.0");
  assert.equal(normaliseVersion(" 1.0.0 "), "1.0.0");
  assert.equal(normaliseVersion(""), "");
  assert.equal(normaliseVersion(undefined), "");
});

test("extracts only the requested section", () => {
  assert.equal(extractSection(SAMPLE, "v1.0.0"), "First release.\n\n### Added\n\n- Things.");
  assert.equal(extractSection(SAMPLE, "0.9.0"), "Older.");
  assert.equal(extractSection(SAMPLE, "Unreleased"), "Nothing yet.");
});

test("keeps similar version numbers apart", () => {
  const doc = "## [1.0.0] - d\n\nstable\n\n## [1.0.0-rc.1] - d\n\ncandidate\n";
  assert.equal(extractSection(doc, "1.0.0"), "stable");
  assert.equal(extractSection(doc, "1.0.0-rc.1"), "candidate");
});

test("returns null when the section is missing", () => {
  assert.equal(extractSection(SAMPLE, "2.0.0"), null);
  assert.equal(extractSection("", "1.0.0"), null);
  assert.equal(extractSection("## [Unreleased]\n\nhi\n", "1.0.0"), null);
});

test("handles CRLF changelogs", () => {
  const crlf = SAMPLE.replace(/\n/g, "\r\n");
  assert.equal(extractSection(crlf, "1.0.0"), "First release.\n\n### Added\n\n- Things.");
});

test("the repository changelog documents the current version", () => {
  const body = extractSection(CHANGELOG, PACKAGE.version);
  assert.ok(body, `CHANGELOG.md needs a "## [${PACKAGE.version}]" section`);
  assert.ok(body.length > 40, "the current version needs real notes, not a placeholder");
});

test("the changelog has one section per version", () => {
  const versions = [...CHANGELOG.matchAll(/^##\s+\[([^\]]+)\]/gm)].map((match) => match[1]);
  assert.ok(versions.length >= 2, "expected an Unreleased section plus at least one release");
  assert.equal(new Set(versions).size, versions.length, "duplicate version headings");
  for (const version of versions) {
    assert.match(version, /^(Unreleased|\d+\.\d+\.\d+)$/, `unexpected heading: ${version}`);
  }
});
