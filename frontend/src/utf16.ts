// UTF-16 <-> codepoint offset conversion.  Textarea selectionStart/End are
// UTF-16 offsets; the shaped glyph ranges carry both spaces.

/** Convert a UTF-16 [start,end) range in text to codepoint indices. */
export function utf16ToCodePointRange(
  text: string,
  u16Start: number,
  u16End: number
): [number, number] {
  const codeCount = Array.from(text).length;
  let codeStart = codeCount;
  let codeEnd = codeCount;
  let u16Offset = 0;
  let codeIndex = 0;
  let i = 0;
  while (i < text.length) {
    if (u16Offset === u16Start) codeStart = codeIndex;
    if (u16Offset >= u16End) {
      codeEnd = codeIndex;
      return [codeStart, codeEnd];
    }
    const cp = text.codePointAt(i) ?? 0;
    const step = cp > 0xffff ? 2 : 1;
    u16Offset += step;
    i += step;
    codeIndex++;
  }
  return [codeStart, codeEnd];
}

/** Codepoint index -> UTF-16 offset in text. */
export function codePointToUtf16Offset(
  text: string,
  codeIndex: number
): number {
  let offset = 0;
  let codeCount = 0;
  let i = 0;
  while (i < text.length && codeCount < codeIndex) {
    const cp = text.codePointAt(i) ?? 0;
    offset += cp > 0xffff ? 2 : 1;
    i += cp > 0xffff ? 2 : 1;
    codeCount++;
  }
  return offset;
}

/** Slice text by codepoint (not UTF-16 index) boundaries. */
export function codePointSlice(
  text: string,
  codeStart: number,
  codeEnd: number
): string {
  const u16Start = codePointToUtf16Offset(text, codeStart);
  const u16End = codePointToUtf16Offset(text, codeEnd);
  return text.slice(u16Start, u16End);
}
