# Exhibition operating guide

LAST LIGHT is an interactive simulation demonstrating the challenge of allocating limited electricity across critical urban infrastructure. It is an educational representation of resource-allocation decisions, not an accurate electrical distribution-network simulation.

The learning connection is **SDG 7: Affordable and Clean Energy** (efficiency and limited supply) and **SDG 11: Sustainable Cities and Communities** (essential urban services and resilience). The score is a game-design choice, not a claim about the worth of people served by each building.

## Table and display

Put the largest available screen at eye level facing the queue. Leave clear space for spectators to see the whole 6 × 6 city and the caption strip. Keep the joystick, knob, and storage bar together in reach; hide and secure the low-voltage wiring and Arduino under the table. Use a large knob with a clear pointer and mechanical stops. A USB cable with strain relief is preferable to a loose hub.

Print `docs/exhibition-labels.svg` landscape, in colour at actual size or scaled to the panel. Cut on the dashed lines. Place **SELECT BUILDING** beside the joystick, **GRID POWER** beside the knob, **GRID STORAGE** beside the LEDs, and the three-colour legend near the screen. The labels also contain words so meaning is not conveyed only by colour.

Keep the optional physical cardboard city for later. The screen and three controls must be stable before adding decoration.

## Opening checklist

- Plug in the laptop's charger. Disable sleep and screen blanking for the event, then restore those preferences afterward.
- Start the production build locally with `npm start`, open `http://127.0.0.1:3001`, and use the browser's full-screen control.
- In **Organizer → Event tools**, save the event name, difficulty, round length, and result-screen time. Use the same difficulty and round length throughout a competition.
- Verify that Wi-Fi can be disabled without affecting the game. Audio, art, code, and records stay local.
- Click or tap the game in the browser once to unlock sound, even if visitors will only use Arduino controls. Physical joystick/knob input alone cannot grant browser audio permission. Use moderate speaker volume: visitors still need to speak and hear the instructions.
- Play one keyboard round. Connect the controller, verify joystick centering and all three knob modes (LOW, MEDIUM, HIGH), and test all reserve LED levels.
- Play one hardware round. Pull and reconnect USB during a practice round; confirm keyboard takeover and then recovery.
- Check name entry, one persistent leaderboard record after refresh, the reset button, and automatic next-player reset.
- Complete the guided residential-area practice: select, match MEDIUM, then return to LOW. Confirm the scored round starts clean and practice does not enter the leaderboard.
- Preview the idle demonstration from Event tools. Confirm its **NO PLAYER · NO SCORE** label is clear and the first human action returns to the ready screen without starting a round.
- Keep a spare USB data cable, a spare mouse/keyboard, and a backup copy of the built project and local data.

The facilitator's entire introduction can be: **“Move to a flashing building. Match LOW, MEDIUM, or HIGH. Protect the reserve, and don't let 27 buildings go dark.”** Let the briefing, self-paced practice, and first ten seconds teach the rest. The practice has no deadline or energy loss; visitors can also skip it and start a clean scored round. A building that misses its deadline stays offline for that round. Avoid revealing a fixed optimal route to first-time players.

## Between players

Give the previous player time to see the human consequences, glance at their decision report, and enter a short name. The report shows excess power cost, essential services lost, and a tip grounded in their choices. Use first names or nicknames only. The result screen advances after the event's configured result time (15 seconds by default); R and the on-screen reset are available if the queue needs to move faster. Do not interrupt a name being typed by pressing gameplay shortcuts.

When the ready screen has been idle for the configured delay (45 seconds by default), the demonstration loops automatically if enabled. It guides spectators through targeting, matching power, wasting energy, and consequences. It adds no leaderboard score. A visitor's first control action wakes the ready screen; they then start their own shift. Keep Organizer closed while previewing the demonstration so it fills the display.

If the controller fails, announce that the keyboard is ready: arrows/WASD move, Q/E adjust power, and Space confirms. Reconnect only when the cable and plug are secure. Organizer calibration and diagnostics are local controls; keep that panel closed on the spectator display during normal play.

## Closing an event and keeping scores

Use **Organizer → Event tools → Export all scores** to download a CSV of every submitted result, including those outside the top ten. The current event name and submission count appear above the settings. Back up the whole local `data` directory after stopping Node, so the current event, calibration, saved settings, and previous archives travel together.

For the next event, finish or reset the active session, enter the new event name, and choose **Review new event**. Check the displayed old/new event names and submission count, then press **Archive & start new event**. The current scores are safely archived before the new empty leaderboard is created. Existing game settings carry forward; revise them before the next competition if needed. **Archived events** offers CSV exports for previous exhibitions. Renaming an event in its settings keeps the same scores; it does not create a fresh leaderboard.

## Required first-time-player test: not yet performed

Software checks cannot replace the requested test with **15–20 people who have never seen the game**. No physical build or human exhibition testing has been performed in this workspace. Use the following sheet and adjust settings only between test batches.

| Player | Understands colour in first 10 s? | Moves/aims unaided? | Chooses matching mode? | Notices reserve? | Reads NPC caption? | Prioritizes essential services? | Result / storage | One comment |
|---|---|---|---|---|---|---|---|---|
| 01 | | | | | | | | |
| 02 | | | | | | | | |
| 03 | | | | | | | | |
| 04 | | | | | | | | |
| 05 | | | | | | | | |
| 06 | | | | | | | | |
| 07 | | | | | | | | |
| 08 | | | | | | | | |
| 09 | | | | | | | | |
| 10 | | | | | | | | |
| 11 | | | | | | | | |
| 12 | | | | | | | | |
| 13 | | | | | | | | |
| 14 | | | | | | | | |
| 15 | | | | | | | | |
| 16 | | | | | | | | |
| 17 | | | | | | | | |
| 18 | | | | | | | | |
| 19 | | | | | | | | |
| 20 | | | | | | | | |

After every five players, note whether the first ten seconds teach, the middle forces choices, and the last ten seconds are demanding without feeling futile. Ask two spectators to describe what the knob and storage do before explaining. Observe from several metres away: if labels or captions cannot be read, increase browser zoom or screen size before adding more animation.

If beginners cannot stabilize even the first building, check calibration and mode labels first, then review stabilization/warning timing. If almost everyone saves everything, increase later-phase pressure gradually. If efficient players collapse as often as constant-HIGH players, retune baseline drain and waste cost separately. Record whether each loss came from empty reserve or the 27-building blackout limit. Retest on the same difficulty and record all changes. Aim for “I could do better” rather than helplessness.

## Reliability rehearsal

Run the final build for at least two hours with repeated rounds. Exercise USB disconnect/reconnect, a locked COM port, malformed serial packets from a test source, browser refresh, Node restart, paused play, exhausted storage, and no name entered. Check that memory stays reasonable, sound cues do not pile up, local scores survive restart, and the next round begins cleanly. Keep a note of software version, difficulty, calibration, LED mode, and any event-day adjustment.
