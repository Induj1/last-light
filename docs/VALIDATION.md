# Validation record

## Application checks

The September 13, 2026 integration run passed **97 Node tests** and the production Vite build. The suite includes a **120-round automated simulation soak**, discrete keyboard and Arduino modes, strict rejection of numeric power commands, permanent building failures, the 26/27-building loss boundary, deterministic replay, event persistence, isolated online visitors, and organizer access.

## Night city update — September 13, 2026

The current public release is **https://last-light-ten.vercel.app**, deployment `dpl_GiiPd4QaghvEm6hSiT4GZ9EmpTER` (READY). Its Linux production build and `node scripts/verify-vercel.mjs https://last-light-ten.vercel.app` passed. The smoke check verifies replay version 2, independent visitor sessions and tickets, the three-mode command contract, database-backed health, organizer access controls, ownership, and origin validation without publishing scores.

Browser checks verified Low/Medium/High buttons, keyboard detents, the MEDIUM→LOW practice sequence, a fresh scored countdown, a 36-block overhead map, and permanent-dark status labels. The warning-light calculation was checked for exactly four outages across 4.5-, 9-, and 15-second deadlines; secured blocks stay lit and failed blocks have zero visible lights. Reduced-motion users receive static warning indicators.

The charcoal interface was inspected at 1366×768 and 390×844. Phone gameplay keeps mode buttons fixed at the bottom, with reserve and blackout counts above the map and no horizontal document overflow. Browser error logs were empty. The laptop's original **Induj — 387** score is preserved.

A signed HARD round in the isolated memory-store preview ended naturally at 53 seconds with exactly 27 failed blocks, nine remaining blocks, 59% reserve, and zero efficiency/survival bonuses. The browser showed the correct 75% blackout explanation. Submitting its `Night QA` result succeeded through the real replay-verification API into the temporary event. No production score or event setting was changed by this test. The run caught and prompted a regression fix for a report tip that recommended returning to LOW even when the entire round had already used LOW.

### Alert clarity and controller follow-up

All 97 JavaScript tests still pass. An isolated frozen browser fixture showed LOW, MEDIUM, and HIGH warnings together: each triangle and continuous border matched its mode exactly (blue `#8bc7f2`, amber `#efc26d`, coral `#ff947f`). The warning overlay remains visible independently of the four lamp outages. Failed blocks showed no warning triangles.

At 1366×768 and 390×844, all 36 service/address labels were present, including unselected and failed blocks. A shrink-to-fit label issue was corrected; desktop labels had no wrapped service names or cell overflow, and compact phone labels stayed visible without document overflow. The browser tutorial included the high-priority service guidance and the mode-color legend, and the hospital dispatch panel showed its 100 priority points. Browser error logs were empty.

The Arduino controller package includes the sketch, printable HTML build guide, circuit SVG, detailed hardware reference, and serial protocol. Three actual Uno-target builds and five simulated firmware configurations passed; no physical board was connected or flashed. The guide was audited against the current controller UI, including saving calibration before closing Organizer and testing in practice. The unknown LED module stays disabled by default.

The six-file ZIP passed its explicit allowlist, CRC, and byte-for-byte source checks. The final Vite build included the public downloads. After production deployment, all eight public download paths returned HTTP 200 and matched their reviewed local files by SHA-256, including the ZIP, guide, SVG, and sketch. The live browser loaded the new `index-BhwNTHYj.js` bundle, displayed 36 labels and the controller download link, and reported no console errors. The printable guide and circuit were visually checked. Temporary preview servers were stopped; the regular local engine and Vite servers remained running.

The sections below are historical checks from the previous release; numeric-power and farm-practice references describe that earlier version.

## Vercel edition checks

The actual Vercel production build succeeded with Node 22, including its packaged Express Function. Inspecting generated routes caught that a plain Node file named `[...route].js` only matched one URL segment in this configuration. The entry is now `api/index.js` with an explicit `/api/:path*` rewrite; the generated route handles nested round and organizer endpoints. A Windows CLI PATH-casing problem was resolved for local packaging by passing an uppercase `PATH` key to the child CLI process. The normal Vite build also passes.

Replay tests compare complete canonical results across seeded engines, including same-tick input order, countdown and active pauses, early collapse, NPC randomness, malformed controls, incomplete rounds, and bounded replay work. Browser transport tests exercise fixed-step timing, hidden-page pauses, stalled frames, retained completed tapes, reconnection, event resets, pending-start cancellation, and debug eligibility. API tests use an explicit test-only Redis adapter through the real REST transport. They cover signed visitor ownership, changed tickets, insufficient elapsed time, concurrent duplicate claims across Function instances, rate limits, revoked admin sessions, settings concurrency, archives containing more than ten scores, CSV escaping, and fail-closed configuration.

Browser verification at `http://127.0.0.1:3004` used the actual Vercel API with the isolated local test adapter. Organizer login, 30-second event timing, a 60-second results window, disabling idle demo, and sign-out worked. Guided practice skipped into a fresh signed countdown. A real browser round rescued the farm, paused at 14 seconds remaining, resumed, and finished with **219 points**. The server replay accepted that tape and published **Vercel QA — 219** only in the temporary test event. A second tab sharing the browser cookie retained its own ready city with 100% reserve. Browser error logs were empty.

`node scripts/verify-vercel.mjs http://127.0.0.1:3004` passed. Packaging inspection found no local data, test fixtures, Arduino files, or environment files in the Function/static output. The original laptop leaderboard still contains **Induj — 387**.

Live Upstash verification also passed using the actual Lua scripts against a unique QA namespace: concurrent initialization, settings CAS conflicts, exactly-once duplicate claims, 13 durable scores and a top-ten view, complete archives, rejection of old-event submissions, CSV escaping, concurrent rate limits with expiry, and organizer binding/revocation. All nine tracked QA keys were deleted and verified absent afterward. The production namespace was not initialized or read. The reusable check and its scope are documented in `docs/REDIS-VERIFICATION.md`.

The game is deployed at **https://last-light-ten.vercel.app**, with production deployment `dpl_6F1xgivwCLe1rCDxs34ximTu1bTB` in READY state. After explicit user approval, both generated game secrets were configured as sensitive production variables. The remote Linux build passed. The `last-light-scores` Upstash Free resource is connected with paid auto-upgrades disabled.

The black-box Vercel smoke script passed against the public HTTPS domain without Vercel authentication. It verified database-backed health, signed visitor cookies, independent round tickets, cross-visitor ownership rejection, nested API routing, protected organizer endpoints, and cross-origin rejection. A separate live organizer check passed password login, read-only settings/history/CSV access, logout, and rejection of the revoked cookie. That check changed no settings, events, or scores.

A full 60-second production browser round passed the briefing, practice-skip, signed start, targeting, power controls, results report, and score submission. It rescued two buildings and produced **274 points**, with 64% reserve remaining. A fresh HTTPS session read the persisted `Launch QA 6F1x` score with the same 274-point result. The exact test entry and ranking member were then removed atomically after verifying its unique entry ID, round ID, name, and claim. Its duplicate-submission tombstone was preserved; no event settings or other scores were changed. Browser error logs were empty.

## Hosted edition checks

The hosted server was verified locally on port 3003 using only `test-results/hosted-preview`. All seven hosted tests passed: isolated sessions and reload/pause, authoritative result ownership, public organizer denial, login/logout and event operations, settings deferral, origin validation, secure cookies, and connection/session bounds. Authentication rotates the browser cookie and rejects previously authenticated WebSocket connections until they reconnect with the new cookie. Login attempts are bounded globally and per IP.

`node scripts/verify-hosted.mjs http://127.0.0.1:3003` passed against the final restarted server. It established two independent visitor sessions, verified one visitor's practice/select/start/reset did not change the other's city, checked organizer-only routes and foreign-origin rejection, and submitted no scores.

Browser checks verified the public online status, first-visit briefing, practice skip into a scored round, public-nickname disclosure, and a 150-point `Online QA` submission in the isolated test event. That score persisted across a server restart. Organizer login opened only Event tools and Game & diagnostics, saved test timing, reconnected successfully after cookie rotation, and lost access on sign-out. The original local Induj score remained 387.

The Railway configuration was checked against its current documented/schema fields. A Docker build could not be run locally because Docker is unavailable. Railway project creation returned “Your trial has expired. Please select a plan to continue using Railway.” No remote project or production URL was created, and remote container startup, HTTPS, and volume persistence have not yet been verified. See `docs/HOSTING.md` for deployment and post-deployment checks.

## Local exhibition checks

Browser verification of the extensions used a separate development data directory. Guided practice completed farm selection, a 35% efficient hold, and output release while retaining 100% reserve; its scored start and skip path both produced a clean countdown. Practice fit a **1366 × 768** viewport with every city tile and essential control visible. Practice and automatic demo also retained all 36 cells with no horizontal overflow at **390 pixels** wide.

The idle demonstration started without player input, its organizer preview closed the console, and both Space and pointer input woke it to ready without starting a round. Browser review and independent input-code review prompted fixes for held waking keys, pointer gesture consumption, blur cleanup, F2 repeat, and audio unlocking. Automated transport tests cover neutral hardware packets and ownership transfer.

The Event tools form saved a test event name, 30-second round, 60-second result screen, and 15-second idle threshold. Settings were locked during a paused round. A normal 30-second browser round produced a 234-point result, identified the lost water pump, and displayed 85.0 reserve points consumed as 17.3 demand + 61.3 output + 3.9 waste + 2.5 stabilization. The expandable breakdown kept idle output separate from the additive energy categories. A saved QA score appeared in the isolated event; the archive confirmation created a fresh empty leaderboard, and the archived CSV retained that score and report metrics. A further engine regression ensures coaching prefers turning down output when energy spent between rescues substantially exceeds overpower waste. No extension test score or fresh-event action touched the live exhibition data directory.

The completed production build was opened at `http://127.0.0.1:3001` with no browser console errors. The live v1 score file migrated to v2 with an original-file backup; every entry field matched the backup, including Induj's 387-point score. Production event settings retained the normal 60-second round, 15-second result screen, and 45-second idle demo. Development servers were stopped after verification.

Browser testing exercised keyboard and mouse controls, a natural first farm rescue earning 70 priority points, a hospital rescue at 85% supplied power, and a school reaching its failure deadline with the corresponding offline NPC response. The active game layout was checked at **1366 × 768**; the essential gameplay controls and city remained visible.

Further browser checks verified a grid collapse at 26.2 seconds, a 70-point result with zero efficiency/survival bonuses, local score submission, persistence across browser refresh, and the leaderboard dismissing automatically for the next ready state. Organizer difficulty selection, storage override, and NPC commands also worked. The deliberate test score was removed afterward; the existing player entry was retained.

The mute preference persisted through refresh and was restored to sound enabled after testing. All nine WAV files were successfully served by the production server (HTTP 200); actual speaker loudness and acoustic clarity require the venue check. The final production build loaded in the browser at `http://127.0.0.1:3001`, with 36 city blocks and the Node engine ready. Its health endpoint and persisted leaderboard were verified after restarting from development to production. A 390-pixel viewport retained all 36 grid cells without horizontal page overflow. Browser console checks found no application errors before the intentional development-server shutdown.

This is software verification. The automated 120-round simulation is not a real-time hardware endurance test or a study with human players.

The optional Windows launcher passed PowerShell syntax validation and a `-NoBrowser` smoke test on an isolated port with temporary data: `/api/health` was valid and the built production HTML was served. A second invocation correctly refused the occupied port without replacing the running server. Browser auto-opening and physical-console Ctrl+C behavior should be checked on the event laptop; this smoke test did not verify them.

## Firmware build checks

The provided `arduino/LastLight/LastLight.ino` was compiled with the official Arduino AVR toolchain for `arduino:avr:uno`. Toolchain installation and builds were isolated under a temporary directory; no board was flashed during verification.

- Arduino CLI: **1.5.2-rc.1** (the official latest download returned this version during this session)
- Arduino AVR Boards: **1.8.8**
- AVR GCC: **7.3.0-atmel3.6.1-arduino7**
- Optional LCD library: **hd44780 1.3.2**

| Build | Flash | Static RAM | Result |
|---|---:|---:|---|
| Default: LED mode 0, LCD off | 4,894 / 32,256 bytes | 489 / 2,048 bytes | Passed |
| Direct 10-segment LED, LCD off | 5,094 / 32,256 bytes | 500 / 2,048 bytes | Passed |
| Two 74HC595s, 16 segments, I2C LCD on | 10,808 / 32,256 bytes | 870 / 2,048 bytes | Passed |

The `--warnings all` output included unused-parameter warnings inside the upstream AVR core's `new.cpp`, with no sketch errors. Memory numbers reflect these exact versions and build switches; different compiler versions may change the totals.

## Firmware behavior checks

`arduino/tests/firmware.test.cpp` includes the actual production sketch and supplies only fake physical Arduino/Serial functions. Five configurations passed: disabled, direct active-HIGH, direct active-LOW, 16-segment shift-register active-HIGH, and 16-segment shift-register active-LOW.

Assertions cover correct reserve endpoints/quantization, 100% across all 16 shift-register bits, rejection of invalid and out-of-range commands, CRLF, bounded per-loop receive work, overlong-line and embedded-NUL recovery, partial UART writes under backpressure, button debounce, host timeout blanking, and recovery after a fresh command. The fake I/O tests do not model actual current, USB timing, noise, or an I2C bus. LCD code was verified by the real AVR compile above.

Re-run on Windows with a C++17-capable `g++` in PATH:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File arduino/tests/run.ps1
```

Real-board build, after installing the AVR core in your own Arduino environment:

```text
arduino-cli compile --fqbn arduino:avr:uno arduino/LastLight
```

For alternate builds, change the documented switches in the sketch, or use compiler flags such as `--build-property "compiler.cpp.extra_flags=-DLASTLIGHT_LED_MODE=2 -DLASTLIGHT_LED_SEGMENTS=16 -DLASTLIGHT_LCD_ENABLED=1"` after installing the hd44780 library. Keep the correct physical mode selected when uploading.

## Audio and printable assets

Nine original WAV cues were generated locally from `scripts/generate-audio.mjs`, with RIFF/WAVE headers, mono signed 16-bit PCM, and a sample rate of 22,050 Hz. The generation has no network dependency. Both printable SVGs were parsed as XML, raster-rendered, and visually checked; a label overlap was corrected.

## Remaining real-world checks

No actual LED module was available for identification. No UNO, joystick, knob, LCD, LED bar, or speaker was physically connected during these checks. The unknown LED adapter remains disabled by default. The physical 15–20-player study and venue-duration rehearsal remain to be completed using `docs/EXHIBITION.md`. Compilation and simulated I/O are useful evidence, but do not establish electrical compatibility or exhibition readiness of an unassembled controller.

Re-run the JavaScript game and transport checks with `npm test`, and the frontend build with `npm run build`, after changing the application. This record intentionally does not claim a human playtest or a hardware soak test.
