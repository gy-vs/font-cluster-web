import { useEffect, useRef } from 'react'
import type { Direction, ShapeResult } from '../types'
import {
  codePointLength,
  codePointSlice,
  codePointToUtf16Offset,
  utf16ToCodePointOffset
} from '../unicode'

interface Props {
  text: string
  direction: Direction
  onTextChange: (text: string) => void
  onDirectionChange: (d: Direction) => void
  selectedRange: { start: number; end: number } | null
  selectionOrigin: 'glyph' | 'text' | null
  onTextSelect: (start: number, end: number) => void
  result: ShapeResult | null
}

const DIRECTIONS: { value: Direction; label: string }[] = [
  { value: 'auto', label: '自动' },
  { value: 'ltr', label: 'LTR 横排' },
  { value: 'rtl', label: 'RTL 横排' },
  { value: 'ttb', label: 'TTB 直排' }
]

export default function TextPanel({
  text,
  direction,
  onTextChange,
  onDirectionChange,
  selectedRange,
  selectionOrigin,
  onTextSelect,
  result
}: Props) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const lastApplied = useRef<string>('')

  // When a glyph is clicked, the corresponding code point range should be
  // selected natively in the textarea.
  useEffect(() => {
    const ta = ref.current
    if (!ta || !selectedRange || selectionOrigin !== 'glyph') return
    const key = `${selectedRange.start}:${selectedRange.end}:${text.length}`
    if (lastApplied.current === key) return
    lastApplied.current = key
    const a = codePointToUtf16Offset(text, selectedRange.start)
    const b = codePointToUtf16Offset(text, Math.min(selectedRange.end, codePointLength(text)))
    ta.focus()
    ta.setSelectionRange(a, b)
  }, [selectedRange, selectionOrigin, text])

  const readSelection = () => {
    const ta = ref.current
    if (!ta) return
    const start = utf16ToCodePointOffset(text, ta.selectionStart)
    const end = utf16ToCodePointOffset(text, ta.selectionEnd)
    if (start !== end) onTextSelect(start, end)
  }

  const notdefCount = result
    ? result.lines.reduce(
        (n, ln) => n + ln.glyphs.filter((g) => g.name === '.notdef').length,
        0
      )
    : 0

  return (
    <div className="text-block">
      <div className="text-block-head">
        <strong>输入文本</strong>
        <div className="spacer" style={{ flex: 1 }} />
        <div className="seg">
          {DIRECTIONS.map((d) => (
            <button
              key={d.value}
              type="button"
              className={direction === d.value ? 'active' : ''}
              onClick={() => onDirectionChange(d.value)}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>
      <div className="text-block-body">
        <textarea
          id="text-input"
          ref={ref}
          value={text}
          spellCheck={false}
          dir="auto"
          onChange={(e) => onTextChange(e.target.value)}
          onSelect={readSelection}
          onKeyUp={readSelection}
          onMouseUp={readSelection}
          placeholder="输入要检查的文本，例如 office لا 或 مكتبة"
        />
        <div className="row" style={{ marginTop: 8, justifyContent: 'space-between' }}>
          <span className="muted">
            {codePointLength(text)} 个码点 ·{' '}
            {result ? `${result.lines.length} 行 · ` : ''}
            {result
              ? `${result.lines.reduce((n, l) => n + l.glyphs.length, 0)} 个字形`
              : '—'}
            {notdefCount > 0 && (
              <span style={{ color: '#dc2626' }}> · {notdefCount} 个 .notdef（红色）</span>
            )}
          </span>
          {selectedRange && selectionOrigin === 'glyph' && (
            <span className="muted">
              已定位：“{codePointSlice(text, selectedRange.start, selectedRange.end)}”
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
