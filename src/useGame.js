import { useCallback, useEffect, useRef, useState } from "react";
import { createReplayTransport, requestGameApi } from "./replayTransport.js";
import { isPowerMode } from "../shared/power.js";

export function useGame() {
  const [state, setState] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [hosting, setHosting] = useState(null);
  const [sessionReady, setSessionReady] = useState(false);
  const socket = useRef(null);
  const replay = useRef(null);
  const applySession = useCallback((data) => {
    replay.current?.updateSession(data);
    if (data?.hosting) {
      setHosting(data.hosting);
      setState((current) =>
        current ? { ...current, hosting: data.hosting } : current,
      );
    }
    if (Array.isArray(data?.leaderboard)) setLeaderboard(data.leaderboard);
  }, []);
  const refreshSession = useCallback(async () => {
    if (replay.current) return replay.current.refresh();
    try {
      const data = await requestGameApi("/api/session");
      applySession(data);
    } catch (failure) {
      setError(failure.message);
    }
  }, [applySession]);
  const submitResult = useCallback(async (name, roundId) => {
    const data = replay.current
      ? await replay.current.submitResult(name, roundId)
      : await requestGameApi("/api/leaderboard", { name, roundId });
    if (Array.isArray(data.leaderboard)) setLeaderboard(data.leaderboard);
    return data;
  }, []);
  const dispatch = useCallback((message) => {
    if (replay.current) replay.current.send(message);
    else if (socket.current?.readyState === WebSocket.OPEN)
      socket.current.send(JSON.stringify(message));
  }, []);
  const send = useCallback(
    (message) => {
      if (message.type === "power" && (!isPowerMode(message.mode) || Object.keys(message).some((key) => !["type", "mode"].includes(key)))) return;
      dispatch(message);
    },
    [dispatch],
  );
  useEffect(() => {
    let disposed = false,
      timer;
    let bootstrapController;
    let retryAttempt = 0;
    function reconnect() {
      clearTimeout(timer);
      const delay = Math.min(30000, 1500 * 2 ** Math.min(retryAttempt++, 5));
      timer = setTimeout(connect, delay);
    }
    async function connect() {
      // Hosted play needs its HttpOnly visitor cookie before the WebSocket opens.
      // A local exhibition server may omit this endpoint and return 404.
      bootstrapController = new AbortController();
      const sessionTimeout = setTimeout(
        () => bootstrapController.abort(),
        10000,
      );
      let sessionData;
      try {
        const session = await fetch("/api/session", {
          credentials: "same-origin",
          cache: "no-store",
          signal: bootstrapController.signal,
        });
        if (session.status !== 404) {
          const data = await session.json().catch(() => ({}));
          if (!session.ok)
            throw new Error(
              data.error || "Could not prepare your game session.",
            );
          if (!disposed) applySession(data);
          sessionData = data;
        }
      } catch (failure) {
        if (disposed) return;
        setConnected(false);
        setError(
          failure.name === "AbortError"
            ? "The server took too long to respond. Retrying…"
            : failure.message || "Could not connect. Retrying…",
        );
        reconnect();
        return;
      } finally {
        clearTimeout(sessionTimeout);
      }
      if (disposed) return;
      setSessionReady(true);
      if (sessionData?.hosting?.transport === "replay") {
        try {
          replay.current = createReplayTransport({
            session: sessionData,
            onState(snapshot) {
              if (disposed) return;
              setState(snapshot);
              setHosting(snapshot.hosting);
              setLeaderboard(snapshot.leaderboard || []);
            },
            onConnection(value) {
              if (!disposed) setConnected(value);
            },
            onError(value) {
              if (!disposed) setError(value);
            },
          });
          retryAttempt = 0;
          setError("");
        } catch (failure) {
          setConnected(false);
          setError(failure.message || "Could not prepare this city. Retrying…");
          reconnect();
        }
        return;
      }
      const ws = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
      );
      socket.current = ws;
      ws.onopen = () => {
        if (!disposed) {
          setConnected(true);
          retryAttempt = 0;
          setError("");
        }
      };
      ws.onmessage = ({ data }) => {
        if (disposed) return;
        try {
          const packet = JSON.parse(data);
          if (packet.type === "state") {
            setState(packet.state);
            if (packet.state?.hosting) setHosting(packet.state.hosting);
            if (packet.state?.leaderboard || packet.leaderboard)
              setLeaderboard(packet.state?.leaderboard || packet.leaderboard);
          }
          if (packet.type === "error") setError(packet.error);
        } catch {
          /* A broken frame never interrupts the display. */
        }
      };
      ws.onclose = () => {
        if (!disposed) {
          setConnected(false);
          reconnect();
        }
      };
      ws.onerror = () => ws.close();
    }
    connect();
    return () => {
      disposed = true;
      bootstrapController?.abort();
      clearTimeout(timer);
      socket.current?.close();
      replay.current?.dispose();
      replay.current = null;
    };
  }, [applySession]);
  return {
    state,
    connected,
    leaderboard,
    setLeaderboard,
    send,
    error,
    hosting,
    sessionReady,
    applySession,
    refreshSession,
    submitResult,
    clearError: () => setError(""),
  };
}

const soundFiles = {
  warning: "warning",
  stabilized: "save",
  saved: "save",
  waste: "waste",
  overpower: "waste",
  failure: "fail",
  failed: "fail",
  critical: "critical",
  critical_failure: "critical",
  storage: "storage",
  storage_low: "storage",
  storage_critical: "critical",
  practice_complete: "save",
};

export function useAudio(state, enabled) {
  const audio = useRef({});
  const seen = useRef(new Set());
  const lastRound = useRef(null);
  const lastTick = useRef(null);
  const unlocked = useRef(false);
  useEffect(() => {
    if (!enabled) Object.values(audio.current).forEach((clip) => clip.pause());
  }, [enabled]);
  const unlock = useCallback(() => {
    unlocked.current = true;
  }, []);
  const play = useCallback(
    (name, volume = 0.25) => {
      if (!enabled || !unlocked.current) return;
      let clip = audio.current[name];
      if (!clip) clip = audio.current[name] = new Audio(`/audio/${name}.wav`);
      clip.currentTime = 0;
      clip.volume = volume;
      clip.play().catch(() => {});
    },
    [enabled],
  );
  useEffect(() => {
    if (!state) return;
    if (lastRound.current !== state.roundId) {
      seen.current.clear();
      lastRound.current = state.roundId;
      lastTick.current = null;
    }
    for (const event of state.events || []) {
      if (seen.current.has(event.id)) continue;
      seen.current.add(event.id);
      const sound = soundFiles[event.type];
      if (sound) play(sound);
    }
    if (seen.current.size > 500)
      seen.current = new Set((state.events || []).map((e) => e.id));
    const sec = Math.ceil(state.remaining);
    if (
      state.phase === "playing" &&
      sec <= 10 &&
      sec > 0 &&
      lastTick.current !== sec
    )
      play("countdown", 0.15 + (10 - sec) * 0.015);
    lastTick.current = sec;
  }, [state, play]);
  const lastPhase = useRef(null);
  useEffect(() => {
    if (state?.phase === "results" && lastPhase.current !== "results") {
      const timer = setTimeout(
        () => play(state.result?.survived ? "result-success" : "result-fail", 0.35),
        450,
      );
      lastPhase.current = state.phase;
      return () => clearTimeout(timer);
    }
    lastPhase.current = state?.phase;
  }, [state?.phase, play]);
  return { unlock, play };
}
