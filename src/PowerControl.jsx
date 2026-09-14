import React, { useEffect, useRef, useState } from "react";
import { Battery, Crosshair, ShieldCheck, AlertTriangle } from "lucide-react";
import { POWER_MODES, powerSatisfies, powerIsExcess } from "../shared/power.js";

const label = (mode) => mode.charAt(0).toUpperCase() + mode.slice(1);

export default function PowerControl({ state, send }) {
  const target =
    state.blocks.find((block) => block.id === state.selectedId) ||
    state.blocks[0];
  const [optimistic, setOptimistic] = useState(null);
  const mode = optimistic || state.powerMode || "low";
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const knob = useRef(null);
  const dragging = useRef(false);
  const feedback = useRef(null);
  const index = Math.max(0, POWER_MODES.indexOf(mode));
  const demand = target.powerMode || "low";
  const warning = ["warning", "stabilizing"].includes(target.status);
  const failed = target.status === "failed";
  const excessive = powerIsExcess(mode, demand);
  const practiceMatch = state.training?.step === "match";
  const sufficient = practiceMatch
    ? mode === (state.training.matchMode || demand)
    : powerSatisfies(mode, demand);
  const disabled =
    state.phase === "paused" ||
    state.phase === "results" ||
    state.startingRound;
  const dark = state.blocks.filter((block) => block.status === "failed").length;
  const limit = state.stats.lossLimit || Math.ceil(state.blocks.length * 0.75);

  function choose(next) {
    if (disabled || !POWER_MODES.includes(next) || next === modeRef.current)
      return;
    modeRef.current = next;
    setOptimistic(next);
    send({ type: "power", mode: next });
    clearTimeout(feedback.current);
    feedback.current = setTimeout(() => setOptimistic(null), 350);
  }
  useEffect(() => {
    if (state.powerMode === optimistic) setOptimistic(null);
  }, [state.powerMode, optimistic]);
  useEffect(() => {
    setOptimistic(null);
    dragging.current = false;
  }, [state.roundId, state.phase]);
  useEffect(() => () => clearTimeout(feedback.current), []);
  function turn(event) {
    if (!dragging.current || disabled) return;
    const box = knob.current.getBoundingClientRect();
    const dx = event.clientX - box.left - box.width / 2;
    const dy = event.clientY - box.top - box.height / 2;
    if (Math.hypot(dx, dy) < 18) return;
    const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
    choose(POWER_MODES[angle < -45 ? 0 : angle > 45 ? 2 : 1]);
  }
  function key(event) {
    let next = index;
    if (["ArrowRight", "ArrowUp"].includes(event.key))
      next = Math.min(2, index + 1);
    else if (["ArrowLeft", "ArrowDown"].includes(event.key))
      next = Math.max(0, index - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 2;
    else return;
    event.preventDefault();
    event.stopPropagation();
    choose(POWER_MODES[next]);
  }
  const status = failed
    ? "Permanently offline"
    : target.status === "stabilized"
      ? "Connection secured"
      : warning
        ? sufficient
          ? excessive
            ? "Stabilizing · excess output"
            : "Stabilizing connection"
          : practiceMatch
            ? "Choose " +
              label(state.training.matchMode || demand) +
              " to practice"
            : "More power needed"
        : excessive && state.phase === "playing"
          ? "Excess output"
          : "Connection stable";
  const hint = failed
    ? "This block cannot be recovered. Protect the remaining city."
    : state.training
      ? state.training.step === "release" || state.training.step === "complete"
        ? "Return the selector to Low. The connection will stay lit."
        : state.selectedId !== state.training.targetId
          ? "Select the highlighted block on the map."
          : "Choose " + label(demand) + " and hold it steady for a moment."
      : warning
        ? "Match " + label(demand) + " before the lights stop blinking."
        : mode !== "low"
          ? "Return to Low between calls to conserve the reserve."
          : "Watch for blinking lights, then select that block.";

  return (
    <aside className="control-column">
      <section className="power-panel panel">
        <div className="panel-heading">
          <h2>Power dispatch</h2>
          <span>MANUAL</span>
        </div>
        <div className="target-box">
          <div className="target-eyebrow">
            {target.critical ? (
              <ShieldCheck size={12} />
            ) : (
              <Crosshair size={12} />
            )}
            <span>
              {target.critical ? "SELECTED CRITICAL BLOCK" : "SELECTED BLOCK"}
            </span>
            <b>{target.district}</b>
          </div>
          <h3>{target.name}</h3>
          <div className="target-meta">
            <span>{target.priority} priority points</span>
            <span className={"mode-label " + demand}>
              {label(demand)} demand
            </span>
          </div>
        </div>
        <div className="intensity-heading">
          <span>POWER INTENSITY</span>
          <span>THREE POSITIONS</span>
        </div>
        <div className={"detent-assembly mode-" + mode}>
          <span className="knob-label knob-low">Low</span>
          <span className="knob-label knob-medium">Medium</span>
          <span className="knob-label knob-high">High</span>
          <div
            ref={knob}
            className="detent-knob"
            role="slider"
            aria-label="Power intensity"
            aria-valuemin={0}
            aria-valuemax={2}
            aria-valuenow={index}
            aria-valuetext={label(mode)}
            aria-disabled={Boolean(disabled)}
            tabIndex={disabled ? -1 : 0}
            onKeyDown={key}
            onPointerDown={(event) => {
              if (disabled) return;
              dragging.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              turn(event);
            }}
            onPointerMove={turn}
            onPointerUp={() => {
              dragging.current = false;
            }}
            onPointerCancel={() => {
              dragging.current = false;
            }}
          >
            <div
              className="knob-index"
              style={{ transform: "rotate(" + (index - 1) * 100 + "deg)" }}
            >
              <i />
            </div>
            <div className="knob-center">
              <strong>{label(mode)}</strong>
              <span>OUTPUT</span>
            </div>
          </div>
        </div>
        <div
          className="mode-selector"
          role="group"
          aria-label="Choose power mode"
        >
          {POWER_MODES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              className={mode === option ? "selected" : ""}
              disabled={disabled}
              onClick={() => choose(option)}
            >
              {label(option)}
            </button>
          ))}
        </div>
        <div
          className={
            "dispatch-status " +
            (failed ? "failed" : warning && !sufficient ? "warning" : "")
          }
          role="status"
        >
          <i />
          {status}
        </div>
        {target.status === "stabilizing" && (
          <div
            className="connection-progress"
            role="progressbar"
            aria-label="Connection stabilization"
            aria-valuenow={Math.round(target.stabilization * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <i style={{ transform: "scaleX(" + target.stabilization + ")" }} />
          </div>
        )}
        <p className="power-hint">{hint}</p>
        <div className="selector-shortcut">
          <kbd>Q</kbd>
          <kbd>E</kbd>
          <span>Step down / up</span>
        </div>
      </section>
      <section
        className={
          "reserve-panel panel " +
          (state.storage < 20 ? "storage-critical" : "")
        }
      >
        <div className="reserve-heading">
          <span>
            <Battery size={14} />
            Energy reserve
          </span>
          <strong>
            {Math.round(state.storage)}
            <small>%</small>
          </strong>
        </div>
        <div
          className="reserve-track"
          role="meter"
          aria-label="Energy reserve"
          aria-valuenow={Math.round(state.storage)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <i
            style={{
              transform: "scaleX(" + Math.max(0, state.storage / 100) + ")",
            }}
          />
        </div>
        <p>
          {state.storage > 35
            ? "Higher output consumes more reserve."
            : state.storage > 20
              ? "Reserve running low. Use only what you need."
              : "Critical reserve. The shift ends at zero."}
        </p>
      </section>
      <section
        className={
          "blackout-panel panel " +
          (dark >= limit * 0.65 ? "blackout-critical" : "")
        }
      >
        <div className="blackout-heading">
          <span>
            <AlertTriangle size={14} />
            Blackout limit
          </span>
          <strong>
            {dark}
            <small> / {limit}</small>
          </strong>
        </div>
        <div className="blackout-track" aria-hidden="true">
          {Array.from({ length: limit }, (_, i) => (
            <i key={i} className={i < dark ? "lost" : ""} />
          ))}
        </div>
        <p>
          <b>
            {Math.round((dark / state.blocks.length) * 100)}% of the city is
            dark.
          </b>{" "}
          Lose 75% and the shift ends. Failed blocks stay dark.
        </p>
      </section>
    </aside>
  );
}
