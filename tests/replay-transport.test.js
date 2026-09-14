import test from "node:test";
import assert from "node:assert/strict";
import { createReplayTransport } from "../src/replayTransport.js";
import { REPLAY_VERSION, replayRound } from "../shared/replay.js";

const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

function fixture(t, overrides = {}) {
  let clock = 0;
  let callback;
  let snapshot;
  let reachable = true;
  let error = "";
  let statusFails = false;
  let startCount = 0;
  let latestSubmission;
  let startResponse;
  const listeners = new Map();
  const documentRef = {
    hidden: false,
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: (type) => listeners.delete(type),
  };
  const config = {
    ROUND_DURATION: 30,
    COUNTDOWN_DURATION: 1,
    AUTO_RESET_DURATION: 1,
    ATTRACT_ENABLED: false,
    ...overrides.config,
  };
  const session = {
    hosting: {
      mode: "online",
      transport: "replay",
      admin: false,
      ...overrides.hosting,
    },
    settings: {
      eventName: "Transport test",
      difficulty: "normal",
      roundDuration: 30,
      resetSeconds: 10,
      attractEnabled: false,
      attractIdleSeconds: 45,
    },
    event: { id: "event-one", name: "Transport test", submissionCount: 0 },
    leaderboard: [],
    config,
  };
  const rounds = new Map();
  const request = async (url, body) => {
    if (url === "/api/status") {
      if (statusFails) throw new Error("Test server unavailable");
      return structuredClone(session);
    }
    if (url === "/api/round/start") {
      startCount++;
      if (startResponse) return startResponse;
      const round = {
        ticket: `ticket-${startCount}`,
        seed: 59383 + startCount,
        roundId: `round-${startCount}`,
        config,
        version: REPLAY_VERSION,
      };
      rounds.set(round.ticket, round);
      return round;
    }
    if (url === "/api/leaderboard") {
      latestSubmission = structuredClone(body);
      const round = rounds.get(body.ticket);
      const result = replayRound({
        ...round,
        commands: body.commands,
        ticks: body.ticks,
      });
      return {
        result,
        entry: { name: body.name, score: result.score.total },
        leaderboard: [{ name: body.name, score: result.score.total }],
      };
    }
    throw new Error(`Unexpected request ${url}`);
  };
  const transport = createReplayTransport({
    session,
    request,
    documentRef,
    now: () => clock,
    requestFrame: (fn) => {
      callback = fn;
      return 1;
    },
    cancelFrame: () => {
      callback = null;
    },
    onState: (state) => {
      snapshot = state;
    },
    onConnection: (value) => {
      reachable = value;
    },
    onError: (value) => {
      error = value;
    },
  });
  t.after(() => transport.dispose());
  const frame = (milliseconds = 50) => {
    clock += milliseconds;
    callback(clock);
  };
  const advance = (ticks) => {
    for (let i = 0; i < ticks; i++) frame();
  };
  const finish = () => {
    for (let i = 0; i < 700 && snapshot.phase !== "results"; i++) frame();
    assert.equal(snapshot.phase, "results");
    return structuredClone(snapshot.result);
  };
  return {
    transport,
    frame,
    advance,
    finish,
    session,
    get state() {
      return snapshot;
    },
    get connected() {
      return reachable;
    },
    get error() {
      return error;
    },
    get startCount() {
      return startCount;
    },
    get submission() {
      return latestSubmission;
    },
    set statusFails(value) {
      statusFails = value;
    },
    set startResponse(value) {
      startResponse = value;
    },
    visibility(hidden) {
      documentRef.hidden = hidden;
      listeners.get("visibilitychange")?.();
    },
    async start() {
      transport.send({ type: "start" });
      await settle();
    },
  };
}

test("browser tape reproduces countdown, controls, pauses and complete result exactly", async (t) => {
  const f = fixture(t);
  await f.start();
  f.transport.send({ type: "select", id: "farm" });
  f.transport.send({ type: "power", mode: "low" });
  f.advance(56);
  f.transport.send({
    type: "input",
    x: 1,
    y: 0,
    powerDelta: 0.5,
    stabilize: true,
  });
  f.advance(4);
  f.transport.send({ type: "pause" });
  const elapsed = f.state.elapsed;
  f.advance(120);
  assert.equal(f.state.elapsed, elapsed);
  f.transport.send({ type: "input", x: -1, powerDelta: -1 });
  f.transport.send({ type: "pause" });
  f.advance(6);
  f.transport.send({ type: "select", id: "hospital" });
  f.transport.send({ type: "power", mode: "high" });
  f.advance(20);
  f.transport.send({ type: "power", mode: "medium" });
  const browserResult = f.finish();
  const response = await f.transport.submitResult(
    "Replay operator",
    f.state.roundId,
  );
  assert.deepEqual(response.result, browserResult);
  assert.ok(
    f.submission.commands.every(({ command }) =>
      ["input", "select", "power"].includes(command.type),
    ),
  );
  assert.ok(
    f.submission.commands.some(
      ({ command }) =>
        command.type === "input" &&
        command.x === 0 &&
        command.stabilize === false,
    ),
  );
  assert.equal(
    f.submission.ticks,
    Math.round((browserResult.survivalTime + 1) / 0.05),
  );
});

test("hidden pages pause and release input without advancing or catching up time", async (t) => {
  const f = fixture(t);
  await f.start();
  f.advance(25);
  f.transport.send({ type: "input", x: 1, powerDelta: 1 });
  f.visibility(true);
  const paused = structuredClone(f.state);
  f.frame(60000);
  assert.equal(f.state.phase, "paused");
  assert.equal(f.state.elapsed, paused.elapsed);
  f.visibility(false);
  await settle();
  f.frame(60000);
  assert.equal(f.state.elapsed, paused.elapsed);
  f.transport.send({ type: "pause" });
  f.advance(1);
  assert.equal(f.state.power, paused.power);
  assert.equal(f.state.elapsed, paused.elapsed + 0.05);
  const result = f.finish();
  assert.deepEqual(
    (await f.transport.submitResult("Visibility operator", f.state.roundId))
      .result,
    result,
  );
});

test("only named power modes reach the ranked tape and detent changes preserve their order", async (t) => {
  const f = fixture(t);
  await f.start();
  assert.equal(f.state.powerMode, "low");
  for (const command of [
    { type: "power", value: 0 },
    { type: "power", value: 35 },
    { type: "power", mode: "off" },
    { type: "power", mode: "high", value: 85 },
  ]) f.transport.send(command);
  assert.equal(f.state.powerMode, "low");
  f.transport.send({ type: "power", mode: "medium" });
  assert.equal(f.state.powerMode, "medium");
  f.transport.send({ type: "power", mode: "high" });
  assert.equal(f.state.powerMode, "high");
  f.transport.send({ type: "power", mode: "low" });
  const result = f.finish();
  const response = await f.transport.submitResult("Three detents", f.state.roundId);
  assert.deepEqual(response.result, result);
  assert.deepEqual(f.submission.commands.filter(({ command }) => command.type === "power").map(({ command }) => command), [
    { type: "power", mode: "medium" }, { type: "power", mode: "high" }, { type: "power", mode: "low" },
  ]);
});

test("a stalled animation frame is bounded to 250ms rather than accelerated catchup", async (t) => {
  const f = fixture(t, { config: { COUNTDOWN_DURATION: 0 } });
  await f.start();
  f.frame(60000);
  assert.equal(f.state.elapsed, 0.25);
});

test("finished tape stays immutable and can be submitted after automatic reset", async (t) => {
  const f = fixture(t);
  await f.start();
  const result = f.finish();
  const roundId = f.state.roundId;
  await f.transport.submitResult("First submission", roundId);
  const original = f.submission;
  f.transport.send({ type: "power", mode: "high" });
  f.transport.send({ type: "input", x: 1, powerDelta: 1 });
  f.advance(25);
  assert.equal(f.state.phase, "ready");
  const response = await f.transport.submitResult("Retry submission", roundId);
  assert.deepEqual(f.submission.commands, original.commands);
  assert.equal(f.submission.ticks, original.ticks);
  assert.deepEqual(response.result, result);
});

test("poll failures preserve the active city and prevent another ranked ticket until recovery", async (t) => {
  const f = fixture(t, { config: { COUNTDOWN_DURATION: 0 } });
  await f.start();
  f.statusFails = true;
  await f.transport.refresh();
  assert.equal(f.connected, false);
  f.advance(10);
  assert.ok(f.state.elapsed > 0);
  f.transport.send({ type: "reset" });
  await f.start();
  assert.equal(f.startCount, 1);
  await settle();
  f.statusFails = false;
  await f.transport.refresh();
  assert.equal(f.connected, true);
  await f.start();
  assert.equal(f.startCount, 2);
});

test("event changes clear prior tickets and reset the visitor city", async (t) => {
  const f = fixture(t);
  await f.start();
  f.finish();
  const roundId = f.state.roundId;
  f.transport.updateSession({ event: { id: "event-two", name: "Next event" } });
  assert.equal(f.state.phase, "ready");
  assert.equal(f.state.event.id, "event-two");
  await assert.rejects(
    () => f.transport.submitResult("Old event", roundId),
    /no verified result/,
  );
});

test("public diagnostic commands are ignored and guided practice never requests a ticket", async (t) => {
  const f = fixture(t);
  f.transport.send({ type: "debug", action: "toggle" });
  assert.equal(f.state.debug, false);
  f.transport.send({ type: "practice" });
  f.advance(5);
  assert.equal(f.state.phase, "practice");
  assert.equal(f.startCount, 0);
  await assert.rejects(
    () => f.transport.submitResult("Practice", f.state.roundId),
    /no verified result/,
  );
});

test("reset cancels an in-flight ticket response without starting a stale shift", async (t) => {
  const f = fixture(t);
  let resolve;
  f.startResponse = new Promise((done) => {
    resolve = done;
  });
  f.transport.send({ type: "start" });
  assert.equal(f.state.startingRound, true);
  f.transport.send({ type: "reset" });
  resolve({
    ticket: "late-ticket",
    roundId: "late-round",
    seed: 12,
    config: f.session.config,
    version: REPLAY_VERSION,
  });
  await settle();
  assert.equal(f.state.phase, "ready");
  assert.equal(f.state.startingRound, false);
});

test("rejected mid-round practice commands keep the ranked tape intact", async (t) => {
  const f = fixture(t);
  await f.start();
  f.advance(25);
  f.transport.send({ type: "practice" });
  assert.equal(f.state.phase, "playing");
  const result = f.finish();
  assert.deepEqual(
    (await f.transport.submitResult("Still ranked", f.state.roundId)).result,
    result,
  );
});

test("cosmetic diagnostics toggle keeps ranking, while a debug mutation invalidates it", async (t) => {
  const f = fixture(t, { hosting: { admin: true } });
  await f.start();
  f.transport.send({ type: "debug", action: "toggle" });
  assert.equal(f.state.debug, true);
  const result = f.finish();
  assert.equal(result.practice, false);
  await f.transport.submitResult("Display only", f.state.roundId);
  f.transport.send({ type: "debug", action: "storage", value: 40 });
  assert.equal(f.state.result.practice, true);
  await assert.rejects(
    () => f.transport.submitResult("Changed result", f.state.roundId),
    /no verified result/,
  );
});
