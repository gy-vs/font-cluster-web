import type { FeatureState, FontMeta } from "../types";

interface FeaturePanelProps {
  font: FontMeta;
  states: FeatureState[] | null;
  pinned: Record<string, boolean>;
  onToggle: (tag: string, on: boolean) => void;
  onReset: () => void;
}

export function FeaturePanel({
  font,
  states,
  pinned,
  onToggle,
  onReset,
}: FeaturePanelProps) {
  const stateByTag = new Map((states ?? []).map((s) => [s.tag, s]));
  const resolved = (tag: string, fallbackDefault: boolean): boolean => {
    const pinnedValue = pinned[tag];
    if (pinnedValue !== undefined) return pinnedValue;
    return stateByTag.get(tag)?.on ?? fallbackDefault;
  };

  const applicable = font.features.filter(
    (f) => stateByTag.get(f.tag)?.applicable ?? false
  );
  const others = font.features.filter(
    (f) => !(stateByTag.get(f.tag)?.applicable ?? false)
  );

  const hasPins = Object.keys(pinned).length > 0;

  const renderItem = (feature: (typeof font.features)[number]) => {
    const state = stateByTag.get(feature.tag);
    const on = resolved(feature.tag, feature.defaultOn);
    const modified = pinned[feature.tag] !== undefined &&
      pinned[feature.tag] !== (state?.defaultOn ?? feature.defaultOn);
    return (
      <label
        key={feature.tag}
        className={`feature-item ${on ? "on" : "off"} ${modified ? "modified" : ""}`}
        title={`${feature.table} · 脚本 ${feature.scripts.join(", ") || "（无脚本记录）"}`}
      >
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => onToggle(feature.tag, e.target.checked)}
        />
        <code className="feature-tag">{feature.tag}</code>
        <span className="feature-label">{feature.label}</span>
        {feature.required && <span className="badge">必选</span>}
        {modified && <span className="badge pin-badge">已覆盖</span>}
      </label>
    );
  };

  return (
    <section className="panel feature-panel">
      <h2>
        排版特性
        {hasPins && (
          <button type="button" className="reset-features" onClick={onReset}>
            恢复默认
          </button>
        )}
      </h2>
      {font.features.length === 0 && (
        <div className="muted small">该字体不包含 GSUB/GPOS 排版特性。</div>
      )}
      {applicable.length > 0 && (
        <>
          <h3>对当前文本生效</h3>
          <div className="feature-list">{applicable.map(renderItem)}</div>
        </>
      )}
      {others.length > 0 && (
        <details>
          <summary>字体中存在、当前脚本不适用（{others.length}）</summary>
          <div className="feature-list">{others.map(renderItem)}</div>
        </details>
      )}
    </section>
  );
}
