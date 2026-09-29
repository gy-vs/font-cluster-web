import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Glyph, ShapeResult } from '../types'

interface Props {
  result: ShapeResult
  selectedRange: { start: number; end: number } | null
  primaryKey: string | null
  onGlyphClick: (glyph: Glyph, lineIndex: number, additive: boolean) => void
}

interface ViewBox {
  x: number
  y: number
  w: number
  h: number
}

const PAD = 28

function glyphKey(lineIndex: number, indexInLine: number): string {
  return `${lineIndex}:${indexInLine}`
}

function hitRect(g: Glyph, result: ShapeResult, baseline: number) {
  if (result.direction === 'ttb') {
    const x0 = g.bbox ? g.bbox[0] : g.x - 400
    const x1 = g.bbox ? g.bbox[2] : g.x + 400
    const yTop = -g.y
    const yBottom = -(g.y + g.y_advance)
    return { x: x0, y: yTop, w: Math.max(1, x1 - x0), h: Math.max(1, yBottom - yTop) }
  }
  return {
    x: g.x,
    y: baseline - result.ascender,
    w: Math.max(1, g.x_advance),
    h: result.line_height
  }
}

export default function GlyphCanvas({ result, selectedRange, primaryKey, onGlyphClick }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [view, setView] = useState<ViewBox>({ x: 0, y: 0, w: 1000, h: 400 })
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ x: number; y: number; view: ViewBox; moved: boolean } | null>(null)

  const content = useMemo(() => {
    const w = result.direction === 'ttb' ? result.line_height : result.width
    const h = result.direction === 'ttb' ? result.height : result.height
    return { w: w + PAD * 2, h: Math.max(1, h + PAD * 2) }
  }, [result])

  const fit = useCallback(() => {
    setView({ x: -PAD, y: -PAD, w: content.w, h: content.h })
  }, [content])

  // A new shaping result always resets the viewport to the new content.
  useEffect(() => {
    fit()
  }, [fit])

  const zoomBy = useCallback((factor: number, anchorClient?: { x: number; y: number }) => {
    setView((v) => {
      const rect = svgRef.current?.getBoundingClientRect()
      let ax = v.x + v.w / 2
      let ay = v.y + v.h / 2
      if (rect && anchorClient) {
        ax = v.x + ((anchorClient.x - rect.left) / rect.width) * v.w
        ay = v.y + ((anchorClient.y - rect.top) / rect.height) * v.h
      }
      const nw = Math.min(2_000_000, Math.max(80, v.w * factor))
      const nh = Math.min(2_000_000, Math.max(20, v.h * factor))
      const ratioX = (ax - v.x) / v.w
      const ratioY = (ay - v.y) / v.h
      return { x: ax - nw * ratioX, y: ay - nh * ratioY, w: nw, h: nh }
    })
  }, [])

  const onWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault()
      zoomBy(e.deltaY < 0 ? 1 / 1.15 : 1.15, { x: e.clientX, y: e.clientY })
    },
    [zoomBy]
  )

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onWheel])

  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    dragRef.current = { x: e.clientX, y: e.clientY, view: { ...view }, moved: false }
    setDragging(true)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    const rect = svgRef.current?.getBoundingClientRect()
    if (!d || !rect) return
    const dx = ((e.clientX - d.x) / rect.width) * d.view.w
    const dy = ((e.clientY - d.y) / rect.height) * d.view.h
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true
    setView({ ...d.view, x: d.view.x - dx, y: d.view.y - dy })
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current
    dragRef.current = null
    setDragging(false)
    if (d && !d.moved) {
      // Pointer capture retargets events to the <svg> itself, so resolve the
      // glyph under the release point from the document hit-test. The
      // transparent advance rect still participates in hit-testing.
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const target = el?.closest?.('g.glyph') as SVGGElement | null
      if (target) {
        const lineIdx = Number(target.dataset.line)
        const gIdx = Number(target.dataset.gindex)
        const g = result.lines[lineIdx]?.glyphs[gIdx]
        if (g !== undefined) onGlyphClick(g, lineIdx, e.shiftKey || e.metaKey || e.ctrlKey)
      }
    }
  }

  const inRange = (g: Glyph) =>
    !!selectedRange && g.start < selectedRange.end && g.end > selectedRange.start

  const zoomPct = Math.round((content.w / view.w) * 100)
  const lineW = Math.max(0.6, view.w / 1200)

  return (
    <div className="canvas-wrap">
      <div className="canvas-toolbar">
        <button type="button" onClick={() => zoomBy(1 / 1.25)} title="放大">＋</button>
        <button type="button" onClick={() => zoomBy(1.25)} title="缩小">－</button>
        <span className="zoom-label">{zoomPct}%</span>
        <button type="button" onClick={fit} title="适应窗口">适应</button>
      </div>
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
      >
        {result.direction !== 'ttb' &&
          result.lines.map((ln) => (
            <line
              key={`bl-${ln.index}`}
              x1={0}
              x2={result.width}
              y1={ln.baseline}
              y2={ln.baseline}
              stroke="#cbd5e1"
              strokeWidth={lineW}
              strokeDasharray={`${6 * lineW} ${5 * lineW}`}
            />
          ))}

        {result.lines.map((line) =>
          line.glyphs.map((g, i) => {
            const key = glyphKey(line.index, i)
            const selected = inRange(g)
            const isPrimary = key === primaryKey
            const baseline = line.baseline
            const oy = result.direction === 'ttb' ? -g.y : baseline - g.y
            const hr = hitRect(g, result, baseline)
            const notdef = g.name === '.notdef'
            return (
              <g
                key={key}
                className="glyph"
                data-line={line.index}
                data-gindex={i}
              >
                {g.d && (
                  <path
                    className="glyph-path"
                    d={g.d}
                    transform={`translate(${g.x},${oy}) scale(1,-1)`}
                    fill={notdef ? '#dc2626' : '#1f2937'}
                    fillOpacity={selected ? (isPrimary ? 0.95 : 0.55) : 1}
                  />
                )}
                <rect className="glyph-hit" x={hr.x} y={hr.y} width={hr.w} height={hr.h} />
                {selected && (
                  <rect
                    x={hr.x}
                    y={hr.y}
                    width={hr.w}
                    height={hr.h}
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth={Math.max(1.2, lineW * 1.6)}
                    strokeDasharray={isPrimary ? undefined : `${5 * lineW} ${4 * lineW}`}
                    pointerEvents="none"
                  />
                )}
                {g.bbox ? (
                  <rect
                    x={g.bbox[0]}
                    y={result.direction === 'ttb' ? -g.bbox[3] : baseline - g.bbox[3]}
                    width={g.bbox[2] - g.bbox[0]}
                    height={g.bbox[3] - g.bbox[1]}
                    fill="none"
                    stroke={notdef ? '#dc2626' : '#94a3b8'}
                    strokeWidth={lineW * 0.6}
                    strokeOpacity={0.4}
                    pointerEvents="none"
                  />
                ) : null}
                <title>{`${g.name} · 输入码点区间 [${g.start}, ${g.end})`}</title>
              </g>
            )
          })
        )}
      </svg>
    </div>
  )
}
