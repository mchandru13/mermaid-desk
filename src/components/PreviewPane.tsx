import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RenderDiagnostic, ResolvedTheme } from "../types";
import { measureSvgContent, svgSize, type SvgFrame } from "../lib/render";
import { AlertIcon, ChevronRightIcon, MinusIcon, PlusIcon, FitIcon } from "./Icons";

interface PreviewPaneProps {
  svg: string;
  diagnostic: RenderDiagnostic | null;
  rendering: boolean;
  theme: ResolvedTheme;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onFitScaleChange: (scale: number) => void;
  onGoToLine: (line: number) => void;
  documentKey: string;
  hidden: boolean;
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;
const PADDING = 56;

const clamp = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

export function PreviewPane({
  svg,
  diagnostic,
  rendering,
  theme,
  zoom,
  onZoomChange,
  onFitScaleChange,
  onGoToLine,
  documentKey,
  hidden,
}: PreviewPaneProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  // `center` is the diagram point (in the SVG's own coordinates) that sits at
  // the middle of the viewport. Keeping the centre in these terms means zooming
  // from anywhere (buttons, wheel, keyboard) stays centred instead of drifting
  // from the transform origin.
  const [center, setCenter] = useState({ x: 0, y: 0 });
  // True once the user has dragged the canvas, which hands control of the origin
  // over to `center`.
  const draggedRef = useRef(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [showDetail, setShowDetail] = useState(false);
  const dragRef = useRef<{
    x: number;
    y: number;
    centerX: number;
    centerY: number;
  } | null>(null);
  const userAdjustedRef = useRef(false);
  const lastFitRef = useRef("");
  const lastDocRef = useRef("");
  // Remembers zoom values this component asked for, so an external change
  // (keyboard shortcut/menu) can be told apart from our own fit.
  const pendingZoomRef = useRef<number | null>(zoom);
  const lastZoomRef = useRef(zoom);

  // Fit and centre on the *drawn* artwork. `frame` is measured from the live
  // SVG once it is in the DOM; `size` describes the declared canvas.
  const [frame, setFrame] = useState<SvgFrame | null>(null);
  const [measuredFor, setMeasuredFor] = useState("");
  const size = svg ? svgSize(svg) : { x: 0, y: 0, width: 0, height: 0 };
  const extent = frame ?? { x: size.x, y: size.y, width: size.width, height: size.height };
  // The transform is applied to the element, whose user-space origin is the
  // viewBox origin — not (0,0). Anchors are therefore expressed relative to it,
  // otherwise diagrams with a negative or offset viewBox drift away from centre.
  const centered = {
    x: extent.x - size.x + extent.width / 2,
    y: extent.y - size.y + extent.height / 2,
  };
  // Before the user pans, the artwork centre is authoritative; after a drag the
  // stored centre (which the drag handler keeps updating) takes over.
  const panAnchor = draggedRef.current ? center : centered;
  const pan = {
    x: viewport.width / 2 - panAnchor.x * zoom,
    y: viewport.height / 2 - panAnchor.y * zoom,
  };

  const requestZoom = useCallback(
    (value: number) => {
      pendingZoomRef.current = value;
      onZoomChange(value);
    },
    [onZoomChange],
  );

  // A zoom the user drives from outside (keyboard, menu) means manual mode.
  // Comparing with the previous value keeps effect re-runs (React StrictMode)
  // from being mistaken for user input.
  useEffect(() => {
    if (pendingZoomRef.current !== null && Math.abs(pendingZoomRef.current - zoom) < 1e-4) {
      pendingZoomRef.current = null;
    } else if (Math.abs(lastZoomRef.current - zoom) > 1e-6) {
      userAdjustedRef.current = true;
    }
    lastZoomRef.current = zoom;
  }, [zoom]);

  const computeFit = useCallback(() => {
    if (!viewport.width || !viewport.height || !extent.width || !extent.height) return 1;
    return Math.min(
      (viewport.width - PADDING) / extent.width,
      (viewport.height - PADDING) / extent.height,
      1.6,
    );
  }, [extent.width, extent.height, viewport.height, viewport.width]);

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setViewport({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // A new document always starts fitted and centred.
  useEffect(() => {
    if (lastDocRef.current === documentKey) return;
    lastDocRef.current = documentKey;
    userAdjustedRef.current = false;
    lastFitRef.current = "";
    draggedRef.current = false;
    setFrame(null);
    setMeasuredFor("");
  }, [documentKey]);

  // Measure the artwork once it is painted. The signature pairs the SVG markup
  // with the viewport so a re-render or resize triggers a fresh measurement.
  useEffect(() => {
    if (!svg) return;
    const key = `${documentKey}|${svg.length}|${Math.round(viewport.width)}x${Math.round(
      viewport.height,
    )}`;
    if (measuredFor === key) return;
    const root = viewportRef.current?.querySelector("svg");
    if (!root) return;
    setFrame(measureSvgContent(root as SVGSVGElement));
    setMeasuredFor(key);
  }, [svg, documentKey, viewport.width, viewport.height, measuredFor]);

  // Fit when the pane or the artwork changes, unless the user has already
  // zoomed/panned this document. In that case keep their zoom but recentre.
  useEffect(() => {
    if (!svg || !viewport.width || !viewport.height || !frame) return;
    const fitKey = `${documentKey}|${Math.round(frame.width)}x${Math.round(
      frame.height,
    )}|${Math.round(viewport.width)}x${Math.round(viewport.height)}`;
    if (lastFitRef.current === fitKey) return;
    lastFitRef.current = fitKey;
    if (!userAdjustedRef.current) {
      requestZoom(computeFit());
    }
  }, [
    svg,
    frame,
    documentKey,
    viewport.width,
    viewport.height,
    computeFit,
    requestZoom,
  ]);

  useEffect(() => {
    if (svg) onFitScaleChange(computeFit());
  }, [computeFit, onFitScaleChange, svg]);

  const zoomAt = useCallback(
    (nextZoom: number, clientX?: number, clientY?: number) => {
      const element = viewportRef.current;
      const target = clamp(nextZoom);
      userAdjustedRef.current = true;
      if (!element) {
        requestZoom(target);
        return;
      }
      const rect = element.getBoundingClientRect();
      const cursorX = clientX === undefined ? rect.width / 2 : clientX - rect.left;
      const cursorY = clientY === undefined ? rect.height / 2 : clientY - rect.top;
      // Keep the diagram point under the cursor fixed while the scale changes.
      const shift = 1 / zoom - 1 / target;
      setCenter((current) => ({
        x: (draggedRef.current ? current.x : centered.x) + (cursorX - rect.width / 2) * shift,
        y: (draggedRef.current ? current.y : centered.y) + (cursorY - rect.height / 2) * shift,
      }));
      requestZoom(target);
    },
    [requestZoom, zoom],
  );

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (!svg) return;
      if (!event.ctrlKey && !event.metaKey && !event.altKey) return;
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0015);
      zoomAt(zoom * factor, event.clientX, event.clientY);
    },
    [svg, zoom, zoomAt],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    userAdjustedRef.current = true;
    draggedRef.current = true;
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      centerX: panAnchor.x,
      centerY: panAnchor.y,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setCenter({
      x: drag.centerX - (event.clientX - drag.x) / zoom,
      y: drag.centerY - (event.clientY - drag.y) / zoom,
    });
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const fit = () => {
    // Fit intentionally re-enables automatic refitting for later edits.
    userAdjustedRef.current = false;
    draggedRef.current = false;
    lastFitRef.current = "";
    requestZoom(computeFit());
  };

  const summary = diagnostic ? diagnosticSummary(diagnostic) : "";

  return (
    <section
      className="preview-pane"
      data-testid="preview"
      hidden={hidden}
      aria-label="Diagram preview"
    >
      <div className="preview-stage">
        <div
          className={`preview-viewport ${dragRef.current ? "dragging" : ""}`}
          ref={viewportRef}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          data-testid="preview-viewport"
        >
          {svg ? (
            <div
              className="preview-canvas"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              }}
              data-testid="preview-canvas"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <div className="preview-empty">
              <div className="preview-empty-art" aria-hidden="true">
                <svg viewBox="0 0 200 120" width="200" height="120">
                  <rect x="12" y="18" width="70" height="34" rx="10" />
                  <rect x="118" y="18" width="70" height="34" rx="10" />
                  <rect x="65" y="72" width="70" height="34" rx="10" />
                  <path d="M82 35h36M47 52v20h18M153 52v20h-18" />
                </svg>
              </div>
              <h3>Nothing to preview yet</h3>
              <p>Type Mermaid in the editor and the diagram appears here.</p>
            </div>
          )}
        </div>

        <div className="preview-toolbar" role="toolbar" aria-label="Preview zoom">
          <button
            className="icon-button"
            onClick={() => zoomAt(zoom / 1.25)}
            aria-label="Zoom out"
            title="Zoom out (Ctrl+-)"
            disabled={!svg}
          >
            <MinusIcon />
          </button>
          <button
            className="zoom-value"
            onClick={fit}
            title="Click to fit to window"
            disabled={!svg}
            data-testid="zoom-value"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            className="icon-button"
            onClick={() => zoomAt(zoom * 1.25)}
            aria-label="Zoom in"
            title="Zoom in (Ctrl++)"
            disabled={!svg}
          >
            <PlusIcon />
          </button>
          <button
            className="icon-button"
            onClick={fit}
            aria-label="Fit to window"
            title="Fit to window (Ctrl+9)"
            disabled={!svg}
          >
            <FitIcon />
          </button>
        </div>

        {rendering ? <div className="preview-progress" aria-label="Rendering" /> : null}

        <div className="preview-hint">
          <ChevronRightIcon size={12} />
          Drag to pan · Ctrl + wheel to zoom
        </div>
      </div>

      {diagnostic ? (
        <div
          className={`diagnostics ${showDetail ? "expanded" : ""}`}
          role="alert"
          data-testid="diagnostic"
        >
          <div className="diagnostics-head">
            <AlertIcon />
            <strong>Diagram error</strong>
            {diagnostic.line ? (
              <button
                className="link-button"
                onClick={() => onGoToLine(diagnostic.line as number)}
              >
                Go to line {diagnostic.line}
              </button>
            ) : null}
            <span className="diagnostics-summary" title={diagnostic.message}>
              {summary}
            </span>
            <button
              className="link-button diagnostics-toggle"
              onClick={() => setShowDetail((value) => !value)}
              aria-expanded={showDetail}
            >
              {showDetail ? "Hide details" : "Details"}
            </button>
          </div>
          {showDetail ? (
            <pre className="diagnostics-detail">{diagnostic.detail}</pre>
          ) : null}
        </div>
      ) : null}

      {/* Theme is applied to the canvas background through data attribute. */}
      <div className="preview-theme-marker" data-theme={theme} />
    </section>
  );
}

/**
 * Mermaid repeats the (offset) line number in the message body, which
 * contradicts the corrected "Go to line" link. Show the reason without it.
 */
function diagnosticSummary(diagnostic: RenderDiagnostic): string {
  const lines = diagnostic.message.split("\n");
  const firstLine = (lines[0] ?? "").trim();
  const withoutLine = firstLine
    .replace(/^parse error on line \d+:\s*/i, "")
    .replace(/^error on line \d+:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  // Fall back to the parser's "Expecting ..." line, which is the actionable
  // part, then to a generic description.
  const expecting = lines.find((line) => /^\s*expecting\b/i.test(line))?.trim();
  const reason = withoutLine || expecting || "Invalid diagram syntax";
  return reason.length > 140 ? `${reason.slice(0, 137)}…` : reason;
}
