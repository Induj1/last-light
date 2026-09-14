# Public hosted edition

`npm run start:hosted` runs the online edition. Each visitor receives an independent, server-controlled city. Scores belong to a shared online event and persist on the host's data volume. The existing `npm start` command continues to run the local Arduino exhibition edition.

The public edition has the same practice, simulation, sound, decision reports, and idle demonstration. Organizer settings, diagnostics, event archives, and CSV exports require the organizer password. Physical Arduino controls belong to the local edition; the remote host cannot access a USB device attached to a visitor's computer.

## Vercel deployment

The production game is live at **https://last-light-ten.vercel.app**. Project: `induj1s-projects/last-light`. Initial production deployment: `dpl_6F1xgivwCLe1rCDxs34ximTu1bTB`. The organizer password and session-signing key are configured as sensitive production variables; the private local organizer note is `test-results/VERCEL-ORGANIZER.txt`.

The Vercel edition serves the React build with a Node Function at `api/index.js`; an explicit `/api/:path*` rewrite routes nested API endpoints to Express. Each browser tab runs an independent city at fixed 50 ms steps. The Function issues a signed round ticket, replays the recorded controls when a score is submitted, and calculates the result itself. Redis atomically records each round once and stores the shared leaderboard, settings, event archives, and organizer sessions. No game loop or WebSocket server runs inside a Function.

Practice, the idle demonstration, and diagnostics run in the browser and cannot publish scores. Hiding the page pauses an active city and releases held controls; returning lets the player resume. Reloading closes that tab's unfinished game. Submitted scores survive browser reloads and Vercel deployments. Each new scored shift fetches the current event settings. New-event changes reach other open pages on their next status refresh, within approximately 15 seconds, and the server immediately rejects submissions for the previous event.

The signed replay checks legal game inputs and derives a valid score; it does not prove that a human supplied those inputs. The server rejects changed tickets, another visitor's ticket, incomplete or oversized tapes, submissions made before sufficient wall time elapsed, and repeated score claims.

Scored power commands use `{ "type": "power", "mode": "low" }`, with `medium` and `high` as the other choices. Numeric power payloads are invalid. The replay version is `last-light-replay-v2-three-modes`; refreshing a page after a mechanics release loads the matching engine before another scored shift. Both browser simulation and server replay enforce permanent building losses and immediate blackout at 27 of 36 failed buildings, independently of reserve remaining. A result distinguishes `city_blackout`, `reserve_empty`, and `shift_complete` through `endReason`.

Required production environment variables:

| Variable | Purpose |
|---|---|
| `KV_REST_API_URL` and `KV_REST_API_TOKEN` | Upstash Redis REST credentials supplied by the Vercel integration |
| `LAST_LIGHT_SESSION_SECRET` | A private random signing key, at least 32 characters |
| `LAST_LIGHT_ADMIN_PASSWORD` | A private organizer password, at least 16 characters |
| `LAST_LIGHT_REDIS_PREFIX` | Optional namespace; default `{last-light}:v1` |

`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are accepted as alternative Redis names. Keep these values in server environment variables, never `VITE_*` variables. Missing or unavailable storage returns a clear error; there is no temporary in-memory leaderboard fallback.

The workspace is linked to the dedicated **last-light** project under **induj1s-projects**. The project uses Node 22 and public access. The **last-light-scores** Upstash resource is provisioned and connected to production on the Free plan, with auto-upgrades, eviction, and the paid production package disabled. The account owner has accepted the marketplace terms. Do not substitute a paid plan without approval.

For a fresh setup after accepting terms, the provisioning command is:

```powershell
vercel integration add upstash/upstash-kv --name last-light-scores --plan free --metadata primaryRegion=iad1 --metadata autoUpgrade=false --metadata eviction=false --metadata prodPack=false --environment production --no-env-pull --scope induj1s-projects
```

Reuse an existing `last-light-scores` resource if it has already been created. Configure the two private game secrets as sensitive production variables, then validate and publish:

```powershell
npm test
npm run build
vercel --prod --yes --scope induj1s-projects
node scripts/verify-vercel.mjs https://last-light-ten.vercel.app
```

The smoke check creates two temporary visitor identities, verifies independent round tickets and protected routes, and publishes no scores. Complete a real browser round and organizer check after release. Use a separate Redis prefix and event for any tests that submit or archive scores. Preview deployments also need their own configured secrets and isolated database namespace; the production-only integration is not automatically available there.

`.vercelignore` excludes laptop scores, test outputs, environment files, Arduino code, and documentation from uploads. Public scores start with a new online event; laptop data is never imported. The generated organizer credential is kept locally in `test-results/VERCEL-ORGANIZER.txt`, which is excluded from deployment and version control.

Vercel references: [Function limits](https://vercel.com/docs/limits), [marketplace storage](https://vercel.com/docs/marketplace-storage), and [integration CLI](https://vercel.com/docs/cli/integration).

## Railway / persistent Node deployment

The repository also contains a production `Dockerfile` and `railway.json` for a persistent Node host. Railway must have an active plan that permits creating a service and attaching a volume. Railway project creation was blocked during setup by the account's expired trial; the public game was subsequently deployed on Vercel as described above.

Create a dedicated **last-light** Railway project and service. Do not replace an existing unrelated service. Mount a persistent volume at `/data` and use one replica. The game and atomic event ledger run in one Node process; multiple replicas would need shared session routing and a database migration.

Set these service variables:

| Variable | Value |
|---|---|
| `PORT` | `3001` |
| `LAST_LIGHT_DATA_DIR` | `/data` |
| `LAST_LIGHT_PUBLIC_ORIGIN` | The exact generated HTTPS origin, without a trailing slash |
| `LAST_LIGHT_ADMIN_PASSWORD` | A unique, randomly generated organizer password |
| `LAST_LIGHT_MAX_SESSIONS_PER_IP` | `32` for visitors sharing venue Wi-Fi |

Generate the Railway domain with target port 3001. Set its exact origin before starting the deployment. Configure secrets in Railway Variables; never add an organizer password to the source or a public build. The app does not expose this variable to the frontend.

The CLI workflow uses the installed Railway CLI and your own authenticated account:

```powershell
railway init --name last-light
railway add --service last-light
railway volume add --service last-light --mount-path /data
railway domain --service last-light --port 3001
# Set the service variables in Railway, then:
railway up --service last-light --detach
```

Use an explicit workspace/project/environment when automating. After an initial project is created, link and reuse it instead of calling `init` again. Subsequent releases need only tests, the build, and `railway up` from this directory.

The image builds React using `npm ci` and runs `server/hosted.js`. Railway checks `/api/health` before routing requests to a new release. `railway.json` keeps a single replica and limits automatic failure restarts. HTTPS and WebSocket forwarding are provided by the generated Railway domain.

`.gitignore` and `.dockerignore` exclude local `data/`, test results, environment files, and installed dependencies. The online leaderboard starts as a separate event; existing laptop scores and controller calibration are not uploaded. Persistent volumes retain online event data across releases. Back up the volume before maintenance, and keep event archives with the active ledger.

## Organizer access

Open the gear icon or press F2. Public visitors see a password form; a successful sign-in enables Event tools and Game & diagnostics. Sign out when finished on a shared browser. The password is not kept in browser storage.

Starting a fresh online event archives the previous scores, resets all visitor cities, and invalidates old unfinished results. The confirmation describes this effect. Routine difficulty and timing changes apply to fresh rounds; they do not rewrite a visitor's completed result.

Visitors can submit only their own server-validated results. Their submitted display name appears on the public leaderboard. In the persistent Node edition, sessions are separate per browser cookie; multiple tabs in the same browser share that browser's city. Closing every tab pauses its active game. In-memory games and organizer sessions do not survive a server restart, while submitted scores and event settings remain on the volume. Vercel's browser-tab behavior is described above.

The process allows up to 200 visitor sessions and three WebSocket connections per session. The default per-IP allowance is eight sessions; the recommended venue value above permits more browsers sharing one internet connection. Disconnected sessions expire after 30 minutes. These limits bound resource use; this release has not been load-tested at its maximum capacity.

## Local hosted verification

Use a separate data directory and port so testing cannot change the local exhibition event:

```powershell
npm test
npm run build
$env:PORT = '3003'
$env:LAST_LIGHT_DATA_DIR = "$PWD/test-results/hosted-preview"
$env:LAST_LIGHT_PUBLIC_ORIGIN = 'http://127.0.0.1:3003'
$env:LAST_LIGHT_ADMIN_PASSWORD = 'replace-with-a-local-test-password'
npm run start:hosted
```

Then open `http://127.0.0.1:3003`. Use another browser profile or a private window for a second independent visitor. Run the black-box check against a local or deployed URL:

```powershell
node scripts/verify-hosted.mjs http://127.0.0.1:3003
```

The check uses its own temporary visitor sessions, checks isolation and protected routes, and does not submit leaderboard scores.

Railway references: [Express deployment](https://docs.railway.com/guides/express), [persistent volumes](https://docs.railway.com/volumes), and [CLI deployment](https://docs.railway.com/cli/deploying).
