import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  listSamples,
  loadSample,
  shape as shapeApi,
  uploadFont,
  type ShapeParams,
} from "./api";
import { FontPanel } from "./components/FontPanel";
import { FeaturePanel } from "./components/FeaturePanel";
import { TextPanel } from "./components/TextPanel";
import { GlyphCanvas } from "./components/GlyphCanvas";
import { DetailPanel, type Selection } from "./components/DetailPanel";
import type {
  Direction,
  FeatureState,
  FontSessionPayload,
  GlyphRecord,
  SampleInfo,
  ShapeResult,
} from "./types";
import {
  codePointSlice,
  codePointToUtf16Offset,
  utf16ToCodePointRange,
} from "./utf16";

const SHAPE_DEBOUNCE_MS = 150;

export default function App() {
  const [samples, setSamples] = useState<SampleInfo[]>([]);
  const [session, setSession] = useState<FontSessionPayload | null>(null);
  const [loadingFont, setLoadingFont] = useState(false);
  const [fontError, setFontError] = useState<string | null>(null);

  const [text, setText] = useState("ffi 连字 ABC，أب RTL，é😃Z");
  const [direction, setDirection] = useState<Direction>("auto");
  // Only explicitly pinned overrides live here; unpinned tags follow the
  // font's HarfBuzz defaults as reported per shape response.
  const [pinned, setPinned] = useState<Record<string, boolean>>({});

  const [result, setResult] = useState<ShapeResult | null>(null);
  const [shaping, setShaping] = useState(false);
  const [shapeError, setShapeError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "ok" | "fail">("idle");

  // Selection is anchored to the *text meaning* (codepoint offsets), so it
  // survives reshaping instead of following output position.
  const [selection, setSelection] = useState<Selection>({ kind: "none" });

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);
  const debounceRef = useRef<number | null>(null);

  // Discover bundled samples once.
  useEffect(() => {
    const controller = new AbortController();
    listSamples(controller.signal)
      .then(setSamples)
      .catch(() => setSamples([]));
    return () => controller.abort();
  }, []);

  // Auto-load the bundled sample on first open (same parse path as upload).
  useEffect(() => {
    const controller = new AbortController();
    loadSample("DejaVuSans.ttf", controller.signal)
      .then((payload) => setSession(payload))
      .catch(() => {
        /* sample missing: user can still upload manually */
      });
    return () => controller.abort();
  }, []);

  const requestShape = useCallback(
    (next: {
      sessionId: string;
      text: string;
      direction: Direction;
      pinned: Record<string, boolean>;
    }) => {
      // While a computation is in flight we show only the waiting state:
      // the previous glyphs are cleared so outlines/ranges never mix.
      setShaping(true);
      setShapeError(null);
      setResult(null);

      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const seq = ++seqRef.current;

      const params: ShapeParams = {
        text: next.text,
        direction: next.direction,
        features: next.pinned,
      };
      shapeApi(next.sessionId, params, controller.signal)
        .then((res) => {
          if (seq !== seqRef.current) return; // a newer request superseded this one
          setResult(res);
          setShaping(false);
          // Re-anchor selection to the same text content in the new result.
          setSelection((sel) => reanchorSelection(sel, next.text, res));
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          if (seq !== seqRef.current) return;
          setShaping(false);
          if (err instanceof ApiError) setShapeError(err.message);
          else setShapeError("排版请求失败");
        });
    },
    []
  );

  const scheduleShape = useCallback(
    (next: {
      sessionId: string;
      text: string;
      direction: Direction;
      pinned: Record<string, boolean>;
    }) => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      // Read no external state inside the timeout: under StrictMode a stale
      // effect's closure would otherwise resend previous parameter values.
      debounceRef.current = window.setTimeout(
        () => requestShape(next),
        SHAPE_DEBOUNCE_MS
      );
    },
    [requestShape]
  );

  // Recompute whenever the font or any shaping input changes.  A changing
  // key cancels the previously scheduled request immediately.
  useEffect(() => {
    if (!session) return;
    scheduleShape({
      sessionId: session.sessionId,
      text,
      direction,
      pinned,
    });
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, text, direction, pinned]);

  // Abort in-flight request on unmount.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const handleUpload = useCallback(async (file: File) => {
    setLoadingFont(true);
    setFontError(null);
    try {
      const payload = await uploadFont(file);
      setSession(payload);
      setPinned({});
      setSelection({ kind: "none" });
    } catch (err) {
      // Failure only shows an error; the already open session keeps working.
      setFontError(err instanceof ApiError ? err.message : "字体读取失败");
    } finally {
      setLoadingFont(false);
    }
  }, []);

  const handleSample = useCallback(async (key: string) => {
    setLoadingFont(true);
    setFontError(null);
    try {
      const payload = await loadSample(key);
      setSession(payload);
      setPinned({});
      setSelection({ kind: "none" });
    } catch (err) {
      setFontError(err instanceof ApiError ? err.message : "样本字体加载失败");
    } finally {
      setLoadingFont(false);
    }
  }, []);

  const handleTextChange = useCallback((value: string) => {
    setText(value);
    // Shrink a selection that no longer fits the new text; keep its meaning.
    setSelection((sel) => clampSelection(sel, value.length));
  }, []);

  const handleDirectionChange = useCallback((value: Direction) => {
    setDirection(value);
  }, []);

  const handleFeatureToggle = useCallback((tag: string, on: boolean) => {
    setPinned((prev) => ({ ...prev, [tag]: on }));
  }, []);

  const handleResetFeatures = useCallback(() => setPinned({}), []);

  const featureStates: FeatureState[] | null = result?.features ?? null;

  // Glyph(s) implied by the current text-anchored selection, evaluated in
  // the latest shaping result.
  const { activeGlyphIndex, rangeGlyphIndexes, textSelected } = useMemo(() => {
    if (!result || selection.kind === "none") {
      return {
        activeGlyphIndex: null,
        rangeGlyphIndexes: new Set<number>(),
        textSelected: false,
      };
    }
    let active: number | null = null;
    const set = new Set<number>();
    for (const g of result.glyphs) {
      if (g.clusterStart < selection.end && g.clusterEnd > selection.start) {
        set.add(g.index);
      }
    }
    if (selection.kind === "glyph" && selection.glyph) {
      const found = result.glyphs.find(
        (g) =>
          g.index === selection.glyph!.index &&
          g.clusterStart === selection.glyph!.clusterStart &&
          g.clusterEnd === selection.glyph!.clusterEnd &&
          g.gid === selection.glyph!.gid
      );
      active = found ? found.index : null;
      if (!found) set.clear();
    }
    return {
      activeGlyphIndex: active,
      rangeGlyphIndexes: set,
      textSelected: selection.kind === "range",
    };
  }, [result, selection]);

  // Click a glyph: remember the text it maps (meaning), and select that text
  // inside the textarea so both sides agree.
  const handleGlyphClick = useCallback(
    (glyph: GlyphRecord) => {
      if (!result) return;
      const u16Start = codePointToUtf16Offset(result.text, glyph.clusterStart);
      const u16End = codePointToUtf16Offset(result.text, glyph.clusterEnd);
      selectTextarea(u16Start, u16End);
      setSelection({
        kind: "glyph",
        start: glyph.clusterStart,
        end: glyph.clusterEnd,
        glyph,
      });
    },
    [result]
  );

  const selectTextarea = useCallback((u16Start: number, u16End: number) => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(u16Start, u16End);
  }, []);

  const handleTextSelect = useCallback(
    (u16Start: number, u16End: number) => {
      const [start, end] = utf16ToCodePointRange(text, u16Start, u16End);
      if (start === end) {
        setSelection({ kind: "none" });
        return;
      }
      setSelection({ kind: "range", start, end });
    },
    [text]
  );

  // Clicking a glyph in the detail list.
  const handleDetailGlyphSelect = useCallback(
    (glyph: GlyphRecord) => {
      handleGlyphClick(glyph);
    },
    [handleGlyphClick]
  );

  const handleBackgroundClick = useCallback(() => {
    const el = textareaRef.current;
    if (el) el.setSelectionRange(el.selectionStart ?? 0, el.selectionStart ?? 0);
    setSelection({ kind: "none" });
  }, []);

  const handleCopyReport = useCallback(async () => {
    if (!result) return;
    const lines = [
      `# 排版结果`,
      `字体: ${session?.font.familyName ?? ""}`,
      `文本: ${JSON.stringify(result.text)}`,
      `方向: ${result.direction}（请求 ${result.requestedDirection}）  脚本: ${result.script}  语言: ${result.language}`,
      `upem: ${result.upem}  字形数: ${result.glyphs.length}`,
      `特性: ${result.features
        .filter((f) => f.applicable)
        .map((f) => `${f.tag}=${f.on ? "+" : "-"}`)
        .join(" ")}`,
      `序号\tgid\t字形名\t字符起\t字符止\tUTF16起\tUTF16止\tx\ty\t前进X\t前进Y\t关联文本`,
      ...result.glyphs.map((g) =>
        [
          g.index,
          g.gid,
          g.name,
          g.clusterStart,
          g.clusterEnd,
          g.utf16Start,
          g.utf16End,
          g.x,
          g.y,
          g.advanceX,
          g.advanceY,
          JSON.stringify(codePointSlice(result.text, g.clusterStart, g.clusterEnd)),
        ].join("\t")
      ),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopyState("ok");
    } catch {
      setCopyState("fail");
    }
    window.setTimeout(() => setCopyState("idle"), 1800);
  }, [result, session]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>字体排版检查器</h1>
        <span className="muted small">
          服务端 HarfBuzz + fontTools 计算 · 浏览器只渲染返回的轮廓与映射
        </span>
      </header>
      <div className="layout">
        <aside className="sidebar">
          <FontPanel
            samples={samples}
            session={session}
            loadingFont={loadingFont}
            error={fontError}
            onUpload={handleUpload}
            onSample={handleSample}
          />
          {session && (
            <FeaturePanel
              font={session.font}
              states={featureStates}
              pinned={pinned}
              onToggle={handleFeatureToggle}
              onReset={handleResetFeatures}
            />
          )}
        </aside>
        <main className="main">
          <TextPanel
            text={text}
            onTextChange={handleTextChange}
            direction={direction}
            onDirectionChange={handleDirectionChange}
            result={result}
            textareaRef={textareaRef}
            onSelect={handleTextSelect}
            onCopyReport={handleCopyReport}
            copyState={copyState}
          />
          <div className="canvas-area">
            {shaping && (
              <div className="shape-overlay" role="status">
                <div className="spinner" />
                正在进行排版计算…
              </div>
            )}
            {!shaping && shapeError && (
              <div className="status error" role="alert">
                排版失败：{shapeError}
              </div>
            )}
            {!shaping && !shapeError && result && (
              <GlyphCanvas
                result={result}
                activeGlyphIndex={activeGlyphIndex}
                rangeGlyphIndexes={rangeGlyphIndexes}
                textSelected={textSelected}
                onGlyphClick={handleGlyphClick}
                onBackgroundClick={handleBackgroundClick}
              />
            )}
          </div>
          {result && (
            <DetailPanel
              selection={selection}
              result={result}
              onGlyphSelect={handleDetailGlyphSelect}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function clampSelection(sel: Selection, length: number): Selection {
  if (sel.kind === "none") return sel;
  if (sel.start >= length) return { kind: "none" };
  return { ...sel, start: sel.start, end: Math.min(sel.end, length) };
}

function reanchorSelection(
  sel: Selection,
  text: string,
  result: ShapeResult
): Selection {
  if (sel.kind === "none") return sel;
  const start = Math.min(sel.start, text.length);
  const end = Math.min(sel.end, text.length);
  if (start >= end) return { kind: "none" };
  if (sel.kind === "range") return { kind: "range", start, end };
  // For glyph-origin selections keep the text meaning; the glyph is looked up
  // again by cluster + gid in the new result (handled in render memo). If a
  // single glyph no longer owns exactly this range, degrade gracefully.
  const glyph =
    result.glyphs.find(
      (g) =>
        g.clusterStart === start &&
        g.clusterEnd === end &&
        g.gid === sel.glyph?.gid
    ) ??
    result.glyphs.find((g) => g.clusterStart === start && g.clusterEnd === end) ??
    null;
  return { kind: "glyph", start, end, glyph };
}
