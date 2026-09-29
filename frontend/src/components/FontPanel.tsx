import { useRef } from 'react'
import type { FontInfo } from '../types'

interface Props {
  font: FontInfo | null
  filename: string | null
  loadingFont: boolean
  sampleLoading: boolean
  onFileSelected: (file: File) => void
  onLoadSample: () => void
  error: string | null
}

export default function FontPanel({
  font,
  filename,
  loadingFont,
  sampleLoading,
  onFileSelected,
  onLoadSample,
  error
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  return (
    <div className="panel flex">
      <div className="panel-head">字体</div>
      <div className="panel-body">
        <div className="row" style={{ marginBottom: 12 }}>
          <button
            type="button"
            className="primary"
            disabled={loadingFont}
            onClick={() => inputRef.current?.click()}
          >
            {loadingFont ? '上传中…' : '上传字体'}
          </button>
          <button
            type="button"
            disabled={sampleLoading || loadingFont}
            onClick={onLoadSample}
            title="载入随项目提供的 Amiri（OFL 授权），走与上传相同的接口"
          >
            {sampleLoading ? '样本载入中…' : '载入样本字体'}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".ttf,.otf,.ttc,.woff,.woff2,font/sfnt,font/otf,application/octet-stream"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onFileSelected(f)
              e.target.value = ''
            }}
          />
        </div>

        {error && (
          <div className="banner error" style={{ margin: 0, marginBottom: 12 }}>
            本次上传失败：{error}
            {font && <div className="hint" style={{ marginTop: 4 }}>下方仍是此前可用的检查会话。</div>}
          </div>
        )}

        {!font && !error && (
          <div className="drop-hint">
            尚未载入字体。
            <br />
            支持 OpenType（.otf/.ttf）、TrueType Collection、WOFF/WOFF2。
          </div>
        )}

        {font && (
          <>
            <div className="kv">
              <span className="k">字体族</span>
              <span className="v">{font.family}</span>
              <span className="k">字重/样式</span>
              <span className="v">{font.subfamily || '—'}</span>
              <span className="k">完整名称</span>
              <span className="v">{font.full_name}</span>
              {font.postscript_name && (
                <>
                  <span className="k">PostScript</span>
                  <span className="v">{font.postscript_name}</span>
                </>
              )}
              {font.version && (
                <>
                  <span className="k">版本</span>
                  <span className="v">{font.version}</span>
                </>
              )}
              <span className="k">格式</span>
              <span className="v">{font.kind}</span>
              <span className="k">字形数</span>
              <span className="v">{font.glyph_count}</span>
              <span className="k">映射码点</span>
              <span className="v">{font.mapped_codepoints}</span>
              <span className="k">units/em</span>
              <span className="v">{font.upem}</span>
              {filename && (
                <>
                  <span className="k">文件名</span>
                  <span className="v">{filename}</span>
                </>
              )}
            </div>
            {font.copyright && (
              <div className="muted" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>
                {font.copyright}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
