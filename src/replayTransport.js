import {
  createSeededEngine,
  REPLAY_STEP,
  REPLAY_VERSION,
} from "../shared/replay.js";
import { isPowerMode } from "../shared/power.js";

const NEUTRAL = Object.freeze({
  type: "input",
  x: 0,
  y: 0,
  powerDelta: 0,
  stabilize: false,
});
const ACTIVE = new Set(["countdown", "playing"]);
const RECORDED = new Set(["input", "select", "power"]);

export async function requestGameApi(url, body, signal) {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    signal,
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      data.error || "The server could not complete this request. Please retry.",
    );
  return data;
}

/** Browser simulation with a fixed-step tape verified by the score endpoint. */
export function createReplayTransport({
  session,
  onState,
  onConnection,
  onError,
  request = requestGameApi,
  now = () => performance.now(),
  requestFrame = (callback) => requestAnimationFrame(callback),
  cancelFrame = (id) => cancelAnimationFrame(id),
  documentRef = document,
}) {
  let current = session;
  let engine;
  let configKey;
  let localSequence = 0;
  let tape = null;
  const completed = new Map();
  let disposed = false;
  let reachable = true;
  let starting = false;
  let startGeneration = 0;
  let polling = false;
  let refreshAgain = false;
  let sessionRevision = 0;
  let frameId;
  let previousTime = now();
  let accumulator = 0;
  let lastActivity = previousTime;
  let lastRefresh = previousTime;
  const requests = new Set();

  function desiredConfig() {
    return (
      current.config ||
      Object.fromEntries(
        Object.entries({
          DIFFICULTY: current.settings?.difficulty,
          ROUND_DURATION: current.settings?.roundDuration,
          AUTO_RESET_DURATION: current.settings?.resetSeconds,
          ATTRACT_ENABLED: current.settings?.attractEnabled,
          ATTRACT_IDLE_SECONDS: current.settings?.attractIdleSeconds,
        }).filter(([, value]) => value !== undefined),
      )
    );
  }
  function freshLocal() {
    const config = desiredConfig();
    engine = createSeededEngine({
      seed: Math.floor(Math.random() * 0x100000000),
      roundId: `preview-${Date.now()}-${++localSequence}`,
      config,
    });
    configKey = JSON.stringify(config);
    tape = null;
    accumulator = 0;
  }
  function publish() {
    if (disposed) return;
    onState({
      ...engine.snapshot(),
      hosting: current.hosting,
      settings: current.settings,
      event: current.event,
      leaderboard: current.leaderboard || [],
      startingRound: starting,
      connection: {
        mode: "keyboard",
        connected: false,
        status: "Online browser controls",
      },
    });
  }
  function updateSession(data) {
    if (disposed || !data) return;
    sessionRevision++;
    const changedEvent =
      data.event?.id && current.event?.id && data.event.id !== current.event.id;
    current = { ...current, ...data };
    if (changedEvent) {
      startGeneration++;
      starting = false;
      completed.clear();
      freshLocal();
      onError(
        "A new exhibition event has started. Your next shift will join its leaderboard.",
      );
    } else if (
      engine.state.phase === "ready" &&
      configKey !== JSON.stringify(desiredConfig())
    ) {
      freshLocal();
    }
    publish();
  }
  async function api(url, body) {
    const controller = new AbortController();
    requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      return await request(url, body, controller.signal);
    } finally {
      clearTimeout(timeout);
      requests.delete(controller);
    }
  }
  async function refresh() {
    if (disposed) return;
    if (polling) {
      refreshAgain = true;
      return;
    }
    polling = true;
    const revision = sessionRevision;
    lastRefresh = now();
    try {
      const data = await api("/api/status");
      if (disposed) return;
      if (revision !== sessionRevision) {
        refreshAgain = true;
        return;
      }
      if (data.hosting?.transport !== "replay")
        throw new Error(
          "The game server changed. Refresh this page to continue.",
        );
      if (!reachable) onError("");
      reachable = true;
      onConnection(true);
      updateSession(data);
    } catch (failure) {
      if (disposed) return;
      reachable = false;
      onConnection(false);
      onError(
        failure.name === "AbortError"
          ? "The score server is taking too long. Your city can continue; new scored shifts will wait for reconnection."
          : failure.message,
      );
    } finally {
      polling = false;
      if (refreshAgain && !disposed) {
        refreshAgain = false;
        refresh();
      }
    }
  }
  function record(command) {
    if (!tape || !RECORDED.has(command.type) || !ACTIVE.has(engine.state.phase))
      return;
    // Commands at one boundary keep their original order, including key release.
    const entry = { tick: tape.ticks, command: structuredClone(command) };
    const previous = tape.commands.at(-1);
    if (
      previous?.tick === entry.tick &&
      JSON.stringify(previous.command) === JSON.stringify(entry.command)
    )
      return;
    const bytes = JSON.stringify(entry).length + 1;
    if (tape.commands.length >= 18000 || tape.bytes + bytes > 240000) {
      tape = null;
      engine.state.practice = true;
      onError(
        "This shift received too many control changes to verify. You can finish it as practice.",
      );
      return;
    }
    tape.commands.push(entry);
    tape.bytes += bytes;
  }
  function control(command) {
    // Pauses are absent from replay time, so clear the intent on both boundaries.
    if (command.type === "pause") {
      const paused = engine.state.phase === "paused";
      if (paused) {
        if (!engine.command(command)) return false;
        if (engine.command(NEUTRAL)) record(NEUTRAL);
      } else {
        if (engine.command(NEUTRAL)) record(NEUTRAL);
        if (!engine.command(command)) return false;
      }
      accumulator = 0;
      previousTime = now();
      return true;
    }
    if (engine.state.phase === "paused" && RECORDED.has(command.type)) {
      // UI controls are paused too. Ignore stale held-key input until resumed.
      return false;
    }
    const accepted = engine.command(command);
    if (accepted) record(command);
    return accepted;
  }
  async function startRanked() {
    if (starting || disposed) return;
    const phase = engine.state.phase;
    if (
      !["ready", "results", "practice"].includes(phase) &&
      !(phase === "paused" && engine.resumePhase === "practice")
    )
      return;
    if (!reachable) {
      onError("Reconnect to the score server before starting a scored shift.");
      refresh();
      return;
    }
    starting = true;
    const generation = ++startGeneration;
    publish();
    try {
      const round = await api("/api/round/start", {});
      if (disposed || generation !== startGeneration) return;
      if (round.version !== REPLAY_VERSION)
        throw new Error(
          "A new game version is available. Refresh this page before starting your shift.",
        );
      if (!round.ticket || !round.roundId || !Number.isInteger(round.seed))
        throw new Error(
          "The server could not prepare a verified round. Please retry.",
        );
      engine = createSeededEngine({
        seed: round.seed,
        roundId: round.roundId,
        config: round.config,
      });
      configKey = JSON.stringify(round.config);
      engine.command({ type: "start" });
      tape = {
        ticket: round.ticket,
        roundId: round.roundId,
        ticks: 0,
        commands: [],
        bytes: 0,
      };
      accumulator = 0;
      previousTime = now();
      lastActivity = previousTime;
      if (documentRef.hidden) control({ type: "pause" });
      onError("");
    } catch (failure) {
      if (!disposed && generation === startGeneration)
        onError(
          failure.name === "AbortError"
            ? "Preparing the shift timed out. Please retry."
            : failure.message,
        );
    } finally {
      if (!disposed && generation === startGeneration) {
        starting = false;
        publish();
      }
    }
  }
  function send(command) {
    if (disposed || !command || typeof command !== "object") return;
    if (command.type === "power" && (!isPowerMode(command.mode) || Object.keys(command).some((key) => !["type", "mode"].includes(key)))) return;
    lastActivity = now();
    if (command.type === "activity") return;
    if (command.type === "start" && engine.state.phase !== "demo") {
      startRanked();
      return;
    }
    if (
      ["debug", "difficulty", "demo"].includes(command.type) &&
      !current.hosting?.admin
    )
      return;
    const accepted = control(command);
    if (!accepted) return;
    if (
      ["reset", "restart", "practice", "demo", "wake"].includes(command.type)
    ) {
      startGeneration++;
      starting = false;
      tape = null;
    }
    if (command.type === "debug" && command.action !== "toggle") {
      tape = null;
      engine.state.practice = true;
      if (engine.state.result) {
        engine.state.result.practice = true;
        completed.delete(engine.state.result.roundId);
      }
    }
    if (
      engine.state.phase === "ready" &&
      configKey !== JSON.stringify(desiredConfig())
    )
      freshLocal();
    publish();
  }
  function step() {
    if (engine.state.phase === "paused") return;
    const activeTape = tape && ACTIVE.has(engine.state.phase) ? tape : null;
    engine.tick(REPLAY_STEP);
    if (activeTape) {
      activeTape.ticks++;
      if (engine.state.phase === "results") {
        if (!engine.state.result?.practice) {
          completed.set(activeTape.roundId, structuredClone(activeTape));
          while (completed.size > 5)
            completed.delete(completed.keys().next().value);
        }
        tape = null;
      }
    }
    if (
      engine.state.phase === "ready" &&
      configKey !== JSON.stringify(desiredConfig())
    )
      freshLocal();
  }
  function frame(timestamp) {
    if (disposed) return;
    const elapsed = Math.max(
      0,
      Math.min(0.25, (timestamp - previousTime) / 1000),
    );
    previousTime = timestamp;
    if (!documentRef.hidden) {
      if (
        !starting &&
        engine.state.phase === "ready" &&
        engine.config.ATTRACT_ENABLED &&
        timestamp - lastActivity >= engine.config.ATTRACT_IDLE_SECONDS * 1000
      ) {
        engine.command({ type: "demo" });
      }
      accumulator += elapsed;
      let stepped = false;
      while (accumulator + 1e-9 >= REPLAY_STEP) {
        step();
        accumulator -= REPLAY_STEP;
        stepped = true;
      }
      if (stepped) publish();
    } else accumulator = 0;
    if (timestamp - lastRefresh >= 15000) refresh();
    frameId = requestFrame(frame);
  }
  function visibility() {
    accumulator = 0;
    previousTime = now();
    if (documentRef.hidden) {
      if (["countdown", "playing", "practice"].includes(engine.state.phase))
        control({ type: "pause" });
      else engine.command(NEUTRAL);
      publish();
    } else {
      lastActivity = now();
      refresh();
    }
  }
  async function submitResult(name, roundId) {
    const saved = completed.get(roundId);
    if (!saved)
      throw new Error(
        "This shift has no verified result to submit. Play a new scored shift.",
      );
    const data = await api("/api/leaderboard", {
      name,
      ticket: saved.ticket,
      commands: saved.commands,
      ticks: saved.ticks,
    });
    if (disposed) return data;
    updateSession({ leaderboard: data.leaderboard });
    refresh();
    return data;
  }

  freshLocal();
  publish();
  onConnection(true);
  documentRef.addEventListener("visibilitychange", visibility);
  frameId = requestFrame(frame);
  return {
    send,
    updateSession,
    refresh,
    submitResult,
    dispose() {
      disposed = true;
      startGeneration++;
      cancelFrame(frameId);
      requests.forEach((controller) => controller.abort());
      documentRef.removeEventListener("visibilitychange", visibility);
    },
  };
}
