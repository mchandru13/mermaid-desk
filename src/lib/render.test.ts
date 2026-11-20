import { describe, expect, it } from "vitest";
import {
  ensureStandaloneSvg,
  mapParsedLine,
  parseErrorLine,
  sanitizeSvg,
  svgSize,
  toDiagnostic,
} from "./render";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="320" height="180">
  <style>#chart .node rect { fill: #eef4ff; }</style>
  <g id="chart"><rect class="node" width="100" height="40" /></g>
</svg>`;

describe("SVG sanitisation", () => {
  it("removes scripts, event handlers, and foreign objects", () => {
    const hostile = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
      <script>alert(2)</script>
      <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>
      <a href="javascript:alert(3)"><rect width="10" height="10" onclick="alert(4)" /></a>
      <rect width="20" height="20" />
    </svg>`;
    const clean = sanitizeSvg(hostile);
    expect(clean).not.toMatch(/<script/i);
    expect(clean).not.toMatch(/onload/i);
    expect(clean).not.toMatch(/onclick/i);
    expect(clean).not.toMatch(/foreignObject/i);
    expect(clean).not.toMatch(/javascript:/i);
    expect(clean).toContain("<rect");
  });

  it("keeps mermaid's scoped style block and geometry", () => {
    const clean = sanitizeSvg(SVG);
    expect(clean).toContain("<style");
    expect(clean).toContain("#chart .node rect");
    expect(clean).toContain('id="chart"');
  });
});

describe("SVG metadata", () => {
  it("reads the origin and size from the viewBox", () => {
    expect(svgSize(SVG)).toEqual({ x: 0, y: 0, width: 320, height: 180 });
    expect(svgSize('<svg viewBox="-50 -10 933 619"></svg>')).toEqual({
      x: -50,
      y: -10,
      width: 933,
      height: 619,
    });
  });

  it("falls back to width and height attributes", () => {
    expect(svgSize('<svg width="120" height="60"></svg>')).toEqual({
      x: 0,
      y: 0,
      width: 120,
      height: 60,
    });
  });

  it("falls back to a default size for unusable input", () => {
    expect(svgSize("<svg></svg>")).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it("adds the namespace and a viewBox for standalone export", () => {
    const result = ensureStandaloneSvg('<svg width="200" height="100"></svg>', "id-1");
    expect(result).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(result).toContain('viewBox="0 0 200 100"');
    expect(result).toContain('data-render-id="id-1"');
  });

  it("pins a percentage width to the viewBox size", () => {
    // Mermaid emits width="100%" and a max-width style for several diagram
    // types, which decoupled the element box from the drawing.
    const result = ensureStandaloneSvg(
      '<svg width="100%" viewBox="0 0 673.8125 450" style="max-width: 673.8125px;"></svg>',
    );
    expect(result).toContain('width="673.8125"');
    expect(result).toContain('height="450"');
    expect(result).not.toContain("max-width");
    expect(result).not.toContain('width="100%"');
  });

  it("corrects a height attribute that disagrees with the viewBox", () => {
    // Sequence diagrams ship height="589" with a 619-unit viewBox.
    const result = ensureStandaloneSvg(
      '<svg width="933" height="589" viewBox="-50 -10 933 619"></svg>',
    );
    expect(result).toContain('width="933"');
    expect(result).toContain('height="619"');
    expect(result).toContain('viewBox="-50 -10 933 619"');
  });

  it("keeps unrelated inline styles", () => {
    const result = ensureStandaloneSvg(
      '<svg viewBox="0 0 10 10" style="background: red; max-width: 20px;"></svg>',
    );
    expect(result).toContain("background: red");
    expect(result).not.toContain("max-width");
  });
});

describe("diagnostics", () => {
  it("extracts mermaid parse error lines", () => {
    expect(parseErrorLine("Parse error on line 4:")).toBe(4);
    expect(parseErrorLine("Error at line 12, column 3")).toBe(12);
    expect(parseErrorLine("unexpected token [7]")).toBe(7);
    expect(parseErrorLine("no line information")).toBeNull();
  });

  it("normalises thrown errors and strings", () => {
    const diagnostic = toDiagnostic(new Error("Parse error on line 2: bad"));
    expect(diagnostic.message).toContain("Parse error on line 2");
    expect(diagnostic.line).toBe(2);
    expect(diagnostic.detail.length).toBeGreaterThan(0);

    const fromString = toDiagnostic("boom");
    expect(fromString.message).toBe("boom");
    expect(fromString.line).toBeNull();
  });

  it("prefers Mermaid's structured location over the offset message", () => {
    // Real Mermaid error: message says line 4, the failure is on line 2.
    const error = Object.assign(new Error("Parse error on line 4:\n...A[Broken -->"), {
      hash: { loc: { first_line: 2, last_line: 4 } },
    });
    expect(toDiagnostic(error).line).toBe(2);
  });

  it("maps Mermaid's cleaned line back to the edited file", () => {
    const source = "---\ntitle: T\n---\nflowchart TD\n    A[Broken -->\n";
    const error = Object.assign(new Error("Parse error on line 4:"), {
      hash: { loc: { first_line: 2 } },
    });
    // Cleaned line 2 is file line 5 (three front-matter lines are removed).
    expect(toDiagnostic(error, source).line).toBe(5);
  });

  it("accounts for removed comment lines", () => {
    const source = "%% note\n%% more\nflowchart TD\n    A[Broken -->\n";
    expect(mapParsedLine(source, 2)).toBe(4);
    expect(mapParsedLine(source, 1)).toBe(3);
  });

  it("clamps a line beyond the file", () => {
    expect(mapParsedLine("a\nb", 99)).toBe(2);
  });
});
