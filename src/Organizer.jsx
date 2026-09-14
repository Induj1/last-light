import React, { useEffect, useRef, useState } from "react";
import {
  Archive,
  Check,
  Code2,
  Download,
  Flag,
  LogOut,
  Play,
  PlugZap,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  Usb,
} from "lucide-react";
import "./organizer.css";

const ORGANIZER_TABS = ["controller", "game", "event"];
const canManageEvent = (phase) => ["ready", "demo", "results"].includes(phase);
const formatEventDate = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "—";
};

export default function Organizer({
  state,
  send,
  fps,
  onPreviewDemo,
  onSignedOut,
  onSessionUpdated,
}) {
  const online = state.hosting?.mode === "online";
  const tabs = online ? ["game", "event"] : ORGANIZER_TABS;
  const [ports, setPorts] = useState([]);
  const [path, setPath] = useState("");
  const [calibration, setCalibration] = useState({
    centerX: 512,
    centerY: 512,
    deadzone: 80,
    minPot: 0,
    maxPot: 1023,
    invertY: false,
  });
  const [notice, setNotice] = useState("");
  const [pendingRequests, setPendingRequests] = useState(0);
  const [storage, setStorage] = useState(50);
  const [tab, setTab] = useState(online ? "event" : "controller");
  const [settings, setSettings] = useState(null);
  const [event, setEvent] = useState(null);
  const [history, setHistory] = useState([]);
  const [eventError, setEventError] = useState("");
  const busy = pendingRequests > 0;
  const connection = state.connection || {};
  useEffect(() => {
    if (online && tab === "controller") setTab("event");
  }, [online, tab]);
  const incomingSettings = JSON.stringify(state.settings || null);
  useEffect(() => {
    if (incomingSettings !== "null") setSettings(JSON.parse(incomingSettings));
  }, [incomingSettings]);
  useEffect(() => {
    if (state.event) setEvent(state.event);
  }, [state.event?.id, state.event?.name, state.event?.submissionCount]);
  async function request(url, body) {
    setPendingRequests((count) => count + 1);
    setNotice("");
    try {
      const res = await fetch(
        url,
        body === undefined
          ? {}
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(data.error || "The operation could not be completed.");
      return data;
    } catch (e) {
      setNotice(e.message);
      return null;
    } finally {
      setPendingRequests((count) => Math.max(0, count - 1));
    }
  }
  async function loadEvent() {
    setEventError("");
    const data = await request("/api/event/settings");
    if (data?.settings && data?.event) {
      setSettings(data.settings);
      setEvent(data.event);
      const archived = await request("/api/event/history");
      if (archived?.events) setHistory(archived.events);
      if (data.warning) setNotice(data.warning);
    } else
      setEventError(
        "Event settings could not be loaded. Check the connection and retry.",
      );
  }
  async function saveSettings(changes) {
    const data = await request("/api/event/settings", changes);
    if (!data?.settings) return null;
    setSettings(data.settings);
    setEvent(data.event);
    onSessionUpdated?.(data);
    setNotice(
      data.warning ||
        (online
          ? "Public event settings saved. They apply to each visitor’s next shift."
          : "Event settings saved on this laptop. They apply to the next shift."),
    );
    return data;
  }
  async function startNewEvent(name) {
    const data = await request("/api/event/new", { name });
    if (!data?.event) return null;
    setEvent(data.event);
    setSettings(data.settings);
    onSessionUpdated?.(data);
    if (data.previousEvent)
      setHistory((current) => [
        data.previousEvent,
        ...current.filter((item) => item.id !== data.previousEvent.id),
      ]);
    setNotice(
      data.warning ||
        `“${data.previousEvent?.name || "Previous event"}” archived safely. “${data.event.name}” is ready for its first operator.`,
    );
    return data;
  }
  async function refresh() {
    const data = await request("/api/serial/ports");
    if (data) {
      setPorts(data.ports);
      setPath((current) => current || data.ports[0]?.path || "");
      if (!data.ports.length)
        setNotice("No serial ports found. Keyboard mode is ready to use.");
    }
  }
  useEffect(() => {
    let gone = false;
    if (!online) {
      fetch("/api/config")
        .then((r) => r.json())
        .then((data) => {
          if (!gone && data.calibration) setCalibration(data.calibration);
        })
        .catch(() => {});
      refresh();
    }
    loadEvent();
    // Keep an unattended demonstration from starting while an organizer edits.
    send({ type: "activity" });
    const activityTimer = setInterval(() => send({ type: "activity" }), 5000);
    return () => {
      gone = true;
      clearInterval(activityTimer);
    };
  }, [online]);
  function set(key, value) {
    setCalibration((c) => ({ ...c, [key]: value }));
  }
  const raw = connection.raw;
  return (
    <>
      <div className="section-eyebrow">
        <Settings2 size={15} /> EXHIBITION TOOLS
      </div>
      <h2>
        Organizer <span>console.</span>
      </h2>
      <p className="dialog-intro">
        {online
          ? "Manage the shared public event and its scores. Each visitor plays their own city."
          : "Connect your controls, calibrate the hardware, and prepare the next shift."}
      </p>
      {online && (
        <div className="hosted-admin-bar">
          <span>ORGANIZER SIGNED IN</span>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={async () => {
              const data = await request("/api/admin/logout", {});
              if (data) onSignedOut?.(data);
            }}
          >
            Sign out <LogOut size={14} />
          </button>
        </div>
      )}
      <div
        className="organizer-tabs"
        role="tablist"
        aria-label="Organizer sections"
        onKeyDown={(e) => {
          const offset =
            e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
          if (!offset && !["Home", "End"].includes(e.key)) return;
          e.preventDefault();
          const index =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? tabs.length - 1
                : (tabs.indexOf(tab) + offset + tabs.length) % tabs.length;
          const next = tabs[index];
          setTab(next);
          document.getElementById(`organizer-tab-${next}`)?.focus();
        }}
      >
        {!online && (
          <button
            id="organizer-tab-controller"
            role="tab"
            aria-selected={tab === "controller"}
            aria-controls="organizer-panel-controller"
            tabIndex={tab === "controller" ? 0 : -1}
            className={tab === "controller" ? "active" : ""}
            onClick={() => setTab("controller")}
          >
            <Usb size={15} />
            Controller
          </button>
        )}
        <button
          id="organizer-tab-game"
          role="tab"
          aria-selected={tab === "game"}
          aria-controls="organizer-panel-game"
          tabIndex={tab === "game" ? 0 : -1}
          className={tab === "game" ? "active" : ""}
          onClick={() => setTab("game")}
        >
          <SlidersHorizontal size={15} />
          Game & diagnostics
        </button>
        <button
          id="organizer-tab-event"
          role="tab"
          aria-selected={tab === "event"}
          aria-controls="organizer-panel-event"
          tabIndex={tab === "event" ? 0 : -1}
          className={tab === "event" ? "active" : ""}
          onClick={() => setTab("event")}
        >
          <Flag size={15} /> Event tools
        </button>
      </div>
      {tab === "controller" && !online ? (
        <div
          className="organizer-content"
          id="organizer-panel-controller"
          role="tabpanel"
          aria-labelledby="organizer-tab-controller"
        >
          <div className="hardware-status">
            <span
              className={`dot ${connection.connected ? "low" : "medium"}`}
            />
            <div>
              <strong>
                {connection.connected
                  ? "Arduino connected"
                  : "Keyboard mode active"}
              </strong>
              <p>
                {connection.connected
                  ? `${connection.path} · 115200 baud`
                  : connection.status ||
                    "Connect the Arduino by USB, then choose its serial port."}
              </p>
            </div>
          </div>
          <label className="field-label" htmlFor="serial-port">
            SERIAL PORT
          </label>
          <div className="port-row">
            <select
              id="serial-port"
              value={path}
              onChange={(e) => setPath(e.target.value)}
            >
              <option value="">Select a USB serial port</option>
              {ports.map((p) => (
                <option key={p.path} value={p.path}>
                  {p.path}
                  {p.manufacturer ? ` · ${p.manufacturer}` : ""}
                </option>
              ))}
            </select>
            <button
              className="icon-button"
              aria-label="Refresh serial ports"
              onClick={refresh}
              disabled={busy}
            >
              <RefreshCw size={17} />
            </button>
            <button
              className="secondary-button"
              disabled={busy || (!path && !connection.connected)}
              onClick={async () => {
                const data = await request(
                  `/api/serial/${connection.connected ? "disconnect" : "connect"}`,
                  connection.connected ? {} : { path },
                );
                if (data)
                  setNotice(
                    connection.connected
                      ? "Keyboard controls restored."
                      : "Port selected. Waiting for valid controller packets…",
                  );
              }}
            >
              {connection.connected ? "Disconnect" : "Connect"}
              <PlugZap size={15} />
            </button>
          </div>
          <div className="form-section-heading">
            <h3>Input calibration</h3>
            <span>Saved on this laptop</span>
          </div>
          <div className="calibration-grid">
            {[
              ["centerX", "JOYSTICK X CENTRE", 100, 923],
              ["centerY", "JOYSTICK Y CENTRE", 100, 923],
              ["deadzone", "DEAD ZONE", 0, 250],
              ["minPot", "KNOB MINIMUM", 0, 1022],
              ["maxPot", "KNOB MAXIMUM", 1, 1023],
            ].map(([key, label, min, max]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min={min}
                  max={max}
                  value={calibration[key] ?? ""}
                  onChange={(e) => set(key, Number(e.target.value))}
                />
              </label>
            ))}
            <label className="check-field">
              <input
                type="checkbox"
                checked={Boolean(calibration.invertY)}
                onChange={(e) => set("invertY", e.target.checked)}
              />
              INVERT JOYSTICK Y
            </label>
          </div>
          <div className="raw-values">
            RAW INPUT <span>X {raw?.joystickX ?? "—"}</span>
            <span>Y {raw?.joystickY ?? "—"}</span>
            <span>KNOB {raw?.potentiometer ?? "—"}</span>
          </div>
          <div className="calibration-actions">
            <button
              className="text-button"
              disabled={!raw}
              onClick={() => {
                set("centerX", raw.joystickX);
                set("centerY", raw.joystickY);
                setNotice("Centres captured. Save calibration to apply.");
              }}
            >
              Capture resting centre
              <CrosshairIcon />
            </button>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={async () => {
                const data = await request(
                  "/api/serial/calibrate",
                  calibration,
                );
                if (data) {
                  setCalibration(data.calibration);
                  setNotice("Calibration saved.");
                }
              }}
            >
              Save calibration
              <Check size={15} />
            </button>
          </div>
          <div className="form-section-heading">
            <h3>Physical storage display</h3>
            <span>3-second test</span>
          </div>
          <p className="organizer-hint">
            Choose the correct LED adapter in the Arduino sketch before wiring
            your display. The supplied sketch keeps unknown displays disabled.
          </p>
          <div className="led-tests">
            {[0, 25, 50, 75, 100].map((value) => (
              <button
                className="secondary-button"
                key={value}
                disabled={!connection.connected || busy}
                onClick={async () => {
                  const data = await request("/api/serial/test", { value });
                  if (data)
                    setNotice(
                      `LED test sent: ${value}%. Game storage resumes after 3 seconds.`,
                    );
                }}
              >
                {value}%
              </button>
            ))}
          </div>
        </div>
      ) : tab === "game" ? (
        <div
          className="organizer-content"
          id="organizer-panel-game"
          role="tabpanel"
          aria-labelledby="organizer-tab-game"
        >
          <div className="form-section-heading">
            <h3>Round difficulty</h3>
            <span>Saved for this event</span>
          </div>
          <div className="difficulty-options">
            {[
              ["easy", "First shift", "More time to react"],
              ["normal", "City operator", "The intended challenge"],
              ["hard", "Night crisis", "Less margin for error"],
            ].map(([id, label, sub]) => (
              <button
                key={id}
                className={
                  (settings?.difficulty || state.difficulty) === id
                    ? "selected"
                    : ""
                }
                disabled={busy || !settings || !canManageEvent(state.phase)}
                onClick={() => saveSettings({ difficulty: id })}
              >
                <b>{label}</b>
                <small>{sub}</small>
                {(settings?.difficulty || state.difficulty) === id && (
                  <Check size={14} />
                )}
              </button>
            ))}
          </div>
          {!canManageEvent(state.phase) && (
            <p className="organizer-hint">
              Finish or reset the active shift before changing event settings.
            </p>
          )}
          <div className="debug-toggle">
            <div>
              <h3>Diagnostic controls</h3>
              <p>
                Mutating a round marks it as practice and excludes its score.
              </p>
            </div>
            <button
              role="switch"
              aria-label="Enable diagnostic controls"
              aria-checked={state.debug}
              className={`toggle ${state.debug ? "on" : ""}`}
              onClick={() => send({ type: "debug", action: "toggle" })}
            >
              <i />
            </button>
          </div>
          <div className="diagnostic-values">
            {[
              ["TIME", `${state.elapsed.toFixed(1)}s`],
              ["STORAGE", `${state.storage.toFixed(1)}%`],
              ["GRID LOAD", Number(state.stats.gridLoad).toFixed(2)],
              ["OUTPUT", (state.powerMode || "low").toUpperCase()],
              ["TARGET", state.selectedId],
              ["WARNINGS", state.stats.warnings],
              ["SCORE", state.score.total],
              ["DISPLAY", `${fps} FPS`],
            ].map(([label, val]) => (
              <div key={label}>
                <small>{label}</small>
                <b>{val}</b>
              </div>
            ))}
          </div>
          <div className="debug-buttons">
            {[
              ["warn", "Trigger warning"],
              ["fail", "Fail target"],
              ["npc", "Trigger caption"],
            ].map(([action, label]) => (
              <button
                className="secondary-button"
                key={action}
                disabled={
                  !state.debug ||
                  (action !== "npc" &&
                    !["playing", "paused"].includes(state.phase))
                }
                onClick={() => {
                  send({ type: "debug", action });
                  setNotice(`${label} command sent to ${state.selectedId}.`);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="debug-storage">
            <label htmlFor="debug-storage">SET RESERVE</label>
            <input
              id="debug-storage"
              type="range"
              min="0"
              max="100"
              value={storage}
              onChange={(e) => setStorage(Number(e.target.value))}
            />
            <span>{storage}%</span>
            <button
              className="secondary-button"
              disabled={!state.debug}
              onClick={() =>
                send({ type: "debug", action: "storage", value: storage })
              }
            >
              Apply
            </button>
          </div>
          <p className="organizer-hint">
            Close this panel for shortcuts: F fail · B warning · N caption · [ /
            ] storage. P pauses and R resets the round.
          </p>
        </div>
      ) : (
        <EventTools
          settings={settings}
          event={event}
          history={history}
          phase={state.phase}
          busy={busy}
          error={eventError}
          onRetry={loadEvent}
          onSave={saveSettings}
          onNewEvent={startNewEvent}
          onPreviewDemo={onPreviewDemo || (() => send({ type: "demo" }))}
          online={online}
        />
      )}
      {notice && (
        <div role="status" className="organizer-notice">
          {notice}
        </div>
      )}
      <div className="organizer-footer">
        <Code2 size={14} />
        <span>
          {online
            ? "Shared event records are saved on the server. Organizer access stays in this browser session."
            : "Settings and event records stay on this laptop · Hardware guide: docs/HARDWARE.md"}
        </span>
      </div>
    </>
  );
}

function EventTools({
  settings,
  event,
  history,
  phase,
  busy,
  error,
  onRetry,
  onSave,
  onNewEvent,
  onPreviewDemo,
  online = false,
}) {
  const [draft, setDraft] = useState(settings);
  const [newName, setNewName] = useState("");
  const [reviewName, setReviewName] = useState(null);
  const reviewRef = useRef(null);
  const newNameRef = useRef(null);
  const allowed = canManageEvent(phase);
  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => {
    if (reviewName) reviewRef.current?.focus();
  }, [reviewName]);
  useEffect(() => {
    if (!allowed) setReviewName(null);
  }, [allowed]);
  const change = (key, value) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const archivedEvents = [...history].sort(
    (a, b) => new Date(b.endedAt) - new Date(a.endedAt),
  );
  return (
    <div
      className="organizer-content event-tools"
      id="organizer-panel-event"
      role="tabpanel"
      aria-labelledby="organizer-tab-event"
    >
      {event && (
        <section
          className="event-current"
          aria-label="Current exhibition event"
        >
          <div>
            <span className="event-eyebrow">CURRENT EVENT</span>
            <h3>{event.name}</h3>
            <p>Started {formatEventDate(event.startedAt)}</p>
          </div>
          <div className="event-count">
            <strong>
              {Number.isFinite(event.submissionCount)
                ? event.submissionCount
                : "—"}
            </strong>
            <span>submitted scores</span>
          </div>
        </section>
      )}
      {error && (
        <div className="event-load-error" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={onRetry}
          >
            Retry event settings <RefreshCw size={14} />
          </button>
        </div>
      )}
      {!draft && !error && (
        <p role="status" className="organizer-hint">
          Loading saved event settings…
        </p>
      )}
      {draft && (
        <>
          {!allowed && (
            <p className="event-locked" role="status">
              Finish or reset the active shift to change settings or start a new
              event. Exports remain available.
            </p>
          )}
          <form
            className="event-settings-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!allowed || busy) return;
              await onSave({
                ...draft,
                eventName: draft.eventName.trim(),
                roundDuration: Number(draft.roundDuration),
                resetSeconds: Number(draft.resetSeconds),
                attractIdleSeconds: Number(draft.attractIdleSeconds),
              });
            }}
          >
            <div className="form-section-heading">
              <h3>Event settings</h3>
              <span>Saved between restarts</span>
            </div>
            <fieldset disabled={busy || !allowed}>
              <legend className="event-sr-only">
                Settings for this exhibition
              </legend>
              <div className="event-fields">
                <label className="event-field-wide" htmlFor="event-name">
                  EVENT NAME
                  <input
                    id="event-name"
                    type="text"
                    maxLength={80}
                    required
                    value={draft.eventName}
                    onChange={(e) => change("eventName", e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label htmlFor="event-difficulty">
                  DIFFICULTY
                  <select
                    id="event-difficulty"
                    value={draft.difficulty}
                    onChange={(e) => change("difficulty", e.target.value)}
                  >
                    <option value="easy">First shift — easy</option>
                    <option value="normal">City operator — normal</option>
                    <option value="hard">Night crisis — hard</option>
                  </select>
                </label>
                <label htmlFor="event-duration">
                  ROUND LENGTH · SECONDS
                  <input
                    id="event-duration"
                    type="number"
                    min={30}
                    max={180}
                    step={1}
                    required
                    value={draft.roundDuration}
                    onChange={(e) => change("roundDuration", e.target.value)}
                  />
                  <small>30–180 seconds</small>
                </label>
                <label htmlFor="event-reset">
                  RESULT SCREEN · SECONDS
                  <input
                    id="event-reset"
                    type="number"
                    min={10}
                    max={60}
                    step={1}
                    required
                    value={draft.resetSeconds}
                    onChange={(e) => change("resetSeconds", e.target.value)}
                  />
                  <small>10–60 seconds for the next operator</small>
                </label>
                <label htmlFor="event-idle">
                  IDLE DEMO AFTER · SECONDS
                  <input
                    id="event-idle"
                    type="number"
                    min={15}
                    max={300}
                    step={1}
                    required
                    value={draft.attractIdleSeconds}
                    onChange={(e) =>
                      change("attractIdleSeconds", e.target.value)
                    }
                  />
                  <small>15–300 seconds without a player</small>
                </label>
                <label
                  className="event-attract-toggle event-field-wide"
                  htmlFor="event-attract"
                >
                  <input
                    id="event-attract"
                    type="checkbox"
                    checked={draft.attractEnabled}
                    onChange={(e) => change("attractEnabled", e.target.checked)}
                  />
                  <span>
                    <b>Run the demonstration while idle</b>
                    <small>
                      A guided preview invites visitors to play. Demo runs never
                      enter the leaderboard.
                    </small>
                  </span>
                </label>
              </div>
              <div className="event-form-actions">
                <p>
                  Use the same difficulty and round length for fair event
                  rankings.
                </p>
                <button type="submit" className="secondary-button">
                  Save event settings <Check size={15} />
                </button>
              </div>
            </fieldset>
          </form>
          <div className="event-preview">
            <p>
              Preview the unattended city demonstration. The organizer console
              closes so visitors can see the full display.
            </p>
            <button
              type="button"
              className="secondary-button"
              disabled={busy || !allowed}
              onClick={onPreviewDemo}
            >
              Preview demonstration <Play size={14} />
            </button>
          </div>
          <section
            className="event-export"
            aria-labelledby="event-export-heading"
          >
            <div>
              <h3 id="event-export-heading">Every operator, in one file.</h3>
              <p>
                Export every submitted score in this event, including scores
                outside the top ten.
              </p>
            </div>
            <a
              className="secondary-button"
              href="/api/leaderboard/export.csv"
              download={`last-light-${event?.id || "event"}.csv`}
            >
              Export all scores <Download size={15} />
            </a>
          </section>
          <section className="event-new" aria-labelledby="event-new-heading">
            <div className="form-section-heading">
              <h3 id="event-new-heading">Start a fresh event</h3>
              <Archive size={16} />
            </div>
            <p>
              Keep the current event and every submitted score in an archive,
              then open an empty leaderboard for the next exhibition.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (allowed && !busy && newName.trim())
                  setReviewName(newName.trim());
              }}
            >
              <label className="event-new-label" htmlFor="new-event-name">
                NEW EVENT NAME
              </label>
              <div className="event-new-row">
                <input
                  id="new-event-name"
                  ref={newNameRef}
                  type="text"
                  required
                  maxLength={80}
                  autoComplete="off"
                  placeholder="e.g. Engineers’ Day — afternoon"
                  value={newName}
                  disabled={!allowed || busy}
                  onChange={(e) => {
                    setNewName(e.target.value);
                    setReviewName(null);
                  }}
                />
                <button
                  type="submit"
                  className="secondary-button"
                  disabled={!allowed || busy || !newName.trim()}
                >
                  Review new event
                </button>
              </div>
            </form>
            {reviewName && (
              <div
                className="event-confirmation"
                ref={reviewRef}
                tabIndex={-1}
                role="group"
                aria-labelledby="event-confirm-heading"
              >
                <h4 id="event-confirm-heading">
                  Archive “{event?.name}” and start “{reviewName}”?
                </h4>
                <p>
                  {Number.isFinite(event?.submissionCount)
                    ? `${event.submissionCount} submitted ${event.submissionCount === 1 ? "score will" : "scores will"}`
                    : "All current scores will"}{" "}
                  remain in the archive. The new event starts with an empty
                  leaderboard and the current saved game settings.
                </p>
                {online && (
                  <p>
                    Active online games will reset when the new event starts.
                  </p>
                )}
                <div>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      setReviewName(null);
                      newNameRef.current?.focus();
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="secondary-button event-archive-button"
                    disabled={!allowed || busy}
                    onClick={async () => {
                      const result = await onNewEvent(reviewName);
                      if (result) {
                        setReviewName(null);
                        setNewName("");
                        newNameRef.current?.focus();
                      }
                    }}
                  >
                    Archive &amp; start new event <Archive size={15} />
                  </button>
                </div>
              </div>
            )}
          </section>
          <details className="event-history">
            <summary>
              Archived events <span>{history.length}</span>
            </summary>
            {archivedEvents.length ? (
              <ul>
                {archivedEvents.map((previous) => (
                  <li key={previous.id}>
                    <div>
                      <strong>{previous.name}</strong>
                      <small>
                        {previous.submissionCount} scores ·{" "}
                        {formatEventDate(previous.endedAt)}
                      </small>
                    </div>
                    <a
                      href={`/api/event/${encodeURIComponent(previous.id)}/export.csv`}
                      download={`last-light-${previous.id}.csv`}
                      className="text-button"
                      aria-label={`Export scores from ${previous.name}`}
                    >
                      CSV <Download size={14} />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                Your first archive will appear here after starting a new event.
              </p>
            )}
          </details>
        </>
      )}
    </div>
  );
}

function CrosshairIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
    >
      <circle cx="10" cy="10" r="5" />
      <path d="M10 1v5m0 8v5M1 10h5m8 0h5" />
    </svg>
  );
}
