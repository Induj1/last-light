import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Battery,
  CircleHelp,
  Clock3,
  Crosshair,
  Gauge,
  Keyboard,
  Maximize,
  Pause,
  Play,
  Power,
  Radio,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Trophy,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import { createBlocks } from "../shared/blocks.js";
import City from "./CityPanel.jsx";
import Controls from "./PowerControl.jsx";
import { useGame, useAudio } from "./useGame.js";
import Organizer from "./Organizer.jsx";
import HostedLogin from "./HostedLogin.jsx";
import { PracticeGuide, DemoGuide, DecisionReport } from "./Experience.jsx";

const standby = {
  phase: "ready",
  remaining: 60,
  elapsed: 0,
  storage: 100,
  power: 35,
  powerMode: "low",
  selectedId: "hospital",
  cursor: { x: 2, y: 2 },
  blocks: createBlocks(),
  score: {
    priority: 0,
    criticalBonus: 0,
    efficiency: 0,
    survival: 0,
    total: 0,
  },
  stats: {
    saved: 0,
    criticalSaved: 0,
    criticalLost: 0,
    online: 36,
    failed: 0,
    lossLimit: 27,
    warnings: 0,
    gridLoad: 0,
  },
  difficulty: "normal",
  caption: null,
  events: [],
  connection: { mode: "keyboard", connected: false },
};
const names = {
  ready: "SYSTEM READY",
  countdown: "INITIALIZING",
  playing: "SHIFT IN PROGRESS",
  paused: "SHIFT PAUSED",
  results: "SHIFT COMPLETE",
  practice: "GUIDED PRACTICE",
  demo: "AUTOMATIC DEMONSTRATION",
};
const percent = (value) => Math.round(value || 0);
const clock = (value) =>
  `${Math.floor(Math.ceil(value) / 60)
    .toString()
    .padStart(2, "0")}:${(Math.ceil(value) % 60).toString().padStart(2, "0")}`;
const format = (value) => Math.round(value || 0).toLocaleString("en-US");

function Key({ children }) {
  return <kbd>{children}</kbd>;
}

function Dialog({ title, children, onClose, className = "" }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    function key(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab") {
        const nodes = ref.current?.querySelectorAll(
          'button:not(:disabled), input, select, a[href], [tabindex="0"]',
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className={`dialog ${className}`}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex="-1"
      >
        <button
          className="icon-button close-dialog"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={19} />
        </button>
        {children}
      </section>
    </div>
  );
}

function Tutorial({ start, close, isStart, duration = 60, online = false }) {
  return (
    <Dialog title="How to play" onClose={close} className="tutorial-dialog">
      <div className="section-eyebrow">
        <Zap size={15} /> OPERATOR BRIEFING
      </div>
      <h2>
        {duration} seconds.
        <br />
        One city. <span>Make it count.</span>
      </h2>
      <p className="dialog-intro">
        Keep the city lit for the full shift. Select a blinking block and match
        its demand before the connection fails.
      </p>
      <div className="tutorial-steps">
        <div>
          <span className="step-art">
            <Crosshair size={30} />
          </span>
          <span className="step-no">01</span>
          <h3>Target high-priority buildings</h3>
          <p>
            Save the hospital, water pump, fire station, and school first when
            they need power. Higher-priority buildings earn more points.{" "}
            {online
              ? "Use arrows, WASD, or click a highlighted block."
              : "Use the joystick, arrows, or click a highlighted block."}
          </p>
        </div>
        <div>
          <span className="step-art">
            <Gauge size={30} />
          </span>
          <span className="step-no">02</span>
          <h3>Match the power</h3>
          <p>
            {online
              ? "Choose Low, Medium, or High with the knob, buttons, or Q / E. Hold the matching mode briefly to stabilize."
              : "Turn the knob or use Q / E to choose Low, Medium, or High. Hold the matching mode briefly to stabilize."}
          </p>
        </div>
        <div>
          <span className="step-art">
            <ShieldCheck size={30} />
          </span>
          <span className="step-no">03</span>
          <h3>Prevent permanent blackouts</h3>
          <p>
            Lights blink four times before going dark for good. Losing 27 of 36
            blocks (75%) ends the game.
          </p>
        </div>
      </div>
      <div className="tutorial-legend">
        <span>
          <AlertTriangle size={16} className="alert-low" /> LOW
        </span>
        <span>
          <AlertTriangle size={16} className="alert-medium" /> MEDIUM
        </span>
        <span>
          <AlertTriangle size={16} className="alert-high" /> HIGH
        </span>
      </div>
      <p className="tutorial-legend-note">
        The alert color shows the required power mode. Check priority points in
        the dispatch panel when choosing what to save.
      </p>
      <div className="dialog-bottom">
        <span>
          <Battery size={17} /> The shift also ends if the reserve reaches zero.
        </span>
        <button className="primary-button" onClick={isStart ? start : close}>
          {isStart ? "Try the controls" : "Got it"}
          <ArrowRight size={18} />
        </button>
      </div>
    </Dialog>
  );
}

function Leaderboard({ entries, close, online = false }) {
  return (
    <Dialog title="Leaderboard" onClose={close} className="leaderboard-dialog">
      <div className="section-eyebrow">
        <Trophy size={16} /> OPERATOR RECORDS
      </div>
      <h2>Leaderboard</h2>
      <p className="dialog-intro">
        {online
          ? "Critical services first. Efficiency always. The top ten shifts from the shared public event."
          : "Critical services first. Efficiency always. The top ten shifts, saved on this laptop."}
      </p>
      {entries.length ? (
        <div className="leaderboard-table">
          <div className="leaderboard-row table-header">
            <span>RANK</span>
            <span>OPERATOR</span>
            <span>STORAGE</span>
            <span>SCORE</span>
          </div>
          {entries.slice(0, 10).map((e, i) => (
            <div
              className={`leaderboard-row ${i === 0 ? "rank-first" : ""}`}
              key={e.id || e.roundId}
            >
              <span className="rank">
                {i === 0 ? <Trophy size={18} /> : `${i + 1}`.padStart(2, "0")}
              </span>
              <span className="player-name">
                {e.name}
                <small>
                  {e.criticalSaved} critical saved ·{" "}
                  {Math.round(e.survivalTime)}s survived
                </small>
              </span>
              <span>{percent(e.storageRemaining)}%</span>
              <strong>{format(e.finalScore)}</strong>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <Trophy size={40} />
          <h3>No completed shifts yet.</h3>
          <p>Complete a shift and enter your name to claim a place.</p>
        </div>
      )}
      <div className="dialog-bottom">
        <span>
          {online
            ? "Shared public leaderboard · ranked by final score"
            : "Ranked by final score · stored offline"}
        </span>
        <button className="secondary-button" onClick={close}>
          Back to control room
          <ArrowRight size={16} />
        </button>
      </div>
    </Dialog>
  );
}

function Results({ state, send, onSaved, close, submitResult }) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const result = state.result || {};
  const score = result.score || state.score;
  const stats = result.stats || state.stats;
  const survived =
    result.survived ??
    (state.storage > 0 && stats.online > state.blocks.length * 0.25);
  const finalStorage = result.storage ?? state.storage;
  const critical = state.blocks.filter((b) => b.critical);
  const online = state.hosting?.mode === "online";
  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setStatus("");
    try {
      const data = await submitResult(name.trim(), state.roundId);
      onSaved(data.leaderboard);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      title="Shift results"
      onClose={close}
      className={`results-dialog ${result.decisionReport ? "has-decision-report" : ""}`}
    >
      <div className={`result-symbol ${survived ? "" : "collapsed"}`}>
        {survived ? <Zap size={34} /> : <Power size={34} />}
      </div>
      <div className="section-eyebrow">
        {result.practice ? "PRACTICE SHIFT" : "SHIFT REPORT"} ·{" "}
        {Math.round(result.survivalTime ?? state.elapsed)} SECONDS
      </div>
      <h2>
        {survived ? (
          <>
            City <span>survived.</span>
          </>
        ) : (
          <>
            Grid <span className="danger-text">collapsed.</span>
          </>
        )}
      </h2>
      <p className="dialog-intro">
        {survived
          ? "The shift is complete. The remaining city is still connected."
          : result.endReason === "city_blackout"
            ? "27 of 36 blocks lost power. The city reached its 75% blackout limit."
            : "The energy reserve is empty. The shift has ended."}
      </p>
      <div className="critical-outcomes">
        {critical.map((b) => (
          <div key={b.id}>
            <ShieldCheck size={20} />
            <span>{b.name}</span>
            <b
              className={b.status === "failed" ? "danger-text" : "success-text"}
            >
              {b.status === "failed" ? "OFFLINE" : "ONLINE"}
            </b>
          </div>
        ))}
      </div>
      <div className="result-numbers">
        <div>
          <small>PRIORITY + CRITICAL</small>
          <strong>{format(score.priority + score.criticalBonus)}</strong>
        </div>
        <span>+</span>
        <div>
          <small>EFFICIENCY</small>
          <strong>{format(score.efficiency)}</strong>
        </div>
        <span>+</span>
        <div>
          <small>SURVIVAL</small>
          <strong>{format(score.survival)}</strong>
        </div>
        <span>=</span>
        <div className="final-score">
          <small>FINAL SCORE</small>
          <strong>{format(score.total)}</strong>
        </div>
      </div>
      <div className="result-details">
        <span>
          <ShieldCheck size={15} />
          {stats.saved} building{stats.saved === 1 ? "" : "s"} rescued
        </span>
        <span>
          <Battery size={15} />
          {percent(finalStorage)}% storage remaining
        </span>
      </div>
      <DecisionReport report={result.decisionReport} />
      <blockquote>
        {result.reactions?.[0]?.text ||
          (typeof result.reactions?.[0] === "string"
            ? result.reactions[0]
            : state.caption?.text) ||
          "When energy is limited, every decision has a cost."}
      </blockquote>
      {!result.practice ? (
        <form className="name-form" onSubmit={save}>
          <label htmlFor="player-name">
            {online ? "CHOOSE A PUBLIC DISPLAY NAME" : "OPERATOR NAME"}
          </label>
          <div>
            <input
              id="player-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              minLength={1}
              required
              placeholder={online ? "Your nickname" : "Your name"}
              autoComplete="off"
            />
            <button
              className="primary-button"
              disabled={!name.trim() || saving}
              type="submit"
            >
              {saving ? "Saving…" : online ? "Publish score" : "Save score"}
              <ArrowRight size={16} />
            </button>
          </div>
          {online && (
            <p className="hosted-public-note">
              Use a nickname. Top scores and their display names are public on
              this event’s shared leaderboard.
            </p>
          )}
          {status && (
            <p role="alert" className="danger-text">
              {status}
            </p>
          )}
        </form>
      ) : (
        <p className="practice-note">
          Organizer controls were used. This practice shift won’t enter the
          leaderboard.
        </p>
      )}
      <div className="result-foot">
        <span>
          Next operator in {Math.ceil(state.autoResetRemaining || 0)}s
        </span>
        <button
          className="text-button"
          onClick={() => {
            send({ type: "reset" });
            close();
          }}
        >
          New shift
          <RotateCcw size={14} />
        </button>
      </div>
    </Dialog>
  );
}

export default function App() {
  const {
    state: received,
    connected,
    leaderboard,
    setLeaderboard,
    send,
    error,
    clearError,
    hosting,
    applySession,
    sessionReady,
    submitResult,
    refreshSession,
  } = useGame();
  const state = received || standby;
  const currentHosting = state.hosting || hosting;
  const online = currentHosting?.mode === "online";
  const canOrganize =
    sessionReady && (!online || Boolean(currentHosting?.admin));
  const hostingRef = useRef(currentHosting);
  hostingRef.current = currentHosting;
  const sessionReadyRef = useRef(sessionReady);
  sessionReadyRef.current = sessionReady;
  const [modal, setModal] = useState(null);
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem("lastlight-muted") === "true";
    } catch {
      return false;
    }
  });
  const [resultDismissed, setResultDismissed] = useState(null);
  const resultBoard = useRef(false);
  const previousPhase = useRef(state.phase);
  const [fps, setFps] = useState(0);
  const { unlock, play } = useAudio(state, !muted && state.phase !== "demo");
  const held = useRef(new Set());
  const [fullscreen, setFullscreen] = useState(false);
  const modalRef = useRef(modal);
  modalRef.current = modal;
  const stateRef = useRef(state);
  stateRef.current = state;
  const ready = state.phase === "ready",
    playing = state.phase === "playing";
  const practicing = Boolean(state.training);
  const demonstrating = state.phase === "demo";
  const close = useCallback(() => {
    resultBoard.current = false;
    setModal(null);
  }, []);
  const closeResult = useCallback(
    () => setResultDismissed(stateRef.current.roundId),
    [],
  );
  function start(skip = false) {
    unlock();
    let taught = false;
    try {
      taught = localStorage.getItem("lastlight-briefed") === "true";
    } catch {}
    if (!skip && !taught) {
      setModal("start");
      return;
    }
    try {
      localStorage.setItem("lastlight-briefed", "true");
    } catch {}
    setModal(null);
    send({ type: "practice" });
  }
  function beginScored() {
    unlock();
    held.current.clear();
    setModal(null);
    send({ type: "start" });
  }
  function openModal(value) {
    if (value === "organizer" && !sessionReadyRef.current) return;
    if (["playing", "countdown", "practice"].includes(state.phase))
      send({ type: "pause" });
    held.current.clear();
    send({ type: "input", x: 0, y: 0, powerDelta: 0 });
    setModal(
      value === "organizer" &&
        hostingRef.current?.mode === "online" &&
        !hostingRef.current?.admin
        ? "admin-login"
        : value,
    );
  }
  useEffect(() => {
    if (!online) return;
    if (!canOrganize && modal === "organizer") setModal("admin-login");
    else if (canOrganize && modal === "admin-login") setModal("organizer");
  }, [online, canOrganize, modal]);
  useEffect(() => {
    if (
      (resultBoard.current && state.phase === "ready") ||
      (["playing", "countdown", "practice", "demo"].includes(state.phase) &&
        ["ready", "results", "paused", "practice"].includes(
          previousPhase.current,
        ))
    ) {
      setModal(null);
      resultBoard.current = false;
    }
    previousPhase.current = state.phase;
  }, [state.phase]);
  useEffect(() => {
    let lastActivity = 0;
    const wakingKeys = new Set();
    const wakingPointers = new Set();
    let consumeClick = false;
    function consume(e) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    function activity(e) {
      const now = performance.now();
      const phase = stateRef.current.phase;
      if (e.type === "keydown" || e.type === "pointerdown") unlock();
      if (e.type === "keydown" && wakingKeys.has(e.code)) {
        consume(e);
        return;
      }
      if (e.type === "keyup" && wakingKeys.delete(e.code)) {
        consume(e);
        return;
      }
      if (
        ["pointerup", "pointercancel"].includes(e.type) &&
        wakingPointers.delete(e.pointerId)
      ) {
        consume(e);
        return;
      }
      if (e.type === "click" && consumeClick) {
        consumeClick = false;
        consume(e);
        return;
      }
      if (e.type === "keydown" || e.type === "pointerdown")
        consumeClick = false;
      if (phase === "demo") {
        if (e.type === "pointermove") return;
        consume(e);
        if (
          e.type === "keyup" ||
          e.type === "pointerup" ||
          e.type === "pointercancel"
        )
          return;
        if (e.type === "keydown") {
          wakingKeys.add(e.code);
          consumeClick = e.key === " " || e.key === "Enter";
        }
        if (e.type === "pointerdown") {
          wakingPointers.add(e.pointerId);
          consumeClick = true;
        }
        held.current.clear();
        send({ type: "wake" });
        return;
      }
      if (now - lastActivity > 2000) {
        lastActivity = now;
        send({ type: "activity" });
      }
    }
    const types = [
      "pointerdown",
      "pointerup",
      "pointercancel",
      "click",
      "keydown",
      "keyup",
      "pointermove",
      "wheel",
    ];
    types.forEach((type) =>
      window.addEventListener(type, activity, {
        capture: true,
        passive: false,
      }),
    );
    function clearWake() {
      wakingKeys.clear();
      wakingPointers.clear();
      consumeClick = false;
    }
    window.addEventListener("blur", clearWake);
    const timer = setInterval(() => {
      if (modalRef.current && stateRef.current.phase !== "demo")
        send({ type: "activity" });
    }, 5000);
    return () => {
      types.forEach((type) => window.removeEventListener(type, activity, true));
      window.removeEventListener("blur", clearWake);
      clearInterval(timer);
    };
  }, [send, unlock]);
  useEffect(() => {
    const pressedAt = new Map();
    const releases = new Map();
    function dispatchInput() {
      const keys = held.current;
      send({
        type: "input",
        x:
          Number(keys.has("arrowright") || keys.has("d")) -
          Number(keys.has("arrowleft") || keys.has("a")),
        y:
          Number(keys.has("arrowdown") || keys.has("s")) -
          Number(keys.has("arrowup") || keys.has("w")),
        powerDelta: Number(keys.has("e")) - Number(keys.has("q")),
        stabilize: keys.has(" "),
      });
    }
    function keydown(e) {
      if (
        e.key.toLowerCase() !== "f2" &&
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName))
      )
        return;
      const key = e.key.toLowerCase();
      if (
        key === " " &&
        e.target instanceof HTMLElement &&
        e.target.closest("button") &&
        !e.target.closest(".city-map-hit")
      )
        return;
      if (key === "f2") {
        e.preventDefault();
        if (e.repeat) return;
        if (!sessionReadyRef.current) return;
        if (
          ["playing", "countdown", "practice"].includes(stateRef.current.phase)
        )
          send({ type: "pause" });
        held.current.clear();
        send({ type: "input", x: 0, y: 0, powerDelta: 0, stabilize: false });
        const next =
          hostingRef.current?.mode === "online" && !hostingRef.current?.admin
            ? "admin-login"
            : "organizer";
        setModal((v) =>
          ["organizer", "admin-login"].includes(v) ? null : next,
        );
        return;
      }
      if (modalRef.current) return;
      if (
        [
          "arrowup",
          "arrowdown",
          "arrowleft",
          "arrowright",
          "w",
          "a",
          "s",
          "d",
          "q",
          "e",
          " ",
        ].includes(key)
      ) {
        e.preventDefault();
        clearTimeout(releases.get(key));
        releases.delete(key);
        if (!held.current.has(key)) pressedAt.set(key, performance.now());
        held.current.add(key);
        dispatchInput();
        unlock();
      }
      if (e.repeat) return;
      if (key === "r") send({ type: "reset" });
      if (key === "p") send({ type: "pause" });
      if (key === " " && ["ready", "results"].includes(stateRef.current.phase))
        start();
      if (
        key === " " &&
        stateRef.current.phase === "practice" &&
        stateRef.current.training?.step === "complete"
      )
        beginScored();
      if (
        stateRef.current.debug &&
        (hostingRef.current?.mode !== "online" || hostingRef.current?.admin)
      ) {
        const commands = { f: "fail", n: "npc", b: "warn" };
        if (commands[key]) send({ type: "debug", action: commands[key] });
        if (key === "[" || key === "]")
          send({
            type: "debug",
            action: "storage",
            value: Math.max(
              0,
              Math.min(
                100,
                stateRef.current.storage + (key === "]" ? 10 : -10),
              ),
            ),
          });
      }
    }
    function keyup(e) {
      const key = e.key.toLowerCase();
      if (!held.current.has(key)) return;
      const minimum = ["q", "e", " "].includes(key) ? 80 : 180;
      const delay = Math.max(
        0,
        minimum - (performance.now() - (pressedAt.get(key) || 0)),
      );
      releases.set(
        key,
        setTimeout(() => {
          held.current.delete(key);
          pressedAt.delete(key);
          releases.delete(key);
          dispatchInput();
        }, delay),
      );
    }
    function clear() {
      for (const timer of releases.values()) clearTimeout(timer);
      releases.clear();
      pressedAt.clear();
      held.current.clear();
      send({ type: "input", x: 0, y: 0, powerDelta: 0, stabilize: false });
    }
    const timer = setInterval(() => {
      const keys = held.current;
      if (!keys.size) return;
      dispatchInput();
    }, 40);
    const up = (e) => {
      keyup(e);
      if (!held.current.size) clear();
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      clear();
      clearInterval(timer);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
    };
  }, [send, unlock]);
  useEffect(() => {
    let frames = 0,
      last = performance.now(),
      raf;
    function frame(t) {
      frames++;
      if (t - last > 1000) {
        setFps(Math.round((frames * 1000) / (t - last)));
        frames = 0;
        last = t;
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    const change = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);
  const caption = state.caption || {
    npcId: "operator",
    name: "GRID OPERATOR",
    role: "CONTROL ROOM",
    text: ready
      ? "A city full of lives. One limited reserve. Let’s keep the lights on."
      : "Every building is someone’s everyday. Choose your next move carefully.",
  };
  const criticalCount = state.blocks.filter(
    (b) => b.critical && b.status !== "failed",
  ).length;
  const connection = state.connection || standby.connection;
  return (
    <div
      className={`app ${!ready ? "in-round" : ""} ${practicing ? "practice-mode" : ""} ${demonstrating ? "demo-mode" : ""} ${state.remaining <= 10 && playing ? "final-phase" : ""}`}
    >
      <header className="site-header">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            if (modal) close();
          }}
          aria-label="Last Light home"
        >
          <span className="brand-symbol">
            <Zap size={25} fill="currentColor" strokeWidth={1.5} />
          </span>
          <span>
            LAST LIGHT<small>MUNICIPAL GRID CONTROL</small>
          </span>
        </a>
        <div className="header-divider" />
        <span
          className="exhibition-label event-caption"
          title={state.event?.name}
        >
          {state.event?.name || "ENGINEERS’ DAY"}
          <span>NIGHT OPERATIONS</span>
        </span>
        <nav>
          <button className={!modal ? "active" : ""} onClick={close}>
            Control room
          </button>
          <button
            className={modal === "leaderboard" ? "active" : ""}
            onClick={() => openModal("leaderboard")}
          >
            Leaderboard
            <ArrowUpRight size={13} />
          </button>
        </nav>
        <div className="header-actions">
          <span
            className={`connection-pill ${connected ? "" : "is-disconnected"}`}
          >
            <i />
            {connected
              ? online
                ? "ONLINE PLAY"
                : connection.mode === "hardware"
                  ? "CONTROLLER ONLINE"
                  : "LOCAL ENGINE"
              : "CONNECTING"}
          </span>
          <button
            className="icon-button"
            aria-label={muted ? "Unmute audio" : "Mute audio"}
            title={muted ? "Unmute audio" : "Mute audio"}
            onClick={() => {
              unlock();
              setMuted((v) => {
                try {
                  localStorage.setItem("lastlight-muted", String(!v));
                } catch {}
                return !v;
              });
              if (muted) play("save");
            }}
          >
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <button
            className="icon-button"
            aria-label={
              canOrganize ? "Organizer settings" : "Organizer sign in"
            }
            title={
              canOrganize ? "Organizer settings · F2" : "Organizer sign in · F2"
            }
            disabled={!sessionReady}
            onClick={() => openModal("organizer")}
          >
            <Settings2 size={18} />
          </button>
        </div>
      </header>
      <main className="main-shell">
        {practicing ? (
          <PracticeGuide
            state={state}
            start={beginScored}
            reset={() => send({ type: "reset" })}
          />
        ) : demonstrating ? (
          <DemoGuide state={state} wake={() => send({ type: "wake" })} />
        ) : (
          <section className="intro">
            <div>
              <div className="section-eyebrow">
                <span className="mini-line" /> OPERATIONS / NIGHT SHIFT
              </div>
              <h1>Keep the city connected.</h1>
              <p>
                {state.roundDuration || 60} seconds. One reserve. Every blackout
                is permanent.
              </p>
            </div>
            <div className="intro-actions">
              <button
                className="text-button"
                onClick={() => openModal("tutorial")}
              >
                <CircleHelp size={16} />
                How to play
              </button>
              {ready || state.phase === "results" ? (
                <button
                  className="primary-button start-button"
                  disabled={!connected || state.startingRound}
                  onClick={() => start()}
                >
                  <Play size={16} fill="currentColor" />
                  Begin shift
                  <ArrowRight size={18} />
                </button>
              ) : (
                <>
                  <button
                    className="icon-button reset-button"
                    aria-label="Reset round"
                    title="Reset round · R"
                    onClick={() => send({ type: "reset" })}
                  >
                    <RotateCcw size={18} />
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => send({ type: "pause" })}
                    disabled={state.phase === "countdown"}
                  >
                    {state.phase === "paused" ? (
                      <Play size={16} />
                    ) : (
                      <Pause size={16} />
                    )}{" "}
                    {state.phase === "paused" ? "Resume shift" : "Pause shift"}
                  </button>
                </>
              )}
            </div>
          </section>
        )}
        {state.startingRound && (
          <div role="status" className="connection-alert">
            Preparing your scored shift…
          </div>
        )}
        {!connected && received && (
          <div role="alert" className="connection-alert">
            {online
              ? currentHosting?.transport === "replay"
                ? "The score server is unavailable. Your current city can continue; new scored shifts will wait for reconnection."
                : "Connection interrupted. Reconnecting to your city…"
              : "Display disconnected from the local game engine. Reconnecting…"}
          </div>
        )}
        {error && (
          <div role="alert" className="connection-alert">
            {error}
            <button
              className="text-button"
              onClick={clearError}
              style={{ marginLeft: 15 }}
            >
              Dismiss
            </button>
          </div>
        )}
        {!online && connection.path && !connection.connected && (
          <div role="status" className="connection-alert">
            CONTROLLER DISCONNECTED · Keyboard controls are active. Reconnect
            the USB controller to resume hardware input.
          </div>
        )}
        <section className="telemetry" aria-label="Live game statistics">
          <div className="telemetry-item time-stat">
            <div className="stat-label">
              <Clock3 size={15} />
              {practicing ? "PRACTICE PROGRESS" : "TIME REMAINING"}
            </div>
            <div>
              <strong
                className={
                  practicing
                    ? "training-step-value"
                    : state.remaining <= 10 && playing
                      ? "danger-text"
                      : ""
                }
              >
                {practicing
                  ? state.training.step === "complete"
                    ? "READY"
                    : `${["select", "match", "release"].indexOf(state.training.step) + 1} / 3`
                  : clock(state.remaining)}
              </strong>
              <span className="time-duration">
                {practicing ? "NO TIMER" : `/ ${state.roundDuration || 60} SEC`}
              </span>
            </div>
            <div className="time-line">
              <i
                style={{
                  transform: `scaleX(${state.remaining / (state.roundDuration || 60)})`,
                }}
              />
            </div>
          </div>
          <div className="telemetry-item">
            <div className="stat-label">
              <ShieldCheck size={15} />
              CRITICAL SERVICES
            </div>
            <div>
              <strong>
                {criticalCount}
                <span className="stat-fraction"> / 4</span>
              </strong>
              <span className="stat-note">ONLINE</span>
            </div>
          </div>
          <div className="telemetry-item">
            <div className="stat-label">
              <Zap size={15} />
              PRIORITY SCORE
            </div>
            <div>
              <strong>
                {practicing || demonstrating
                  ? "—"
                  : format(state.score.priority + state.score.criticalBonus)}
              </strong>
              <span className="stat-note">
                {practicing || demonstrating ? "UNSCORED" : "POINTS"}
              </span>
            </div>
          </div>
          <div className="telemetry-item grid-status">
            <div className="stat-label">
              <Activity size={15} />
              GRID STATUS
            </div>
            <div>
              <span className={`status-orb ${playing ? "pulsing" : ""}`} />
              <strong>
                {practicing
                  ? state.phase === "paused"
                    ? "PAUSED"
                    : "PRACTICE"
                  : demonstrating
                    ? "DEMONSTRATION"
                    : state.storage <= 0 ||
                        state.result?.endReason === "city_blackout"
                      ? "COLLAPSED"
                      : state.phase === "paused"
                        ? "PAUSED"
                        : ready
                          ? "STANDING BY"
                          : state.phase === "countdown"
                            ? "GET READY"
                            : state.elapsed >= 40
                              ? "HIGH STRESS"
                              : playing
                                ? "UNDER LOAD"
                                : "SHIFT ENDED"}
              </strong>
            </div>
            <span className="grid-status-sub">
              {ready
                ? "Awaiting operator input"
                : playing
                  ? `${state.stats.warnings} service${state.stats.warnings === 1 ? "" : "s"} requesting power`
                  : names[state.phase]}
            </span>
          </div>
        </section>
        <div className="game-layout">
          <div className="city-column">
            <City state={state} send={send} />
            <section
              className={`npc-panel ${caption.tone === "critical" ? "npc-critical" : ""}`}
              aria-live="polite"
              aria-atomic="true"
            >
              <div className="dispatch-icon" aria-hidden="true">
                <Radio size={22} />
              </div>
              <div className="npc-caption">
                <div>
                  <Radio size={12} />
                  <span>{caption.role || caption.name}</span>
                  <small>{caption.name} · LIVE</small>
                </div>
                <p key={caption.id}>{caption.text}</p>
              </div>
            </section>
          </div>
          <Controls state={state} send={send} />
        </div>
        <section className="control-strip">
          <div className="control-mode">
            <Keyboard size={15} />
            <span>
              {connection.mode === "hardware"
                ? "ARDUINO CONTROLS"
                : "KEYBOARD CONTROLS"}
            </span>
            <i className="dot low" />
          </div>
          <span className="control-instruction">
            <span className="arrow-keys">
              <Key>↑</Key>
              <Key>←</Key>
              <Key>↓</Key>
              <Key>→</Key>
            </span>
            Select block
          </span>
          <span className="control-instruction">
            <Key>Q</Key>
            <Key>E</Key>Change mode
          </span>
          <span className="control-instruction">
            <Key>SPACE</Key>Stabilize
          </span>
          <span className="control-instruction secondary-instruction">
            <Key>P</Key>Pause<Key>R</Key>Reset
          </span>
          <button
            className="icon-button fullscreen-button"
            aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            title="Exhibition fullscreen"
            onClick={() => {
              if (document.fullscreenElement)
                document.exitFullscreen?.().catch(() => {});
              else
                document.documentElement.requestFullscreen?.().catch(() => {});
            }}
          >
            <Maximize size={16} />
          </button>
        </section>
        <footer className="site-footer">
          <span>LAST LIGHT · AN ENERGY ALLOCATION SIMULATION</span>
          <a href="/downloads/last-light-controller.zip" download>
            ARDUINO CODE &amp; WIRING ↓
          </a>
          <span>36 BLOCKS / 4 CRITICAL SERVICES</span>
        </footer>
        {state.debug && canOrganize && (
          <div className="debug-strip">
            DEBUG · TIME {state.elapsed.toFixed(1)} · STORAGE{" "}
            {state.storage.toFixed(1)} · LOAD{" "}
            {Number(state.stats.gridLoad).toFixed(2)} · POWER{" "}
            {state.powerMode?.toUpperCase()} · TARGET {state.selectedId} ·
            REQUIRED{" "}
            {state.blocks.find((b) => b.id === state.selectedId)?.powerMode}·
            WARNINGS {state.stats.warnings} · SCORE {state.score.total} · SERIAL{" "}
            {connection.mode} · FPS {fps}
            <br />F fail · B warning · N caption · [ / ] storage · Q / E power ·
            P pause · R reset · F2 organizer
          </div>
        )}
      </main>
      {(modal === "tutorial" || modal === "start") && (
        <Tutorial
          duration={state.roundDuration || 60}
          online={online}
          isStart={modal === "start"}
          start={() => start(true)}
          close={close}
        />
      )}
      {modal === "leaderboard" && (
        <Leaderboard entries={leaderboard} close={close} online={online} />
      )}
      {modal === "admin-login" && online && !canOrganize && (
        <Dialog
          title="Organizer sign in"
          onClose={close}
          className="hosted-login-dialog"
        >
          <HostedLogin
            onAuthenticated={(data) => {
              applySession(data);
              refreshSession();
              setModal("organizer");
            }}
          />
        </Dialog>
      )}
      {modal === "organizer" && canOrganize && (
        <Dialog
          title="Organizer console"
          onClose={close}
          className="organizer-dialog"
        >
          <Organizer
            state={online ? { ...state, hosting: currentHosting } : state}
            send={send}
            fps={fps}
            onSessionUpdated={(data) => {
              applySession(data);
              refreshSession();
            }}
            onSignedOut={(data) => {
              applySession(data);
              refreshSession();
              close();
            }}
            onPreviewDemo={() => {
              setModal(null);
              send({ type: "demo" });
            }}
          />
        </Dialog>
      )}
      {state.phase === "results" &&
        resultDismissed !== state.roundId &&
        !modal && (
          <Results
            state={state}
            submitResult={submitResult}
            send={send}
            close={closeResult}
            onSaved={(entries) => {
              setLeaderboard(entries);
              setResultDismissed(state.roundId);
              resultBoard.current = true;
              setModal("leaderboard");
            }}
          />
        )}
    </div>
  );
}
