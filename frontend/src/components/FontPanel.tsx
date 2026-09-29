import { useRef } from "react";
import type { FontSessionPayload, SampleInfo } from "../types";

interface FontPanelProps {
  samples: SampleInfo[];
  session: FontSessionPayload | null;
  loadingFont: boolean;
  error: string | null;
  onUpload: (file: File) => void;
  onSample: (key: string) => void;
}

export function FontPanel({
  samples,
  session,
  loadingFont,
  error,
  onUpload,
  onSample,
}: FontPanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <section className="panel font-panel">
      <h2>字体</h2>
      <div className="upload-row">
        <input
          ref={inputRef}
          type="file"
          accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf"
          className="file-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = "";
          }}
        />
      </div>
      {samples.length > 0 && (
        <div className="samples-row">
          <span className="muted">样本：</span>
          {samples.map((sample) => (
            <button
              key={sample.key}
              type="button"
              className="sample-button"
              disabled={loadingFont}
              onClick={() => onSample(sample.key)}
              title={sample.license}
            >
              {sample.displayName}
            </button>
          ))}
          <span className="muted small">（与上传走同一条解析/排版路径，授权见 sample-fonts/LICENSE）</span>
        </div>
      )}
      {loadingFont && <div className="status loading">正在解析字体…</div>}
      {error && (
        <div className="status error" role="alert">
          本次上传失败：{error}
          {session && <div className="muted small">仍在使用此前打开的字体。</div>}
        </div>
      )}
      {session && <FontDetails session={session} />}
    </section>
  );
}

function FontDetails({ session }: { session: FontSessionPayload }) {
  const font = session.font;
  const names = font.names;
  return (
    <div className="font-details">
      <div className="font-headline">{font.familyName}</div>
      <div className="muted small">
        会话 {session.sessionId.slice(0, 8)}… · 原始文件名 {session.filename} ·
        仅当前会话可用
      </div>
      {session.sample && (
        <div className="sample-license muted small">📎 {session.sample.license}</div>
      )}
      <dl className="font-meta">
        <Meta label="PostScript 名" value={names.postScriptName} />
        <Meta label="字重 / 宽度" value={
          font.weightClass || font.widthClass
            ? `${font.weightClass ?? "?"} / ${font.widthClass ?? "?"}`
            : undefined
        } />
        <Meta label="unitsPerEm" value={String(font.upem)} />
        <Meta label="字形数量" value={String(font.numGlyphs)} />
        <Meta label="轮廓" value={
          font.hasCffOutlines ? "CFF/OTF" : font.hasGlyphOutlines ? "TrueType" : "—"
        } />
        <Meta label="等宽" value={font.isFixedPitch ? "是" : "否"} />
        <Meta label="版本" value={names.version} />
        <Meta label="设计方" value={names.designer} />
        <Meta label="可变字体" value={font.variable ? "是" : "否"} />
      </dl>
      {font.variable && font.variationAxes && (
        <div className="axes small">
          轴：{font.variationAxes.map((a) => a.name ?? a.tag).join("、")}
          <div className="muted">当前按默认实例排版</div>
        </div>
      )}
      <details>
        <summary>版权 / 许可（来自字体 name 表）</summary>
        <pre className="pre-wrap small">{names.licenseDescription ?? names.copyright ?? "（字体中未提供）"}</pre>
      </details>
      <details>
        <summary>OpenType 表（{font.tables.length}）</summary>
        <div className="tables small muted">{font.tables.join(" ")}</div>
      </details>
    </div>
  );
}

function Meta({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
