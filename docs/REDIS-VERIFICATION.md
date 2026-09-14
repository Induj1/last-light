# Verify persistent Redis storage

Run the live integration check only against the Redis database attached to this project:

```powershell
node --env-file=.env.vercel-production scripts/verify-redis.mjs --confirm-isolated-redis-test
```

The ignored environment file supplies `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, or the `KV_REST_API_URL` and `KV_REST_API_TOKEN` aliases. Credentials are used only to authenticate Redis requests and are never printed.

Each run generates a fresh `{last-light-qa-UUID}:v1` namespace. It exercises the actual Lua scripts for concurrent initialization, settings conflict handling, duplicate score claims, cached rankings, full event archives, rate limits, and organizer session revocation. The production event is never initialized or read. Cleanup deletes and verifies only the exact keys tracked by that run; it never scans or flushes the database.

This is a live integration check with temporary database writes. `npm test` continues to use isolated in-memory test adapters without external credentials.
