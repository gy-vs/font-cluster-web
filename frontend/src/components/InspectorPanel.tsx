import type { Glyph } from '../types'
import { codePointSlice, codepointLabel } from '../unicode'

export interface GlyphRef {
  glyph: Glyph
  lineIndex: number
  indexInLine: number
}

interface Props {
  text: string
  selectedRange: { start: number; end: number } | null
  primary: GlyphRef | null
  extraGlyphs: GlyphRef[]
  onPickGlyph: (ref: GlyphRef) => void
  onCopyGlyphs: () => void
  onCopyJson: () => void
  copied: string | null
}

function GlyphCard({
  refG,
  primary,
  onPick
}: {
  refG: GlyphRef
  primary: boolean
  onPick: () => void
}) {
  const { glyph: g } = refG
  return (
    <div
      className={`glyph-item${primary ? ' primary' : ''}`}
      onClick={onPick}
      role="button"
    >
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="gn">{g.name}</span>
        <span className="gr">gid {g.gid}</span>
      </div>
      <div className="gr">
        码点 [{g.start}, {g.end}) · 行 {g.line} · x_adv {g.x_advance}
        {g.y_advance ? ` · y_adv ${g.y_advance}` : ''}
      </div>
    </div>
  )
}

export default function InspectorPanel({
  text,
  selectedRange,
  primary,
  extraGlyphs,
  onPickGlyph,
  onCopyGlyphs,
  onCopyJson,
  copied
}: Props) {
  const sel = selectedRange
  const chars = sel ? Array.from(codePointSlice(text, sel.start, sel.end)) : []

  return (
    <div className="panel flex">
      <div className="panel-head">
        检查
        <div style={{ flex: 1 }} />
        <button type="button" onClick={onCopyGlyphs} title="每个字形一行，含码点区间">
          复制字形序列
        </button>
        <button type="button" onClick={onCopyJson} title="复制本次排版计算 JSON（不含轮廓）">
          复制 JSON
        </button>
      </div>
      <div className="panel-body">
        {copied && <div className="banner info" style={{ margin: '0 0 10px' }}>{copied}</div>}

        {!sel && (
          <div className="drop-hint">
            点画布里的字形可查看它对应的原始文本；
            在输入框里选中文字，可找到这段内容参与形成的字形。
            <br />
            <br />
            <span className="muted">
              一个字形可能覆盖多个码点（如连字），关联取自 HarfBuzz 的 cluster
              计算结果，而不是按顺序逐个配对。
            </span>
          </div>
        )}

        {sel && (
          <>
            <div className="field">
              <label>选中文本（码点区间 [{sel.start}, {sel.end})）</label>
              <div className="chip-row">
                {chars.map((ch, i) => (
                  <span className="chip" key={i}>
                    {ch === '\n' ? '⏎' : ch === ' ' ? '␠' : ch}
                    <span className="cp">{codepointLabel(ch)}</span>
                  </span>
                ))}
              </div>
            </div>

            <div className="field">
              <label>参与形成的字形（{1 + extraGlyphs.length}）</label>
              {primary && (
                <GlyphCard refG={primary} primary onPick={() => onPickGlyph(primary)} />
              )}
              {extraGlyphs.map((refG) => (
                <GlyphCard
                  key={`${refG.lineIndex}:${refG.indexInLine}`}
                  refG={refG}
                  primary={false}
                  onPick={() => onPickGlyph(refG)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
