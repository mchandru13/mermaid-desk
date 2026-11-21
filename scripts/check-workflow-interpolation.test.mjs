import assert from "node:assert/strict";
import { test } from "node:test";
import { runScriptLines } from "./check-workflow-interpolation.mjs";

const lineNumbers = (text) => runScriptLines(text).map((hit) => hit.line);

test("finds an expression in an inline run", () => {
  const yml = [
    "      - name: Check tag",
    '        run: node x.mjs --tag "${{ github.ref_name }}"',
  ].join("\n");
  assert.deepEqual(lineNumbers(yml), [2]);
});

test("finds an expression inside a block scalar", () => {
  const yml = [
    "      - name: Upload",
    "        run: |",
    "          mkdir out",
    '          gh release upload "${{ github.ref_name }}" out/*',
    "          echo done",
  ].join("\n");
  assert.deepEqual(lineNumbers(yml), [4]);
});

test("allows the value to arrive through env", () => {
  const yml = [
    "      - name: Check tag",
    "        env:",
    "          TAG: ${{ github.ref_name }}",
    '        run: node x.mjs --tag "$TAG"',
  ].join("\n");
  assert.deepEqual(lineNumbers(yml), []);
});

test("stops a block scalar at the next step", () => {
  const yml = [
    "      - name: Safe",
    "        run: |",
    "          echo one",
    "      - name: Next",
    "        env:",
    "          TAG: ${{ github.ref_name }}",
    '        run: node y.mjs "$TAG"',
  ].join("\n");
  assert.deepEqual(lineNumbers(yml), []);
});

test("ignores expressions in other keys", () => {
  const yml = [
    "      - uses: actions/checkout@v7",
    "        with:",
    "          ref: ${{ github.ref_name }}",
    "        if: startsWith(github.ref, 'refs/tags/')",
  ].join("\n");
  assert.deepEqual(lineNumbers(yml), []);
});

test("finds several expressions in one block", () => {
  const yml = [
    "        run: |",
    "          echo ${{ matrix.os }}",
    "          echo ${{ github.sha }}",
  ].join("\n");
  assert.deepEqual(lineNumbers(yml), [2, 3]);
});

test("a shell variable is not an expression", () => {
  const yml = ['        run: echo "$GITHUB_REF_NAME" ${HOME}'].join("\n");
  assert.deepEqual(lineNumbers(yml), []);
});
