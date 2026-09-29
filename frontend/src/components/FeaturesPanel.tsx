import type { AxisInfo, FontInfo } from '../types'
import { featureLabel } from '../features'

interface Props {
  font: FontInfo
  features: Record<string, boolean>
  variations: Record<string, number>
  onToggleFeature: (tag: string, value: boolean) => void
  onVariation: (tag: string, value: number) => void
}

function FeatureRows({
  title,
  tags,
  features,
  onToggle
}: {
  title: string
  tags: { tag: string; default_on: boolean; lookups: number }[]
  features: Record<string, boolean>
  onToggle: (tag: string, value: boolean) => void
}) {
  if (tags.length === 0) {
    return (
      <>
        <div className="feature-group">{title}</div>
        <div className="muted" style={{ padding: '4px 10px 8px' }}>该表不存在。</div>
      </>
    )
  }
  return (
    <>
      <div className="feature-group">{title}</div>
      {tags.map((f) => {
        const enabled = features[f.tag] ?? f.default_on
        return (
          <label className="feature-row" key={f.tag} title={f.tag}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => onToggle(f.tag, e.target.checked)}
            />
            <span className="tag">{f.tag}</span>
            <span className="desc">{featureLabel(f.tag)}</span>
            <span className="n">{f.lookups} 查找</span>
          </label>
        )
      })}
    </>
  )
}

function AxisRow({
  axis,
  value,
  onChange
}: {
  axis: AxisInfo
  value: number
  onChange: (v: number) => void
}) {
  const step = Math.max((axis.max - axis.min) / 1000, 0.01)
  return (
    <div className="axis-row">
      <div className="axis-head">
        <span>
          <strong>{axis.name}</strong>{' '}
          <span className="axis-val">{axis.tag}</span>
        </span>
        <span className="axis-val">{value.toFixed(step < 0.1 ? 2 : 0)}</span>
      </div>
      <input
        type="range"
        min={axis.min}
        max={axis.max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="muted">
        {axis.min} · 默认 {axis.default} · {axis.max}
      </div>
    </div>
  )
}

export default function FeaturesPanel({
  font,
  features,
  variations,
  onToggleFeature,
  onVariation
}: Props) {
  return (
    <div className="panel flex">
      <div className="panel-head">排版特性</div>
      <div className="panel-body">
        <p className="hint" style={{ marginTop: 0 }}>
          只列出字体中实际存在的 GSUB/GPOS 特性；勾选状态随每次排版请求发送给
          HarfBuzz。
        </p>
        <div className="feature-list">
          <FeatureRows
            title="GSUB · 替换"
            tags={font.features.GSUB}
            features={features}
            onToggle={onToggleFeature}
          />
          <FeatureRows
            title="GPOS · 定位"
            tags={font.features.GPOS}
            features={features}
            onToggle={onToggleFeature}
          />
        </div>

        {font.axes.length > 0 && (
          <>
            <div className="field" style={{ marginTop: 14 }}>
              <label>可变字体轴</label>
              {font.axes.map((a) => (
                <AxisRow
                  key={a.tag}
                  axis={a}
                  value={variations[a.tag] ?? a.default}
                  onChange={(v) => onVariation(a.tag, v)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
