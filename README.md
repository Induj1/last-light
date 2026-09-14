# LAST LIGHT

**Keep the city alive.** A complete local React + Node exhibition game about allocating a limited electricity reserve across a 6 × 6 city. The default round lasts 60 seconds: move the spotlight, match a flashing building's LOW, MEDIUM, or HIGH power requirement, protect essential services, and leave some energy for the end. Losing 27 of the 36 buildings causes an immediate city blackout.

The project supports keyboard/mouse immediately, an Arduino UNO joystick and knob, persistent local scores, local audio, and an organizer console. The existing LED bar's model is **not yet known**, so the firmware ships with its LED adapter disabled. The on-screen reserve works throughout; two fully implemented bare-LED circuit options are documented for when the hardware has been identified.

## Start here

Play the public Vercel edition at **[last-light-ten.vercel.app](https://last-light-ten.vercel.app)**. Each visitor has an independent city and can publish a verified score to the shared event leaderboard.

Build the physical controller with the [Arduino sketch and wiring ZIP](public/downloads/last-light-controller.zip) and [step-by-step controller guide](docs/BUILD-CONTROLLER.md). A [printable browser guide](public/downloads/build-controller.html) is included. The Arduino uses the local Node application for USB communication; the public Vercel page supports browser controls.

For a public link with independent games and a shared online leaderboard, see [the hosted edition guide](docs/HOSTING.md). The commands below run the local Arduino exhibition edition.

Install Node.js 22 or newer on the exhibition laptop. In this folder, run:

```powershell
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. The development command starts Node on port **3001** and Vite on **5173**; Vite forwards API and WebSocket traffic to Node. Use the URL printed by Vite if 5173 is occupied. Keep the terminal running. No Arduino is needed.

For the exhibition, prepare and run the production build:

```powershell
npm run build
npm start
```

Open **http://127.0.0.1:3001**. Stop a previous development server with Ctrl+C before starting production so port 3001 is free. Do not open `index.html` or the built HTML directly from disk: Node must run the authoritative simulation.

On Windows, an optional launcher prepares missing dependencies/build files, starts the local server in the terminal, and opens the game in your default browser when it is ready:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-exhibition.ps1
```

It installs dependencies only when `node_modules` is missing, and builds only when `dist/index.html` is missing. After editing the source, run `npm run build` yourself to refresh an existing build. The first dependency installation needs internet; a prepared exhibition runs offline. Keep the launcher window open and press Ctrl+C to stop. Add `-NoBrowser` to start only the server. The launcher reports a busy port without stopping another program.

After the one-time dependency installation and build, these commands work without internet. All art is local SVG/CSS, all sound is local WAV, and all data is local JSON. There are no CDN scripts, web fonts, cloud APIs, or online audio dependencies. Keep `node_modules`, `dist`, `server`, `shared`, `package.json`, and `data` together on the prepared laptop. A different OS/architecture may require reinstalling native SerialPort dependencies while online.

Click or tap the browser once during setup to allow local audio playback before handing over an Arduino-only controller. Browser sound permission still requires a browser interaction; turning a physical knob alone does not grant it.

## Play without hardware

| Action | Keyboard | Mouse / screen |
|---|---|---|
| Choose a building | Arrows or WASD | Click a city block |
| Set power | Q steps down, E steps up; hold to repeat | Choose LOW, MEDIUM, or HIGH |
| Start / confirm | Space | Start button |
| Stabilize | Hold sufficient power on the target | Automatic while aimed and powered |
| Pause / resume | P | Pause / Resume |
| Reset for the next player | R | Reset / New shift |
| Organizer console | F2 | Gear icon |
| Full screen | Browser full screen | Full-screen icon |

Space remains available as the select/stabilize control; stabilization does not require holding an additional button. Give the target enough power and keep aiming for roughly one second. Its required mode appears beside its name. **Blue = LOW, amber = MEDIUM, coral = HIGH.** Text accompanies colour. Every shift starts at LOW, and there is no OFF setting or continuously adjustable percentage.

A hospital requiring HIGH needs HIGH. A LOW-demand building can also be rescued with MEDIUM or HIGH, but matching LOW uses less reserve. Output remains live between targets, so return to LOW after a rescue when possible. Switching away or choosing a mode below the requirement resets the stabilization hold. A missed deadline takes that building offline permanently for the rest of the round; it cannot be rescued or restored. The round ends immediately when **27 buildings are lost (75% of the city)**, even if reserve remains, or when storage reaches zero. Completing the timer before either failure condition counts as survival. After results, name entry, and the top ten, the game returns to the next player automatically after the configured result time (15 seconds by default).

## Practice and the idle demonstration

On the first visit in a browser, **Begin shift** opens a short briefing. **Try the controls** starts a self-paced, unscored practice: select the residential area, hold **MEDIUM** for about a second, then return to **LOW**. There is no failure deadline or reserve drain during this lesson. Complete it or choose **Skip practice** to begin a clean scored countdown. Practice never adds a leaderboard record.

While the ready screen is unattended, a labelled **NO PLAYER · NO SCORE** demonstration shows the spotlight, power matching, waste, and service consequences. It starts after 45 idle seconds by default and loops without recording a score. The first human control action wakes the ready screen and is consumed; it does not accidentally start a scored round. Start a shift when ready. Opening Organizer keeps the idle demonstration from starting while settings are being edited.

The results screen includes a decision report: reserve used, excess-power waste, critical services lost, output spent between rescues, and a practical tip based on that round. The energy breakdown separates normal demand, delivered output, excess-power penalty, and rescue energy. “Output between rescues” is already included in delivered output, so it must not be added again. These are game reserve units (percentage points), not measured kWh.

## Connect the physical controls

Read [the hardware and calibration guide](docs/HARDWARE.md), then open [the printable wiring diagram](docs/wiring.svg).

1. Upload `arduino/LastLight/LastLight.ino` with Arduino IDE, board **Arduino Uno**. Keep LED mode 0 until your LED hardware is identified. Optional LCD is also off by default.
2. Connect joystick X→A0, Y→A1, potentiometer wiper→A2, and switch→D2. The joystick, potentiometer, and Arduino share GND and the verified 5 V supply.
3. Verify JSON input at **115200 baud** in Serial Monitor, then close Serial Monitor.
4. Open Organizer, choose the enumerated COM port, connect, and calibrate joystick center/deadzone and potentiometer endpoints. Calibration is saved in `data/controller.json`.
5. Once a supported LED circuit has been positively identified, select its firmware adapter and segment count, upload, reconnect, and test 0/25/50/75/100% in Organizer.

The Arduino emits 25 input packets per second. Node sends authoritative storage back at up to 10 Hz and optional LCD rows at up to 1 Hz. See [the complete serial protocol](docs/SERIAL_PROTOCOL.md). Losing hardware input for a second activates keyboard fallback. The selected port is retried every two seconds while the server is running; choose it again if the operating system assigns a new name. The physical bar blanks if host reserve messages stop for five seconds.

## Rules and balance

Every map block keeps its service label and grid address visible. An impending failure shows a steady triangle and border in the required mode's color: blue LOW, amber MEDIUM, or coral HIGH. These alerts stay visible while the building lights blink four times. White corner marks identify the selected target. The tutorial recommends protecting high-priority services first, and the dispatch panel shows each selected building's priority points.

The five failure phases introduce easy LOW-demand requests, then competing hospital/school requests, then larger simultaneous waves. Candidate selection is weighted, with subtle peripheral instability, increased pressure on critical services late in the round, and a higher probability of renewed trouble in recently rescued buildings after a short grace period. This is controlled probability, not a fixed route or unrestricted random failure spam.

The storage calculation combines the sum of non-failed buildings' demand, the selected target's consumption coefficient, supplied output over time, choosing a mode above the requirement, difficulty, and a small rescue cost. HIGH output has a nonlinear delivery cost. Failed buildings stop drawing normal demand, but each loss moves the city closer to the 27-building blackout limit. The three modes use internal accounting levels of 35, 60, and 85; those numbers are not player-selectable percentages. There is no emergency-power or crowd-demand mechanic.

```text
FINAL SCORE = UNIQUE RESCUE PRIORITY
            + CRITICAL SERVICE BONUS
            + STORAGE EFFICIENCY BONUS
            + ROUND SURVIVAL BONUS
```

The first successful rescue of each building earns its configured priority. Rescuing it again does not farm more priority points; those earned points remain even if it fails later. Each actively rescued critical service still online at the end adds 25 by default. The efficiency bonus is `round(storage remaining × 0.6)`, capped by the 0–100% reserve, and only applies when the city survives. Completing the round adds 100. Collapse gets neither efficiency nor survival bonus. “Rescued” counts buildings actively stabilized; the result's online/offline list shows the final service state, including services that never needed rescue.

NPC captions are selected from actual demand, deadline urgency, priority, ignored duration, recent losses, and reserve thresholds. They express consequences rather than giving score instructions. Captions appear one at a time and become more frequent near the end. Critical losses and critical reserve can interrupt the normal cadence. Results include reactions to the final city state.

## Tune without editing the engine

Open **Organizer → Event tools** to change the event name, easy/normal/hard difficulty, round length (30–180 seconds), result-screen time (10–60 seconds), idle demonstration switch, and idle delay (15–300 seconds). **Save event settings** persists them on the laptop and applies them to the next shift. The quick difficulty buttons in **Game & diagnostics** use the same saved settings. Editing is available between rounds, including after results; finish or reset a playing, paused, countdown, or practice session first. **Preview demonstration** closes the console and starts the labelled demonstration immediately.

Keep one difficulty and round length for a competition: the leaderboard ranks all submitted rounds by final score. Saving a new event name renames the current event while keeping its scores. To create an empty leaderboard with an archived previous event, use the separate workflow below.

For advanced balance changes, edit the data files below, restart Node, and rebuild the frontend. The saved Organizer settings take precedence for event difficulty, round length, result delay, and idle demo behavior.

| File | Controls |
|---|---|
| `shared/config.js` | Advanced warning/stabilization durations, reserve costs, scoring bonuses, NPC frequency, difficulty multipliers, failure phase timings |
| `shared/blocks.js` | 36-cell layout; each building's name, type, priority, required power mode, consumption, failure weight, NPC, critical flag |
| `shared/power.js` | Three power modes, their internal accounting levels, and mode comparisons |
| `shared/npcs.js` | Character identities and context-specific dialogue |
| `arduino/LastLight/LastLight.ino` | LED adapter, segment count, polarity, optional LCD enable/address |

The main configuration values include `ROUND_DURATION`, `INITIAL_STORAGE`, `WARNING_DURATION`, `MAX_ACTIVE_WARNINGS`, `FAILURE_ACCELERATION`, `POWER_REPEAT_INTERVAL`, `STORAGE_DRAIN_RATE`, `POWER_OUTPUT_DRAIN`, `OVERPOWER_PENALTY`, `SURVIVAL_BONUS`, `DIFFICULTY`, `NPC_MESSAGE_INTERVAL`, and `CRITICAL_STORAGE_THRESHOLD`. Durations use seconds, storage uses 0–100%, and power is one of three named modes. The city-loss ratio stays fixed at 75%. The five `FAILURE_PHASES` times scale proportionally when the round length changes.

Open Organizer with F2 or the gear. Diagnostics show time, reserve, load, supplied power, current target, required power, warnings, score, serial connection, and rendering FPS. Enable debug controls for these shortcuts:

| Shortcut | Debug action |
|---|---|
| F | Fail the selected building |
| G | Clear a warning on a building that has not failed; failed buildings stay offline |
| B | Start a warning on the selected building |
| N | Trigger a contextual NPC caption |
| [ / ] | Decrease / increase reserve by ten |
| Q / E | Step down / up through LOW, MEDIUM, HIGH |
| P / R | Pause / reset |
| F2 | Open console for difficulty, controller calibration, and LED tests |

The console provides buttons as well as shortcuts. Game-changing debug actions mark that round as **practice**, and practice results cannot be submitted. Diagnostics alone do not award points. Close the console and resume after testing; reset to start a clean scored round.

## Export scores and start a fresh event

**Organizer → Event tools → Export all scores** downloads a CSV containing every submitted score for the current event, including entries outside the displayed top ten. It includes the event identity, player, score components, storage, critical saved/lost counts, survival time, difficulty, and available decision-report energy metrics. An event with no submissions exports the column headings.

To start a new exhibition, enter its name under **Start a fresh event**, click **Review new event**, and read the inline summary. **Archive & start new event** saves the complete current event before opening an empty leaderboard. The current saved game settings carry forward. No old scores are deleted. Open **Archived events** to download a previous event's CSV. This action is disabled while a scored or practice session is active, including when paused.

## Local persistence and server settings

Node stores **all event submissions** and displays the top ten. Each record includes name, final score, priority score, critical bonus, efficiency bonus, survival bonus, storage, rescued count, critical saved/lost counts, survival time, difficulty, timestamp, and available decision-report metrics. Ties use reserve remaining, then the earlier submission. The browser submits a round ID and name; the server supplies the score and rejects duplicate, expired, practice, or previous-event submissions. Writes are queued and replaced atomically. Existing saved leaderboard entries are retained during the version upgrade, with a backup of the original file. Malformed data is preserved with a `.corrupt-...` suffix rather than silently overwritten.

`data/leaderboard.json` holds the current event and every submitted score; `data/event-settings.json` mirrors its settings; `data/controller.json` holds calibration. Archived event files live under `data/events/`. The event ledger carries the authoritative matching settings so an interrupted mirror write can recover on restart. Stop Node before backing up or editing these files, and back up the **whole data directory** to include archives. Use a writable local folder. The Organizer workflow handles a fresh event without manually moving or deleting data files.

`PORT` overrides production port 3001. `LAST_LIGHT_DATA_DIR` selects another local persistence directory. For example:

```powershell
$env:PORT = '3002'
$env:LAST_LIGHT_DATA_DIR = 'C:\LastLightEventData'
npm start
```

These shell variables affect only that terminal session. The development proxy in `vite.config.js` targets 3001, so retain that port for the standard `npm run dev` command. The server binds to **127.0.0.1** and accepts local browser origins. It is intended for one laptop and one active operator; a second browser can watch, but cannot take over controls until the active display disconnects. No internet-facing deployment or cloud service is required.

## Verify and rehearse

```powershell
npm test
npm run build
```

The Node tests exercise simulation deadlines, discrete power modes, priority scoring, reserve exhaustion, the 27-building blackout boundary, permanent building losses, escalating concurrent demands, keyboard commands, serial validation/reconnect behavior, local persistence, HTTP/WebSocket contracts, and deterministic score replay. `npm test` runs `node --test tests/*.test.js`. Optional firmware tests run the actual `.ino` against host-side I/O doubles; with `g++` installed run `powershell -NoProfile -ExecutionPolicy Bypass -File arduino/tests/run.ps1`.

The firmware was also compiled for UNO R3 with the real AVR toolchain in disabled, direct LED, and 16-segment 74HC595 + I2C LCD configurations. This verifies build and memory fit, not electrical assembly. Read [the validation record](docs/VALIDATION.md) for firmware versions, memory use, and remaining physical checks.

The required **15–20 first-time-player exhibition test has not yet been performed**. [The exhibition guide](docs/EXHIBITION.md) includes the observation sheet, setup checklist, reliability rehearsal, and balance questions. Physical hardware, speaker level, venue readability, and long-duration operation need verification on the event laptop and assembled controls.

## Troubleshooting

| Symptom | Action |
|---|---|
| Blank page or “server is ready” text | For development open Vite's 5173 URL; for production run `npm run build`, then `npm start`, and open 3001 |
| `EADDRINUSE` / port 3001 busy | Stop the earlier LAST LIGHT process with Ctrl+C; use one Node server |
| Browser shows connecting | Check Node is running, reload the local URL, and inspect the terminal; Vite alone cannot simulate a round |
| No sound | Click Start or the sound icon, unmute the game/browser/system, and verify the speaker output device |
| No Arduino port | Use a USB **data** cable, verify UNO appears in the OS/Arduino IDE, and install the board's USB driver if required |
| Port busy or access denied | Close Arduino Serial Monitor, IDE plotter, and other applications holding the COM port, then reconnect |
| Controller connected but no input | Confirm board/port, upload the provided sketch, use 115200 baud, and allow UNO reset to finish |
| Cursor drifts / runs backwards | Calibrate stable centers and deadzone; use Invert Y or correct the physical module orientation |
| Knob cannot reach LOW or HIGH | Calibrate its measured endpoints; check the wiper is on A2 and both outer terminals are wired correctly |
| LEDs stay off | Check firmware LED mode first; mode 0 is deliberately disabled. Follow the verified adapter wiring and resistor/polarity checks |
| LED test jumps back | Expected: Organizer's test override lasts three seconds, then live game reserve returns |
| LCD blank | Verify compatible backpack, library, power, A4/A5, contrast, and detected address; run `I2CexpDiag` |
| Scores fail to save | Enter a name, submit before expiry, avoid practice/duplicate rounds, and confirm the data directory is writable |
| Event settings or new-event button disabled | Finish or reset the active practice, countdown, playing, or paused session; exports remain available |
| Demo starts while waiting | Expected when the idle demonstration is enabled; touch a control to wake, or change the switch/delay in Event tools |
| Keys do nothing after clicking a control | Click the game background or finish editing the focused control; shortcuts are suppressed in text fields and dialogs |
| Another display has control | Close the earlier active tab; the remaining display can then become the operator |

## Folder map

```text
last-light/
├── arduino/
│   ├── LastLight/LastLight.ino      # UNO firmware and configurable LED/LCD adapters
│   └── tests/                       # Actual firmware behavior tests with fake I/O
├── docs/
│   ├── HARDWARE.md                  # Pin mapping, assembly, calibration, LED/LCD setup
│   ├── SERIAL_PROTOCOL.md
│   ├── EXHIBITION.md                # Event checklist and 20-player observation sheet
│   ├── VALIDATION.md
│   ├── wiring.svg                   # Printable A3 technical diagram
│   └── exhibition-labels.svg        # Printable A3 control labels and colour legend
├── public/
│   ├── audio/*.wav                  # Nine original local synthesized cues
│   └── favicon.svg
├── scripts/
│   ├── generate-audio.mjs           # Regenerate WAV assets with npm run audio
│   └── start-exhibition.ps1         # Optional Windows launcher
├── server/
│   ├── index.js                     # Local HTTP + WebSocket server, input authority
│   ├── engine.js                    # State, timing, failures, storage, score, NPCs
│   ├── serial.js                    # Serial transport, fallback, calibration, outputs
│   ├── leaderboard.js               # Validated local score persistence
│   └── settings.js                  # Validated event settings and recovery mirror
├── shared/
│   ├── blocks.js                    # City data
│   ├── config.js                    # Balance and difficulty
│   └── npcs.js                      # Characters and contextual lines
├── src/
│   ├── App.jsx                      # Control room, city, tutorial, results, leaderboard
│   ├── BuildingArt.jsx              # Local vector buildings and NPC portraits
│   ├── Organizer.jsx                # Organizer controls and hardware diagnostics
│   ├── organizer.css                # Event tools styles
│   ├── useGame.js                   # WebSocket state and local sound playback
│   ├── main.jsx
│   └── styles.css
├── tests/                           # Node simulation/transport/persistence tests
├── data/                            # Runtime local records (created automatically)
├── dist/                            # Production assets (npm run build)
├── index.html
├── package.json
├── package-lock.json
├── vite.config.js
└── README.md
```

LAST LIGHT connects to **SDG 7** through efficient use of limited energy and **SDG 11** through resilient urban services. It is an educational resource-allocation game, not an accurate simulation of a real electrical distribution network.

**When energy is limited, every decision has a cost.**
