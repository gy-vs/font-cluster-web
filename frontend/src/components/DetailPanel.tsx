import type { GlyphRecord, ShapeResult } from "../types";
import { codePointSlice } from "../utf16";

export type Selection =
  | { kind: "none" }
  | {
      kind: "glyph";
      start: number;
      end: number;
      glyph: GlyphRecord | null;
    }
  | { kind: "range"; start: number; end: number };

interface DetailPanelProps {
  selection: Selection;
  result: ShapeResult;
  onGlyphSelect: (glyph: GlyphRecord) => void;
}

export function DetailPanel({
  selection,
  result,
  onGlyphSelect,
}: DetailPanelProps) {
  if (selection.kind === "none") {
    return (
      <section className="panel detail-panel">
        <h2>关联详情</h2>
        <p className="muted small">
          点击右侧任一字形，查看它关联的原始文本；或在输入框中选中文字，查看参与形成的字形。
        </p>
      </section>
    );
  }

  const text = result.text;
  const covered = codePointSlice(text, selection.start, selection.end);

  if (selection.kind === "glyph") {
    const glyph = selection.glyph;
    if (!glyph) {
      return (
        <section className="panel detail-panel">
          <h2>关联详情</h2>
          <p className="muted small">该字形已不在最新一轮排版结果中。</p>
          <div>原选择的文本：<code>{displayText(covered)}</code></div>
        </section>
      );
    }
    const clusterText = codePointSlice(text, glyph.clusterStart, glyph.clusterEnd);
    return (
      <section className="panel detail-panel">
        <h2>字形 → 原始文本</h2>
        <dl className="detail-grid">
          <dt>字形名</dt>
          <dd>
            <code>{glyph.name}</code>
          </dd>
          <dt>字形 ID (gid)</dt>
          <dd>{glyph.gid}</dd>
          <dt>输出序号（视觉序）</dt>
          <dd>{glyph.index} / {result.glyphs.length}</dd>
          <dt>原始字符范围</dt>
          <dd>
            第 {glyph.clusterStart + 1}–{glyph.clusterEnd} 个字符（共{" "}
            {glyph.clusterEnd - glyph.clusterStart} 个）
          </dd>
          <dt>关联文本</dt>
          <dd className="cluster-text">
            <code>{displayText(clusterText)}</code>
            <span className="muted small">
              {" "}
              U+{codePoints(clusterText)}
            </span>
          </dd>
          <dt>笔位 (x, y)</dt>
          <dd>
            ({glyph.x}, {glyph.y})
          </dd>
          <dt>前进量</dt>
          <dd>
            ({glyph.advanceX}, {glyph.advanceY})
          </dd>
          <dt>墨痕盒 [xMin,yMin,xMax,yMax]</dt>
          <dd className="small">
            {glyph.ink ? glyph.ink.map((v) => Math.round(v)).join(", ") : "（空）"}
          </dd>
        </dl>
        <p className="muted small">
          {glyph.clusterEnd - glyph.clusterStart > 1
            ? "一个字形由多个输入字符经排版特性（如连字）合并形成。"
            : "该字形与一个输入字符对应。"}
        </p>
      </section>
    );
  }

  // Text range selection -> glyphs.
  const matches = result.glyphs.filter(
    (g) => g.clusterStart < selection.end && g.clusterEnd > selection.start
  );
  return (
    <section className="panel detail-panel">
      <h2>原始文本 → 字形</h2>
      <div>
        所选文本：<code>{displayText(covered) || "（无字符）"}</code>
        <span className="muted small">
          {" "}
          字符 {selection.start + 1}–{selection.end}
        </span>
      </div>
      <div className="matched-glyphs">
        参与形成 {matches.length} 个字形：
        {matches.length === 0 && (
          <span className="muted small">
            这些字符未产生任何输出字形（被合并、替换或吞掉）。
          </span>
        )}
      </div>
      <ol className="glyph-list">
        {matches.map((g) => (
          <li key={g.index}>
            <button
              type="button"
              className="glyph-list-item"
              onClick={() => onGlyphSelect(g)}
            >
              <span className="glyph-list-index">#{g.index}</span>
              <code>{g.name}</code>
              <span className="muted small">
                gid {g.gid} · 字符 {g.clusterStart + 1}–{g.clusterEnd}
                {g.clusterEnd - g.clusterStart > 1 ? " · 连字/多分字" : ""}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function displayText(value: string): string {
  if (value === "") return "（空字符）";
  return value.replace(/\n/g, "⏎").replace(/\t/g, "⇥");
}

function codePoints(value: string): string {
  return Array.from(value)
    .map((ch) => (ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0"))
    .join(" U+");
}
