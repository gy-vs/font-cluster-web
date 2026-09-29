import type { Direction, ShapeResult } from "../types";

interface TextPanelProps {
  text: string;
  onTextChange: (value: string) => void;
  direction: Direction;
  onDirectionChange: (value: Direction) => void;
  result: ShapeResult | null;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  onSelect: (u16Start: number, u16End: number) => void;
  onCopyReport: () => void;
  copyState: "idle" | "ok" | "fail";
}

const DIRECTIONS: { value: Direction; label: string }[] = [
  { value: "auto", label: "自动" },
  { value: "ltr", label: "从左到右 LTR" },
  { value: "rtl", label: "从右到左 RTL" },
  { value: "ttb", label: "从上到下 TTB" },
  { value: "btt", label: "从下到上 BTT" },
];

export function TextPanel({
  text,
  onTextChange,
  direction,
  onDirectionChange,
  result,
  textareaRef,
  onSelect,
  onCopyReport,
  copyState,
}: TextPanelProps) {
  const syncSelection = () => {
    const el = textareaRef.current;
    if (!el) return;
    onSelect(el.selectionStart ?? 0, el.selectionEnd ?? 0);
  };

  return (
    <section className="panel text-panel">
      <h2>输入文本</h2>
      <textarea
        ref={textareaRef}
        className="text-input"
        value={text}
        rows={4}
        spellCheck={false}
        placeholder="输入要检查的文本，可粘贴多语种、连字或表情符号…"
        onChange={(e) => onTextChange(e.target.value)}
        onSelect={syncSelection}
        onKeyUp={syncSelection}
        onMouseUp={syncSelection}
      />
      <div className="text-controls">
        <label className="direction-select">
          排版方向
          <select
            value={direction}
            onChange={(e) => onDirectionChange(e.target.value as Direction)}
          >
            {DIRECTIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        {result && (
          <span className="muted small">
            实际：{result.direction} · 脚本 {result.script} · 语言{" "}
            {result.language}
            {result.requestedDirection === "auto" &&
              result.guessedDirection !== result.direction &&
              `（检测为 ${result.guessedDirection}）`}
          </span>
        )}
        <span className="canvas-spacer" />
        <button type="button" onClick={onCopyReport} disabled={!result}>
          {copyState === "ok"
            ? "已复制排版结果"
            : copyState === "fail"
            ? "复制失败"
            : "复制当前排版结果"}
        </button>
      </div>
    </section>
  );
}
