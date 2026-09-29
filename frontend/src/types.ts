export interface FeatureInfo {
  tag: string
  default_on: boolean
  lookups: number
}

export interface AxisInfo {
  tag: string
  name: string
  min: number
  default: number
  max: number
}

export interface FontInfo {
  family: string
  subfamily: string
  full_name: string
  postscript_name: string | null
  version: string | null
  copyright: string | null
  kind: string
  upem: number
  glyph_count: number
  mapped_codepoints: number
  features: {
    GSUB: FeatureInfo[]
    GPOS: FeatureInfo[]
  }
  axes: AxisInfo[]
}

export interface UploadResponse {
  session_id: string
  filename: string
  font: FontInfo
}

export interface GlyphBBox extends Array<number> {
  0: number
  1: number
  2: number
  3: number
}

export interface Glyph {
  gid: number
  name: string
  start: number
  end: number
  x: number
  y: number
  x_advance: number
  y_advance: number
  bbox: [number, number, number, number] | null
  d: string
  line: number
}

export interface RunMeta {
  start: number
  end: number
  direction: 'ltr' | 'rtl' | 'ttb'
  level: number
  width: number
}

export interface ShapeLine {
  index: number
  text_start: number
  text_end: number
  baseline: number
  width: number
  runs: RunMeta[]
  glyphs: Glyph[]
}

export interface ShapeResult {
  upem: number
  font_size: number
  scale: number
  direction: 'auto' | 'ltr' | 'rtl' | 'ttb'
  ascender: number
  descender: number
  line_gap: number
  line_height: number
  width: number
  height: number
  text_length: number
  features_applied: Record<string, number | boolean>
  lines: ShapeLine[]
}

export interface ShapeRequestBody {
  session_id: string
  text: string
  direction: 'auto' | 'ltr' | 'rtl' | 'ttb'
  features: Record<string, boolean>
  variations: Record<string, number>
  font_size?: number
}

export type Direction = ShapeRequestBody['direction']

export interface TextSelection {
  start: number // code point offsets
  end: number
  origin: 'glyph' | 'text'
}
