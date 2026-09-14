import React from "react";
import { AlertTriangle, Pause, Play } from "lucide-react";
import CityMap from "./CityMap.jsx";

export default function CityPanel({ state, send }) {
  const warnings = state.blocks.filter((block) =>
    ["warning", "stabilizing"].includes(block.status),
  ).length;
  const online = state.blocks.filter(
    (block) => block.status !== "failed",
  ).length;
  return (
    <section className="city-panel panel">
      <div className="panel-heading">
        <h2>New Horizon</h2>
        <span>OVERHEAD VIEW · NIGHT</span>
      </div>
      <div className="city-topline">
        <span>
          <i className="map-key lit" />
          {online} blocks online
        </span>
        <span className={warnings ? "warning-text" : ""}>
          <AlertTriangle size={12} />
          {warnings} need power
        </span>
        <span className="map-scale">
          {state.blocks.length - online}/{state.stats.lossLimit || 27} BLACKOUTS
        </span>
      </div>
      <div className="mobile-grid-meters">
        <span>
          Reserve <b>{Math.round(state.storage)}%</b>
        </span>
        <span>
          Blackouts{" "}
          <b>
            {state.blocks.length - online} / {state.stats.lossLimit || 27}
          </b>
        </span>
      </div>
      <CityMap state={state} onSelect={(id) => send({ type: "select", id })} />
      <div className="city-legend">
        <span>
          <i className="map-key lit" />
          Powered
        </span>
        <span>
          <AlertTriangle size={12} />
          Alert · act now
        </span>
        <span>
          <i className="map-key dark" />
          Blackout · permanent
        </span>
        <span
          className="map-intensity-key"
          aria-label="Alert colors show required power"
        >
          <i className="alert-low">Low</i>
          <i className="alert-medium">Medium</i>
          <i className="alert-high">High</i>
        </span>
      </div>
      {state.phase === "countdown" && (
        <div className="city-overlay countdown-overlay">
          <span>CONTROL TRANSFER</span>
          <strong>{Math.ceil(state.countdown)}</strong>
          <p>Choose a block. Match its power mode.</p>
        </div>
      )}
      {state.phase === "paused" && (
        <div className="city-overlay">
          <Pause size={28} />
          <h2>Shift paused</h2>
          <p>The city is holding.</p>
          <button
            className="primary-button"
            onClick={() => send({ type: "pause" })}
          >
            <Play size={15} />
            Resume shift
          </button>
        </div>
      )}
    </section>
  );
}
