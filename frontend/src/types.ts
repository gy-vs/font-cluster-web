// Types mirroring the JSON produced by backend/app/sessions.py.

export interface FeatureInfo {
  tag: string;
  label: string;
  table: "GSUB" | "GPOS" | "GSUB/GPOS";
  scripts: string[];
  languages: Record<string, string[]>;
  required: boolean;
  defaultOn: boolean;
}

export interface FontNames {
  familyName?: string;
  subfamilyName?: string;
  fullName?: string;
  postScriptName?: string;
  typographicFamily?: string;
  typographicSubfamily?: string;
  copyright?: string;
  version?: string;
  designer?: string;
  licenseDescription?: string;
}

export interface VariationAxis {
  tag: string;
  name: string | null;
  min: number;
  max: number;
  default: number;
}

export interface FontMeta {
  names: FontNames;
  familyName: string;
  upem: number;
  numGlyphs: number;
  isFixedPitch: boolean;
  tables: string[];
  features: FeatureInfo[];
  hasGlyphOutlines: boolean;
  hasCffOutlines: boolean;
  flavor: string | null;
  sfntVersion: string;
  weightClass?: number;
  widthClass?: number;
  fsSelection?: number;
  variable: boolean;
  variationAxes?: VariationAxis[];
}

export interface FontSessionPayload {
  sessionId: string;
  filename: string;
  font: FontMeta;
  sample?: { key: string; license: string };
}

export interface SampleInfo {
  key: string;
  displayName: string;
  license: string;
  size: number;
}

export type Direction = "auto" | "ltr" | "rtl" | "ttb" | "btt";

export interface FeatureState {
  tag: string;
  on: boolean;
  defaultOn: boolean;
  applicable: boolean;
}

/** World-space rectangle [xMin, yMin, xMax, yMax], y-up font units. */
export type BBox = [number, number, number, number];

export interface GlyphRecord {
  index: number;
  gid: number;
  name: string;
  /** Python-string (Unicode codepoint) offsets into the input text. */
  clusterStart: number;
  clusterEnd: number;
  /** UTF-16 offsets, matching textarea selection indices. */
  utf16Start: number;
  utf16End: number;
  x: number;
  y: number;
  advanceX: number;
  advanceY: number;
  ink: BBox | null;
  slot: BBox;
}

export interface ShapeResult {
  sessionId: string;
  text: string;
  textLength: number;
  utf16Length: number;
  direction: string;
  requestedDirection: Direction;
  script: string;
  language: string;
  guessedDirection: string;
  guessedScript: string;
  guessedLanguage: string;
  upem: number;
  ascender: number;
  descender: number;
  lineGap: number;
  penX: number;
  penY: number;
  features: FeatureState[];
  glyphs: GlyphRecord[];
  outlines: Record<string, string>;
  worldBox: BBox;
  /** Screen-space SVG viewBox [x, y, width, height] (y already flipped). */
  viewBox: [number, number, number, number];
}
