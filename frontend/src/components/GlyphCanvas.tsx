import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GlyphRecord, ShapeResult } from "../types";

interface GlyphCanvasProps {
  result: ShapeResult;
  activeGlyphIndex: number | null;
  rangeGlyphIndexes: Set<number>;
  textSelected: boolean;
  onGlyphClick: (glyph: GlyphRecord) => void;
  onBackgroundClick: () => void;
}

interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

const WORLD_TO_SCREEN = "matrix(1 0 0 -1 0 0)";

export function GlyphCanvas({
  result,
  activeGlyphIndex,
  rangeGlyphIndexes,
  textSelected,
  onGlyphClick,
  onBackgroundClick,
}: GlyphCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState<View>({
    x: result.viewBox[0],
    y: result.viewBox[1],
    w: result.viewBox[2],
    h: result.viewBox[3],
  });
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    view: View;
    moved: boolean;
  } | null>(null);
  // Set on pointerup after a pan; consumed (and cleared) by the click event
  // that immediately follows, so a pan ending over a glyph doesn't select it.
  const suppressClickRef = useRef(false);

  // Reset the viewport whenever a new shaping result arrives.
  useEffect(() => {
    setView({
      x: result.viewBox[0],
      y: result.viewBox[1],
      w: result.viewBox[2],
      h: result.viewBox[3],
    });
  }, [result]);

  const zoom = useCallback(
    (factor: number, center?: { clientX: number; clientY: number }) => {
      setView((v) => {
        const rect = svgRef.current?.getBoundingClientRect();
        const fx = rect && center ? (center.clientX - rect.left) / rect.width : 0.5;
        const fy = rect && center ? (center.clientY - rect.top) / rect.height : 0.5;
        const worldX = v.x + fx * v.w;
        const worldY = v.y + fy * v.h;
        const w = clamp(v.w * factor, 1, 10_000_000);
        const h = clamp(v.h * factor, 1, 10_000_000);
        return {
          w,
          h,
          x: worldX - fx * w,
          y: worldY - fy * h,
        };
      });
    },
    []
  );

  const onWheel = useCallback(
    (event: React.WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1 / 1.15 : 1.15;
      zoom(factor, { clientX: event.clientX, clientY: event.clientY });
    },
    [zoom]
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      // No setPointerCapture here: capturing before the gesture is known to
      // be a pan redirects the trailing click event away from glyph paths.
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        view: { ...view },
        moved: false,
      };
      suppressClickRef.current = false;
    },
    [view]
  );

  const onPointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!drag || !rect || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 3) {
      drag.moved = true;
    }
    if (drag.moved) {
      setView({
        ...drag.view,
        x: drag.view.x - (dx / rect.width) * drag.view.w,
        y: drag.view.y - (dy / rect.height) * drag.view.h,
      });
    }
  }, []);

  const onPointerUp = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      suppressClickRef.current = drag.moved;
      dragRef.current = null;
    }
  }, []);

  // Background clicks clear the selection; clicks on a glyph stop
  // propagation and never reach this handler.
  const onSvgClick = useCallback(() => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onBackgroundClick();
  }, [onBackgroundClick]);

  const handleGlyphClick = useCallback(
    (event: React.MouseEvent, glyph: GlyphRecord) => {
      event.stopPropagation();
      if (suppressClickRef.current) {
        // A pan gesture happened to end over a glyph; don't select it.
        suppressClickRef.current = false;
        return;
      }
      onGlyphClick(glyph);
    },
    [onGlyphClick]
  );

  const resetView = useCallback(() => {
    setView({
      x: result.viewBox[0],
      y: result.viewBox[1],
      w: result.viewBox[2],
      h: result.viewBox[3],
    });
  }, [result]);

  const outlines = result.outlines;
  const scaleLabel = useMemo(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return "";
    return `${((rect.width / view.w) * result.upem / 100).toFixed(0)}%`;
  }, [view, result.upem]);

  return (
    <div className="canvas-wrap">
      <div className="canvas-toolbar">
        <span className="canvas-title">
          字形视图（HarfBuzz 轮廓 · {result.glyphs.length} 个字形）
        </span>
        <span className="canvas-spacer" />
        <span className="zoom-label">{scaleLabel}</span>
        <button type="button" onClick={() => zoom(1 / 1.25)} aria-label="放大">
          ＋
        </button>
        <button type="button" onClick={() => zoom(1.25)} aria-label="缩小">
          －
        </button>
        <button type="button" onClick={resetView}>
          适应
        </button>
      </div>
      <svg
        ref={svgRef}
        className="glyph-canvas"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={onSvgClick}
      >
        {/* Everything below is drawn in HarfBuzz y-up world units. */}
        <g transform={WORLD_TO_SCREEN}>
          {result.glyphs.map((glyph) => {
            const path = outlines[String(glyph.gid)] ?? "";
            const isActive = glyph.index === activeGlyphIndex;
            const inRange = rangeGlyphIndexes.has(glyph.index);
            const inkClass = isActive
              ? "glyph-ink active"
              : inRange
              ? "glyph-ink in-range"
              : "glyph-ink";
            return (
              <g key={glyph.index} className="glyph">
                {/* transparent full-slot hit area, also shows text range */}
                <rect
                  className={isActive ? "slot active" : inRange ? "slot in-range" : "slot"}
                  x={glyph.slot[0]}
                  y={-glyph.slot[3]}
                  width={Math.max(0, glyph.slot[2] - glyph.slot[0])}
                  height={Math.max(0, glyph.slot[3] - glyph.slot[1])}
                  onClick={(e) => handleGlyphClick(e, glyph)}
                />
                {path && (
                  <path
                    className={inkClass}
                    d={path}
                    transform={`translate(${glyph.x} ${glyph.y})`}
                    onClick={(e) => handleGlyphClick(e, glyph)}
                  />
                )}
                {isActive && glyph.ink && (
                  <rect
                    className="ink-box"
                    x={glyph.ink[0]}
                    y={-glyph.ink[3]}
                    width={glyph.ink[2] - glyph.ink[0]}
                    height={glyph.ink[3] - glyph.ink[1]}
                  />
                )}
              </g>
            );
          })}
        </g>
        {result.glyphs.length === 0 && (
          <text className="canvas-empty" x="50%" y="50%" textAnchor="middle">
            输入文本后在此查看 HarfBuzz 排版出的字形
          </text>
        )}
      </svg>
      {textSelected && rangeGlyphIndexes.size === 0 && (
        <div className="canvas-hint">所选文本未参与形成任何输出字形（可能被排版特性吞掉）</div>
      )}
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
