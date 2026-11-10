import checkIcon from "../icons/check.svg";
import liveDot from "../icons/live-dot.svg";

export interface StepView {
  id: string;
  label: string;
  state: "done" | "current" | "future";
}

/** Stage tracker (Figma 3:23): finished = grey + check, current = dark + live dot, future = dashed. */
export function StageStepper({ steps, onPick }: { steps: StepView[]; onPick?: (id: string) => void }) {
  return (
    <nav className="stepper" aria-label="Stages" data-testid="stepper">
      {steps.map((s, i) => (
        <span key={s.id} style={{ display: "contents" }}>
          {i > 0 && <span className="stage-arrow">→</span>}
          <button
            type="button"
            className={`stage-pill stage-pill--${s.state}`}
            aria-current={s.state === "current" ? "step" : undefined}
            data-testid={`stage-${s.id}`}
            data-tip={s.state === "current" ? `Current stage: ${s.label}` : `Go to ${s.label}`}
            onClick={() => onPick?.(s.id)}
          >
            {s.state === "done" && <img src={checkIcon} width={12} height={12} alt="" />}
            {s.state === "current" && <img src={liveDot} width={6} height={6} alt="" />}
            {s.label}
          </button>
        </span>
      ))}
    </nav>
  );
}
