import DOMPurify from "dompurify";
import type { RenderDiagnostic, ResolvedTheme } from "../types";

/**
 * Mermaid rendering.
 *
 * Security notes:
 *  - `securityLevel: "strict"` disables click handlers, HTML labels, and
 *    script execution inside diagram definitions.
 *  - The produced SVG is additionally passed through DOMPurify with the SVG
 *    profile before it touches the DOM (`sanitizeSvg`).
 *  - The application CSP forbids inline and remote scripts, so a bypass in
 *    either layer still cannot execute code or reach the network.
 */

type MermaidApi = typeof import("mermaid").default;

let mermaidPromise: Promise<MermaidApi> | null = null;
let appliedTheme: ResolvedTheme | null = null;
let renderCounter = 0;

const SVG_NS = "http://www.w3.org/2000/svg";

async function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((module) => module.default);
  }
  return mermaidPromise;
}

function themeVariables(theme: ResolvedTheme): Record<string, string> {
  if (theme === "dark") {
    return {
      background: "#0d1117",
      primaryColor: "#1f2a3a",
      primaryTextColor: "#e6edf3",
      primaryBorderColor: "#3d4b61",
      secondaryColor: "#182236",
      tertiaryColor: "#111827",
      lineColor: "#8b98a9",
      textColor: "#e6edf3",
      mainBkg: "#1f2a3a",
      nodeBorder: "#3d4b61",
      clusterBkg: "#111827",
      clusterBorder: "#2b3648",
      titleColor: "#e6edf3",
      edgeLabelBackground: "#0d1117",
      actorBkg: "#1f2a3a",
      actorBorder: "#3d4b61",
      actorTextColor: "#e6edf3",
      signalColor: "#8b98a9",
      signalTextColor: "#e6edf3",
      labelBoxBkgColor: "#1f2a3a",
      labelBoxBorderColor: "#3d4b61",
      labelTextColor: "#e6edf3",
      loopTextColor: "#e6edf3",
      noteBkgColor: "#2b3648",
      noteBorderColor: "#4b5b74",
      noteTextColor: "#e6edf3",
      sectionBkgColor: "#161f2e",
      altSectionBkgColor: "#0f172a",
      gridColor: "#2b3648",
      pie1: "#3b82f6",
      pie2: "#a855f7",
      pie3: "#ec4899",
      pie4: "#14b8a6",
      pie5: "#f59e0b",
      pie6: "#ef4444",
      // Mermaid hardcodes black pie outlines and light-grey text otherwise.
      pieStrokeColor: "#3d4b61",
      pieOuterStrokeColor: "#3d4b61",
      pieStrokeWidth: "1px",
      pieOuterStrokeWidth: "1px",
      pieTitleTextColor: "#e6edf3",
      pieSectionTextColor: "#e6edf3",
      pieLegendTextColor: "#e6edf3",
    };
  }
  return {
    background: "#ffffff",
    primaryColor: "#eef4ff",
    primaryTextColor: "#0f172a",
    primaryBorderColor: "#93b4e8",
    secondaryColor: "#f6f8fb",
    tertiaryColor: "#ffffff",
    lineColor: "#5b6b82",
    textColor: "#0f172a",
    mainBkg: "#eef4ff",
    nodeBorder: "#93b4e8",
    clusterBkg: "#f6f8fb",
    clusterBorder: "#cfd9e6",
    titleColor: "#0f172a",
    edgeLabelBackground: "#ffffff",
    actorBkg: "#eef4ff",
    actorBorder: "#93b4e8",
    actorTextColor: "#0f172a",
    signalColor: "#5b6b82",
    signalTextColor: "#0f172a",
    labelBoxBkgColor: "#eef4ff",
    labelBoxBorderColor: "#93b4e8",
    labelTextColor: "#0f172a",
    loopTextColor: "#0f172a",
    noteBkgColor: "#fff8db",
    noteBorderColor: "#e6cf8b",
    noteTextColor: "#3b2f00",
    sectionBkgColor: "#f1f5fb",
    altSectionBkgColor: "#ffffff",
    gridColor: "#cfd9e6",
    pie1: "#3b82f6",
    pie2: "#8b5cf6",
    pie3: "#ec4899",
    pie4: "#14b8a6",
    pie5: "#f59e0b",
    pie6: "#ef4444",
    pieStrokeColor: "#c2cddc",
    pieOuterStrokeColor: "#c2cddc",
    pieStrokeWidth: "1px",
    pieOuterStrokeWidth: "1px",
    pieTitleTextColor: "#0f172a",
    pieSectionTextColor: "#0f172a",
    pieLegendTextColor: "#0f172a",
  };
}

async function configure(theme: ResolvedTheme): Promise<MermaidApi> {
  const mermaid = await loadMermaid();
  if (appliedTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      // SVG text labels keep exports portable (no <foreignObject>) and make PNG
      // rasterisation reliable in every WebView.
      htmlLabels: false,
      theme: theme === "dark" ? "dark" : "default",
      themeVariables: themeVariables(theme),
      fontFamily: '"Segoe UI", "Inter", "Helvetica Neue", Arial, sans-serif',
      suppressErrorRendering: true,
      flowchart: { htmlLabels: false, useMaxWidth: false, curve: "basis" },
      sequence: { useMaxWidth: false },
      gantt: { useMaxWidth: false },
      er: { useMaxWidth: false },
      class: { useMaxWidth: false },
    });
    appliedTheme = theme;
  }
  return mermaid;
}

/** Elements that must never appear in a rendered diagram. */
const FORBIDDEN_ELEMENTS = new Set([
  "script",
  "foreignobject",
  "iframe",
  "object",
  "embed",
  "audio",
  "video",
  "canvas",
]);

const EXTERNAL_URL = /^(?:javascript:|vbscript:|https?:|file:|data:text\/html)/i;

/**
 * Defence-in-depth hardening of already-purified SVG: removes active content,
 * event handlers, external references, and CSS that could fetch network
 * resources. Runs on a parsed XML document so the result is deterministic.
 */
function hardenSvg(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (doc.querySelector("parsererror")) return "";
  const root = doc.documentElement;
  if (!root || root.localName.toLowerCase() !== "svg") return "";

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const doomed: Element[] = [];

  const hardenElement = (element: Element): void => {
    const tag = element.localName.toLowerCase();
    if (FORBIDDEN_ELEMENTS.has(tag)) {
      doomed.push(element);
      return;
    }

    // Mermaid's Gantt chart draws a live "today" line at the current date.
    // A chart whose range is far from today then gains thousands of units of
    // empty width, which breaks fitting and exports and makes output depend on
    // the date it was opened. Drop it so the drawing reflects the diagram.
    if (tag === "g" && (element.getAttribute("class") ?? "").split(/\s+/).includes("today")) {
      doomed.push(element);
      return;
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (
        (name === "href" || name === "xlink:href" || name === "src" || name === "action") &&
        EXTERNAL_URL.test(value)
      ) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === "style" && /url\(\s*['"]?\s*(?:https?:|javascript:|file:)/i.test(value)) {
        element.removeAttribute(attribute.name);
      }
    }

    if (tag === "style") {
      const css = element.textContent ?? "";
      if (/@import|expression\s*\(|javascript:/i.test(css)) {
        doomed.push(element);
      }
    }
  };

  hardenElement(root);
  while (walker.nextNode()) {
    hardenElement(walker.currentNode as Element);
  }

  for (const element of doomed) element.remove();
  return new XMLSerializer().serializeToString(root);
}

/** Remove scripts, event handlers, and remote references from rendered SVG. */
export function sanitizeSvg(svg: string): string {
  const purified = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["script", "foreignObject", "iframe", "video", "audio"],
    FORBID_ATTR: ["onload", "onclick", "onerror", "onmouseover", "onfocus"],
    ADD_ATTR: ["xmlns", "xmlns:xlink", "xlink:href"],
    ALLOW_DATA_ATTR: true,
    KEEP_CONTENT: true,
  });

  // Some DOM implementations unwrap a root <svg> during string sanitisation.
  // In that case the original markup is still hardened below; the hardening
  // pass is what guarantees the security properties we rely on.
  const candidate = purified.includes("<svg") ? purified : svg;
  return hardenSvg(candidate);
}

export function parseErrorLine(message: string): number | null {
  const match =
    /(?:parse error on line|line)\s*(\d+)/i.exec(message) ??
    /line\s*(\d+)/i.exec(message) ??
    /\[(\d+)\]/i.exec(message);
  if (!match) return null;
  const line = Number.parseInt(match[1], 10);
  return Number.isFinite(line) && line > 0 ? line : null;
}

export function toDiagnostic(error: unknown, source?: string): RenderDiagnostic {
  if (error instanceof Error) {
    const detail = error.stack ?? error.message;
    // Mermaid's message carries an offset line ("Parse error on line 4" for a
    // failure on line 2); the structured location is more reliable, but it is
    // relative to a copy with front matter and comment lines removed.
    const parsed = structuredLine(error) ?? parseErrorLine(error.message);
    const line = parsed !== null && source ? mapParsedLine(source, parsed) : parsed;
    return { message: error.message, line, detail };
  }
  const text = typeof error === "string" ? error : JSON.stringify(error);
  const parsed = parseErrorLine(text);
  return {
    message: text,
    line: parsed !== null && source ? mapParsedLine(source, parsed) : parsed,
    detail: text,
  };
}

/** Read `error.hash.loc.first_line` when Mermaid provides it. */
function structuredLine(error: Error): number | null {
  const hash = (error as Error & { hash?: { loc?: { first_line?: unknown } } }).hash;
  const line = hash?.loc?.first_line;
  return typeof line === "number" && Number.isFinite(line) && line > 0
    ? Math.floor(line)
    : null;
}

/**
 * Translate a line number from Mermaid's cleaned source (front matter and
 * `%%` comment lines removed) back to the file the user is editing.
 */
export function mapParsedLine(source: string, parsedLine: number): number {
  const lines = source.split(/\r?\n/);
  let start = 0;
  if (lines[0]?.trim() === "---") {
    const closing = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
    if (closing > 0) start = closing + 1;
  }
  const original: number[] = [];
  for (let index = start; index < lines.length; index += 1) {
    if (/^\s*%%/.test(lines[index])) continue;
    original.push(index + 1);
  }
  const mapped = original[parsedLine - 1];
  if (mapped !== undefined) return mapped;
  return Math.min(Math.max(parsedLine, 1), lines.length);
}

export interface RenderResult {
  svg: string;
  id: string;
}

/**
 * Render Mermaid source to sanitized SVG markup.
 * Throws a `RenderDiagnostic`-friendly error when parsing fails.
 */
export async function renderMermaid(
  source: string,
  theme: ResolvedTheme,
): Promise<RenderResult> {
  if (!source.trim()) {
    return { svg: "", id: "" };
  }
  const mermaid = await configure(theme);
  // A per-render random id keeps the generated `#id` CSS scoped when several
  // exported files are embedded in one page. The counter alone restarts at 1 on
  // every launch, so exports from different sessions would collide.
  const nonce =
    globalThis.crypto?.randomUUID?.().replace(/[^a-z0-9]/gi, "").slice(0, 10) ??
    `${Date.now().toString(36)}${(renderCounter += 1).toString(36)}`;
  const id = `mermaid-desk-${nonce}`;

  // `parse` gives precise syntax errors without leaving DOM nodes behind.
  await mermaid.parse(source);

  const { svg } = await mermaid.render(id, source);
  const sanitized = sanitizeSvg(svg);
  if (!sanitized.includes("<svg")) {
    throw new Error("The diagram rendered no SVG output.");
  }
  return { svg: ensureStandaloneSvg(sanitized, id), id };
}

/** Make sure the root SVG element carries the namespace and a viewBox. */
export function ensureStandaloneSvg(svg: string, id?: string): string {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== "svg") return svg;
  if (!root.getAttribute("xmlns")) root.setAttribute("xmlns", SVG_NS);

  // Mermaid emits `width="100%"` (plus a `max-width` style) or, worse, a
  // `height` that disagrees with the viewBox. Either way the element's CSS box
  // no longer matches the drawing's aspect ratio, which makes it impossible to
  // centre and fit reliably. Pinning width/height to the viewBox makes the
  // element's intrinsic size exactly the drawn size; the preview scales it with
  // a transform and exports keep the same numbers.
  const viewBox = root.getAttribute("viewBox");
  let width = Number.parseFloat(root.getAttribute("width") ?? "");
  let height = Number.parseFloat(root.getAttribute("height") ?? "");

  if (!viewBox) {
    if (Number.isFinite(width) && Number.isFinite(height)) {
      root.setAttribute("viewBox", `0 0 ${width} ${height}`);
    }
  }

  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((value) => Number.isFinite(value))) {
      const [, , boxWidth, boxHeight] = parts;
      width = boxWidth;
      height = boxHeight;
    }
  }

  if (Number.isFinite(width) && width > 0) {
    root.setAttribute("width", String(width));
  }
  if (Number.isFinite(height) && height > 0) {
    root.setAttribute("height", String(height));
  }
  // A `max-width` cap would silently break the intrinsic size we just pinned.
  const style = root.getAttribute("style");
  if (style && /(?:^|;)\s*max-width\s*:/i.test(style)) {
    const cleaned = style
      .split(";")
      .filter((rule) => !/^\s*max-width\s*:/i.test(rule))
      .join(";")
      .trim();
    if (cleaned) root.setAttribute("style", cleaned);
    else root.removeAttribute("style");
  }

  if (id) root.setAttribute("data-render-id", id);
  return new XMLSerializer().serializeToString(root);
}

export interface SvgSize {
  /** viewBox origin: the user-space point at the element's top-left. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Intrinsic size and origin derived from viewBox (falls back to width/height). */
export function svgSize(svg: string): SvgSize {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  const viewBox = root.getAttribute("viewBox");
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((value) => Number.isFinite(value))) {
      return {
        x: parts[0],
        y: parts[1],
        width: Math.max(parts[2], 1),
        height: Math.max(parts[3], 1),
      };
    }
  }
  const width = Number.parseFloat(root.getAttribute("width") ?? "");
  const height = Number.parseFloat(root.getAttribute("height") ?? "");
  return {
    x: 0,
    y: 0,
    width: Number.isFinite(width) && width > 0 ? width : 800,
    height: Number.isFinite(height) && height > 0 ? height : 600,
  };
}

export interface SvgFrame {
  /** Extent of the drawn artwork in the SVG's own coordinate system. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Measure the drawn artwork, not the declared canvas.
 *
 * Mermaid pads its viewBox asymmetrically (for example a sequence diagram's
 * viewBox starts at -50 while the actors start at 0), so centring the viewBox
 * leaves the visible drawing off-centre. `getBBox` on the live element reports
 * what is actually painted, which is what a user perceives as "centred".
 */
export function measureSvgContent(root: SVGSVGElement): SvgFrame {
  try {
    const box = root.getBBox();
    if (Number.isFinite(box.width) && Number.isFinite(box.height) && box.width > 0 && box.height > 0) {
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }
  } catch {
    // getBBox throws for a detached or not-yet-laid-out element.
  }
  const viewBox = root.getAttribute("viewBox");
  if (viewBox) {
    const [x, y, width, height] = viewBox.split(/[\s,]+/).map(Number);
    if ([x, y, width, height].every((value) => Number.isFinite(value))) {
      return { x, y, width: Math.max(width, 1), height: Math.max(height, 1) };
    }
  }
  return { x: 0, y: 0, width: 1, height: 1 };
}

export function resetRendererForTests(): void {
  appliedTheme = null;
  mermaidPromise = null;
  renderCounter = 0;
}
