import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadSampleFont, shapeText, uploadFont } from './api'
import type {
  Direction,
  FontInfo,
  Glyph,
  ShapeResult
} from './types'
import { codePointLength } from './unicode'
import GlyphCanvas from './components/GlyphCanvas'
import FontPanel from './components/FontPanel'
import FeaturesPanel from './components/FeaturesPanel'
import TextPanel from './components/TextPanel'
import InspectorPanel, { type GlyphRef } from './components/InspectorPanel'

const DEFAULT_TEXT = 'The office is open.\nمَكْتَبَة: مكتبة كتب\nلا لا office'

interface FontSession {
  sessionId: string
  filename: string
  info: FontInfo
}

export default function App() {
  const [session, setSession] = useState<FontSession | null>(null)
  const [text, setText] = useState(DEFAULT_TEXT)
  const [direction, setDirection] = useState<Direction>('auto')
  const [features, setFeatures] = useState<Record<string, boolean>>({})
  const [variations, setVariations] = useState<Record<string, number>>({})

  const [result, setResult] = useState<ShapeResult | null>(null)
  const [shaping, setShaping] = useState(false)
  const [shapeError, setShapeError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [sampleLoading, setSampleLoading] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  // Selection is tracked as *text meaning* (code point offsets), never as the
  // ordinal index of a glyph, so it survives text edits and re-shaping.
  const [selectedRange, setSelectedRange] = useState<{ start: number; end: number } | null>(
    null
  )
  const [primaryRange, setPrimaryRange] = useState<{ start: number; end: number } | null>(
    null
  )
  const [selectionOrigin, setSelectionOrigin] = useState<'glyph' | 'text' | null>(null)

  const reqId = useRef(0)
  const debounceRef = useRef<number | null>(null)
  const sessionRef = useRef(session)
  sessionRef.current = session

  // -------------------------------------------------------------- font load
  const acceptFont = useCallback((s: FontSession) => {
    setSession(s)
    setUploadError(null)
    setShapeError(null)
    setFeatures(
      Object.fromEntries(
        [...s.info.features.GSUB, ...s.info.features.GPOS].map((f) => [
          f.tag,
          f.default_on
        ])
      )
    )
    setVariations(Object.fromEntries(s.info.axes.map((a) => [a.tag, a.default])))
  }, [])

  const doUpload = useCallback(
    async (blob: Blob, filename: string) => {
      setUploading(true)
      setUploadError(null)
      try {
        const resp = await uploadFont(blob, filename)
        // The previous valid session stays open right up until this point:
        // a rejected upload never mutates `session` or `result`.
        acceptFont({
          sessionId: resp.session_id,
          filename: resp.filename,
          info: resp.font
        })
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : String(err))
      } finally {
        setUploading(false)
      }
    },
    [acceptFont]
  )

  const onFileSelected = useCallback(
    (file: File) => {
      void doUpload(file, file.name)
    },
    [doUpload]
  )

  const onLoadSample = useCallback(async () => {
    setSampleLoading(true)
    setUploadError(null)
    try {
      // The sample is downloaded as bytes and posted through the very same
      // upload endpoint, so it goes through identical parsing/shaping.
      const { blob, name } = await loadSampleFont()
      await doUpload(blob, name)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err))
    } finally {
      setSampleLoading(false)
    }
  }, [doUpload])

  // First open: load the redistributable sample automatically.
  useEffect(() => {
    void onLoadSample()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ------------------------------------------------------------- shaping run
  const runShape = useCallback(
    (sess: FontSession, bodyText: string, bodyDir: Direction, feats: Record<string, boolean>, vars: Record<string, number>) => {
      const id = ++reqId.current
      setShaping(true)
      shapeText({
        session_id: sess.sessionId,
        text: bodyText,
        direction: bodyDir,
        features: feats,
        variations: vars,
        font_size: 64
      })
        .then((r) => {
          // Only the newest request may paint; otherwise an older font's
          // outlines could be combined with a newer text's ranges.
          if (id !== reqId.current) return
          setResult(r)
          setShapeError(null)
        })
        .catch((err: unknown) => {
          if (id !== reqId.current) return
          setShapeError(err instanceof Error ? err.message : String(err))
        })
        .finally(() => {
          if (id === reqId.current) setShaping(false)
        })
    },
    []
  )

  // Debounced (re)shape whenever any shaping input changes.
  useEffect(() => {
    if (!session) return
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      runShape(session, text, direction, features, variations)
    }, 220)
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
    }
  }, [session, text, direction, features, variations, runShape])

  // Invalidate every in-flight shape as soon as the font changes so an old
  // font's late response can never paint over the new session.
  useEffect(() => {
    reqId.current += 1
    setResult(null)
    setShaping(true)
  }, [session?.sessionId])

  // Keep selection offsets valid as text is edited; never silently re-point at
  // the same ordinal glyph.
  useEffect(() => {
    const len = codePointLength(text)
    setSelectedRange((r) => {
      if (!r) return r
      if (r.end <= len) return r
      const start = Math.min(r.start, len)
      const end = Math.min(r.end, len)
      return start < end ? { start, end } : null
    })
    setPrimaryRange((r) => (r && r.end > len ? null : r))
  }, [text])

  // --------------------------------------------------------- selection model
  const flatGlyphs = useMemo<GlyphRef[]>(() => {
    if (!result) return []
    return result.lines.flatMap((line, lineIndex) =>
      line.glyphs.map((glyph, indexInLine) => ({ glyph, lineIndex, indexInLine }))
    )
  }, [result])

  // Resolve the "primary" glyph from its text range against the *current*
  // result, so identity follows meaning across re-shapes.
  const primary: GlyphRef | null = useMemo(() => {
    if (!result || !primaryRange) return null
    const exact = flatGlyphs.find(
      (g) => g.glyph.start === primaryRange.start && g.glyph.end === primaryRange.end
    )
    if (exact) return exact
    const center = (primaryRange.start + primaryRange.end) / 2
    const covering = flatGlyphs
      .filter((g) => g.glyph.start < primaryRange.end && g.glyph.end > primaryRange.start)
      .sort(
        (a, b) =>
          Math.abs((a.glyph.start + a.glyph.end) / 2 - center) -
          Math.abs((b.glyph.start + b.glyph.end) / 2 - center)
      )[0]
    return covering ?? null
  }, [result, primaryRange, flatGlyphs])

  const intersecting: GlyphRef[] = useMemo(() => {
    if (!result || !selectedRange) return []
    const keyOf = (g: GlyphRef) => `${g.lineIndex}:${g.indexInLine}`
    const pkey = primary ? keyOf(primary) : null
    return flatGlyphs
      .filter(
        (g) =>
          g.glyph.start < selectedRange.end &&
          g.glyph.end > selectedRange.start &&
          keyOf(g) !== pkey
      )
  }, [result, selectedRange, primary, flatGlyphs])

  const onGlyphClick = useCallback(
    (glyph: Glyph, _lineIndex: number, additive: boolean) => {
      const range = { start: glyph.start, end: glyph.end }
      if (additive && selectedRange) {
        setSelectedRange({
          start: Math.min(selectedRange.start, range.start),
          end: Math.max(selectedRange.end, range.end)
        })
      } else {
        setSelectedRange(range)
      }
      setPrimaryRange(range)
      setSelectionOrigin('glyph')
    },
    [selectedRange]
  )

  const onTextSelect = useCallback((start: number, end: number) => {
    if (start >= end) return
    setSelectedRange({ start, end })
    setSelectionOrigin('text')
    // Primary glyph for a text selection: the one whose cluster contains the
    // selection anchor (start).
    setPrimaryRange({ start, end })
  }, [])

  const onPickGlyph = useCallback((ref: GlyphRef) => {
    setSelectedRange({ start: ref.glyph.start, end: ref.glyph.end })
    setPrimaryRange({ start: ref.glyph.start, end: ref.glyph.end })
    setSelectionOrigin('glyph')
  }, [])

  // Primary key (line:index within current result) for the canvas.
  const primaryKey = useMemo(() => {
    if (!primary) return null
    return `${primary.lineIndex}:${primary.indexInLine}`
  }, [primary])

  // -------------------------------------------------------------------- copy
  const flashCopied = (msg: string) => {
    setCopied(msg)
    window.setTimeout(() => setCopied(null), 1600)
  }

  const onCopyGlyphs = useCallback(async () => {
    if (!result) return
    const lines = result.lines.map((ln) =>
      ln.glyphs
        .map((g) => {
          const src = Array.from(text)
            .slice(g.start, Math.min(g.end, codePointLength(text)))
            .join('')
            .replace(/\n/g, '\\n')
          return `${g.name}\tgid=${g.gid}\t[${g.start},${g.end})\t"${src}"`
        })
        .join('\n')
    )
    await navigator.clipboard.writeText(lines.join('\n'))
    flashCopied('已复制字形序列')
  }, [result, text])

  const onCopyJson = useCallback(async () => {
    if (!result) return
    const slim = {
      ...result,
      lines: result.lines.map((ln) => ({
        ...ln,
        glyphs: ln.glyphs.map(({ d: _d, ...rest }) => {
          void _d
          return rest
        })
      }))
    }
    await navigator.clipboard.writeText(JSON.stringify(slim, null, 2))
    flashCopied('已复制排版结果 JSON')
  }, [result])

  // ------------------------------------------------------------------- render
  return (
    <div className="app">
      <div className="font-bar">
        <span className="brand">
          字形排版检查
          <small>HarfBuzz 服务端计算 · 浏览器只绘制返回的轮廓</small>
        </span>
        {session && (
          <span className="font-meta">
            <span className="name">{session.info.full_name}</span>{' '}
            <span className="sub">
              {session.info.kind} · {session.info.glyph_count} 字形
            </span>
          </span>
        )}
        <span className="spacer" />
        <a
          href="/sample/OFL.txt"
          target="_blank"
          rel="noreferrer"
          className="muted"
          title="样本字体授权"
        >
          样本授权 OFL
        </a>
      </div>

      {shapeError && (
        <div className="banner error" style={{ marginTop: 10 }}>
          本次排版计算失败：{shapeError}
          {result && <div className="hint" style={{ marginTop: 4 }}>仍显示上一次成功的结果，未与新参数混合。</div>}
        </div>
      )}

      <div className="main">
        <div className="col-left">
          <FontPanel
            font={session?.info ?? null}
            filename={session?.filename ?? null}
            loadingFont={uploading}
            sampleLoading={sampleLoading}
            onFileSelected={onFileSelected}
            onLoadSample={onLoadSample}
            error={uploadError}
          />
          {session && (
            <FeaturesPanel
              font={session.info}
              features={features}
              variations={variations}
              onToggleFeature={(tag, value) =>
                setFeatures((m) => ({ ...m, [tag]: value }))
              }
              onVariation={(tag, value) =>
                setVariations((m) => ({ ...m, [tag]: value }))
              }
            />
          )}
        </div>

        <div className="col-center">
          <div className="panel center-panel">
            <TextPanel
              text={text}
              direction={direction}
              onTextChange={setText}
              onDirectionChange={setDirection}
              selectedRange={shaping ? null : selectedRange}
              selectionOrigin={selectionOrigin}
              onTextSelect={onTextSelect}
              result={result}
            />
            {result ? (
              <div className="canvas-stage">
                <div className={shaping ? 'dimmed canvas-stage-inner' : 'canvas-stage-inner'}>
                  <GlyphCanvas
                    result={result}
                    selectedRange={shaping ? null : selectedRange}
                    primaryKey={primaryKey}
                    onGlyphClick={onGlyphClick}
                  />
                </div>
                {shaping && (
                  <div className="overlay">
                    <div className="spinner" />
                    正在用当前字体重新排版…
                  </div>
                )}
              </div>
            ) : (
              <div className="canvas-stage">
                <div className="overlay">
                  {shapeError ? (
                    <>排版计算失败，调整参数后将自动重试。</>
                  ) : (
                    <>
                      <div className="spinner" />
                      {session ? '正在排版…' : '正在载入样本字体…'}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="col-right">
          {result && (
            <InspectorPanel
              text={text}
              selectedRange={selectedRange}
              primary={primary}
              extraGlyphs={intersecting}
              onPickGlyph={onPickGlyph}
              onCopyGlyphs={onCopyGlyphs}
              onCopyJson={onCopyJson}
              copied={copied}
            />
          )}
        </div>
      </div>
    </div>
  )
}
