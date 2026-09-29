/**
 * Text offsets everywhere in this app count *code points* (matching the
 * HarfBuzz cluster indices returned by the server), while a <textarea> works
 * with UTF-16 code unit offsets.
 */

export function utf16ToCodePointOffset(text: string, utf16Offset: number): number {
  let codePoints = 0
  let units = 0
  for (const ch of text) {
    if (units >= utf16Offset) break
    units += ch.length
    codePoints += 1
  }
  return codePoints
}

export function codePointToUtf16Offset(text: string, cpOffset: number): number {
  let units = 0
  let i = 0
  for (const ch of text) {
    if (i >= cpOffset) break
    units += ch.length
    i += 1
  }
  return units
}

export function codePointLength(text: string): number {
  return Array.from(text).length
}

export function codePointSlice(text: string, cpStart: number, cpEnd: number): string {
  return Array.from(text).slice(cpStart, cpEnd).join('')
}

export function codepointLabel(ch: string): string {
  const cp = ch.codePointAt(0)!
  return 'U+' + cp.toString(16).toUpperCase().padStart(4, '0')
}
