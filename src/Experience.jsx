import React from "react";
import {
  ArrowRight,
  Check,
  Crosshair,
  Gauge,
  Lightbulb,
  Play,
  Radio,
  ShieldCheck,
  Zap,
} from "lucide-react";
import "./experience.css";

const practiceSteps = [
  {
    id: "select",
    label: "Choose",
    title: "Find the marked block.",
    icon: Crosshair,
  },
  {
    id: "match",
    label: "Match",
    title: "Match the power mode.",
    icon: Gauge,
  },
  {
    id: "release",
    label: "Turn down",
    title: "Return to Low.",
    icon: Zap,
  },
];

export function PracticeGuide({ state, start, reset }) {
  const training = state.training;
  if (!training) return null;
  const complete = training.step === "complete";
  const online = state.hosting?.mode === "online";
  const index = complete
    ? 3
    : Math.max(
        0,
        practiceSteps.findIndex((step) => step.id === training.step),
      );
  const target = state.blocks.find((block) => block.id === training.targetId);
  const hints = {
    select: `Move the selection to the highlighted ${target?.name.toLowerCase() || "block"}. ${online ? "Use arrows or click it." : "Use arrows, the joystick, or click it."}`,
    match: `Choose ${training.matchMode || "medium"} using the knob, mode buttons, or Q / E. Hold it steady for one second.`,
    release:
      "The connection is secure. Choose Low to conserve energy between calls.",
    complete:
      "You’re ready. Prioritize the hospital, water pump, fire station, and school when they need power. Your scored shift starts with a full reserve.",
  };
  return (
    <section
      className={`practice-guide ${complete ? "practice-complete" : ""}`}
      aria-label="Guided practice"
    >
      <div className="practice-coach">
        <span className="experience-eyebrow">
          <span className="dot low" /> GUIDED PRACTICE{" "}
          <b>UNSCORED · TAKE YOUR TIME</b>
        </span>
        <h1>
          {complete ? "You’re ready for the city." : practiceSteps[index].title}
        </h1>
        <p aria-live="polite">{hints[training.step] || training.message}</p>
      </div>
      <div className="practice-right">
        <ol className="practice-steps" aria-label="Practice progress">
          {practiceSteps.map((step, i) => {
            const Icon = step.icon;
            return (
              <li
                key={step.id}
                className={
                  i < index ? "completed" : i === index ? "current" : ""
                }
                aria-current={i === index ? "step" : undefined}
              >
                <span>
                  {i < index ? <Check size={14} /> : <Icon size={14} />}
                </span>
                <b>{step.label}</b>
                {i < 2 && <i />}
              </li>
            );
          })}
        </ol>
        {complete ? (
          <button
            className="primary-button"
            onClick={start}
            disabled={state.startingRound}
          >
            Start scored shift
            <ArrowRight size={16} />
          </button>
        ) : (
          <button
            className="text-button practice-skip"
            onClick={start}
            disabled={state.startingRound}
          >
            Skip practice
            <ArrowRight size={13} />
          </button>
        )}
        {complete && (
          <span className="practice-button-hint">
            {online ? "or press Space" : "or press Space / the joystick button"}
          </span>
        )}
      </div>
      <button
        className="practice-exit"
        onClick={reset}
        aria-label="Exit practice"
      >
        Exit
      </button>
    </section>
  );
}

export function DemoGuide({ state, wake }) {
  return (
    <section className="demo-guide" aria-label="Automatic demonstration">
      <div className="demo-copy">
        <span className="experience-eyebrow">
          <Radio size={13} /> AUTOMATIC DEMONSTRATION{" "}
          <b>NO PLAYER · NO SCORE</b>
        </span>
        <h1>
          Night operations. <span>Demonstration.</span>
        </h1>
        <p>
          {state.demo?.message ||
            "Choose a building. Match its power. Keep the essential services alive."}
        </p>
      </div>
      <div className="demo-action">
        <button className="primary-button" onClick={wake}>
          <Play size={15} fill="currentColor" />
          Take the controls
          <ArrowRight size={16} />
        </button>
        <span>Any key, click, or controller movement to begin</span>
      </div>
    </section>
  );
}

const oneDecimal = (value) =>
  Number.isFinite(value) ? value.toFixed(1) : "0.0";

export function DecisionReport({ report }) {
  if (!report) return null;
  const lost = report.criticalLost || [];
  return (
    <section className="decision-report" aria-label="Decision report">
      <div className="decision-title">
        <span>
          <Lightbulb size={13} />
          YOUR DECISIONS
        </span>
        <small>FOR YOUR NEXT SHIFT</small>
      </div>
      <div className="decision-metrics">
        <div>
          <b
            className={
              report.energyWasted > 5 ? "warning-text" : "success-text"
            }
          >
            {oneDecimal(report.energyWasted)}
            <small> pts</small>
          </b>
          <span>RESERVE WASTED</span>
        </div>
        <div>
          <b>
            {lost.length}
            <small> / 4</small>
          </b>
          <span>CRITICAL SERVICES LOST</span>
        </div>
        <div>
          <b>
            {oneDecimal(report.idleOutputEnergy)}
            <small> pts</small>
          </b>
          <span>OUTPUT BETWEEN RESCUES</span>
        </div>
      </div>
      <p className="lost-services">
        <ShieldCheck size={12} />
        {lost.length
          ? lost.map((block) => block.name || block).join(" · ")
          : "Every critical service stayed online."}
      </p>
      {report.tip && (
        <div className="decision-tip">
          <Lightbulb size={16} />
          <div>
            <strong>{report.tip.title}</strong>
            <p>{report.tip.text}</p>
          </div>
        </div>
      )}
      <details className="energy-breakdown">
        <summary>Where did the energy go?</summary>
        <p>
          One reserve point equals 1% of a full storage bar. Waste is the extra
          cost of using a higher mode than the block requires; output between
          rescues is shown separately.
        </p>
        <dl>
          {[
            [
              "City demand",
              report.normalDemand ?? report.breakdown?.normalDemand,
            ],
            [
              "Output delivery",
              report.outputDelivery ?? report.breakdown?.outputDelivery,
            ],
            ["Excess-power waste", report.energyWasted],
            [
              "Stabilizing connections",
              report.rescueEnergy ?? report.breakdown?.rescueEnergy,
            ],
            ["Total reserve used", report.energyUsed],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{oneDecimal(value)} pts</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
