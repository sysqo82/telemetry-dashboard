# Telemetry Monitor

Self-hosted, Sentry-style error collector for personal projects and homelabs. Apps report errors with a plain HTTP POST (no SDK); identical errors are grouped into **issues**, stored in embedded SQLite (WAL + FTS5), triaged in a web dashboard, and optionally pushed to ntfy / Discord / a generic webhook.

Live instance: https://{your-domain}/

## Architecture

```
 apps (any language) ──POST /v1/events + X-Api-Key──▶ ┌────────────────────────────┐
                                                      │ Fastify server (Node 20)   │
 browser ──cookie session──▶ /  (React SPA)           │  • per-service key check   │
                            /api/*  (admin API)  ───▶ │  • fingerprint + grouping  │──▶ webhook alerts
                                                      │  • SQLite (WAL, FTS5)      │
                                                      │  • daily retention (03:00) │
                                                      └────────────────────────────┘
```

| Path | Purpose |
|---|---|
| `src/index.ts` | Startup: config, DB, alerts, retention scheduler, graceful shutdown |
| `src/app.ts` | Fastify wiring, static SPA hosting + JSON 404s |
| `src/config.ts` | Environment validation (zod) |
| `src/db/` | SQLite schema (`issues`, `events`, `events_fts`, `api_keys`) |
| `src/routes/events.ts` | Ingestion endpoint, per-service API key check |
| `src/routes/auth.ts` | Dashboard login/logout/session (username + password) |
| `src/routes/management.ts` | Issues, events, services and API key management |
| `src/services/` | Fingerprinting, ingestion, alert dispatcher, retention |
| `frontend/` | Vite + React + Tailwind dashboard (built to `frontend/dist`) |
| `examples/` | Client snippets: Node.js, Python, C#, Kotlin |
| `CLIENT_IMPLEMENTATION.md` | Instructions for adding reporting to an app (for humans or AI) |

## Security model

- **Ingestion:** every app/service has its **own API key**, created in the dashboard. A key is bound to one service name: events for any other service get `403`. Keys are shown once, stored only as SHA-256 hashes, and can be revoked instantly (Dashboard → API keys).
- **Dashboard:** a single admin account (`ADMIN_USERNAME` + `ADMIN_PASSWORD`), compared in constant time. Sessions are random 256-bit tokens in an HttpOnly, SameSite=Lax cookie (`Secure` when `NODE_ENV=production`), valid for 30 days and held in memory (a restart signs everyone out).
- Run behind an HTTPS reverse proxy; keys and the session cookie are sent over the wire.

## Requirements

- Node.js 20+ and Yarn 1.x (local), or Docker

## Configuration

```sh
yarn install
cp .env.example .env     # PowerShell: Copy-Item .env.example .env
```

| Variable | Default | Description |
|---|---|---|
| `ADMIN_USERNAME` | *(required)* | Dashboard username |
| `ADMIN_PASSWORD` | *(required)* | Dashboard password (use a long random value) |
| `NODE_ENV` | `development` | `production` enables the Secure cookie flag |
| `PORT` | `8080` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DB_PATH` | `./data/telemetry.sqlite` | SQLite file (directory auto-created) |
| `RETENTION_DAYS` | `30` | Days to keep raw events |
| `ALERT_WEBHOOK_URL` | *(optional)* | ntfy.sh topic, Discord webhook, or generic JSON webhook |

Generate a password: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`

> **Upgrading from 0.3:** `INGEST_API_KEY` is no longer used. Add `ADMIN_USERNAME` to `.env`, sign in, and create a key per service; update each app to use its new key.

## Run

```sh
yarn dev                  # backend, watch mode
yarn dev:frontend         # Vite UI (second terminal; proxies /api to :8080)
yarn build                # typecheck + build UI + server
yarn start                # production server and dashboard
yarn test                 # builds UI, runs the test suite
```

Health check: `curl http://localhost:8080/healthz`

### Docker

```sh
cp .env.example .env      # set ADMIN_USERNAME / ADMIN_PASSWORD
docker compose up --build -d
```

Data persists in the `telemetry-data` volume; the service restarts unless stopped and has a `/healthz` health check. Put it behind a reverse proxy with TLS for public use.

## Operating it

1. **Sign in** at the root URL with `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
2. **Create an API key** (API keys tab): enter the exact service name your app will send in `service`, click *Create*, and copy the key immediately. Give the app `TELEMETRY_URL` and `TELEMETRY_KEY` (see [CLIENT_IMPLEMENTATION.md](CLIENT_IMPLEMENTATION.md)).
3. **Triage** in the Issues tab: search (FTS5), filter by status/service, open details (stack traces, tags, metadata), Resolve / Ignore / Delete. A repeat of a resolved issue reopens it.
4. **Watch** the Live events tab (polls every 5 s).
5. **Rotate a key:** create a second key for the service, deploy it, then revoke the old one.
6. **Revoke a leaked key:** API keys tab → Revoke (effective immediately).
7. **Alerts:** `error`/`fatal` events post to `ALERT_WEBHOOK_URL`; the same issue alerts at most once per 30 minutes (in-memory; resets on restart).
8. **Retention:** daily at 03:00 UTC, events older than `RETENTION_DAYS` are deleted, then the WAL is checkpointed and the DB optimized and vacuumed. Issue rows are kept.
9. **Backup:** copy `telemetry.sqlite` (plus `-wal`/`-shm` if present) while stopped, or use `sqlite3 ... ".backup"`.

## Ingestion API

`POST /v1/events` with `X-Api-Key: <service key>` and a JSON body. Responses: `202 {"status":"accepted","issueId":"..."}`, `401` unknown/revoked key, `403` key not valid for this `service`, `400` invalid payload.

| Field | Required | Notes |
|---|---|---|
| `service` | yes | Must equal the service the key was created for |
| `message` | yes | Human-readable message |
| `level` | no | `debug` `info` `warn` `error` (default) `fatal` |
| `environment` | no | Default `production` |
| `exception.type` / `.value` / `.stacktrace` | no | Lines starting with `at ` are used for grouping |
| `tags` | no | `{ "key": "string value" }` |
| `metadata` | no | Any JSON object |
| `timestamp` | no | ISO-8601 with timezone; defaults to now |

```sh
curl -X POST http://localhost:8080/v1/events \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: tm_..." \
  -d '{"service":"booklog-pantry","message":"Connection refused","exception":{"type":"NpgsqlException","stacktrace":"at Npgsql.Connector.Open() (/app/db.cs:42)"}}'
```

Client helpers: [Node.js](examples/node.mjs), [Python](examples/python.py), [C#](examples/Telemetry.cs), [Kotlin](examples/Telemetry.kt). Full guidance: [CLIENT_IMPLEMENTATION.md](CLIENT_IMPLEMENTATION.md).

### How grouping works

`fingerprint = SHA-256(service + exception type + top app stack frame)`; the frame ignores `node_modules`/internal frames and normalizes line numbers, UUIDs, hex and digits. Without a stack trace the normalized message is used.

## Dashboard API (cookie session required, except login)

| Method & path | Description |
|---|---|
| `POST /api/auth/login` | `{ "username", "password" }` → sets session cookie |
| `POST /api/auth/logout` | Ends the session |
| `GET /api/auth/session` | Session check |
| `GET /api/issues` | `status`, `service`, `search` (FTS5), `level` (latest event), `tag` (`key=value`), `from`/`to` (ISO, matched against last seen), `page`, `pageSize` (default 15, max 100) → `{ items, total, page, pageSize }`, latest first |
| `GET /api/issues/:id` | Issue + latest 50 events |
| `PATCH /api/issues/:id/status` | `{ "status": "unresolved|resolved|ignored" }` |
| `DELETE /api/issues/:id` | Delete issue and events |
| `GET /api/events` | `search`, `level`, `tag` (`key=value`), `from`/`to` (ISO), `page`, `pageSize` (default 15, max 100) → `{ items, total, page, pageSize }`, latest first |
| `POST /api/issues/bulk-delete`, `POST /api/events/bulk-delete` | `{ "ids": [...] }` (max 500) |
| `GET /api/services` | Distinct service names |
| `GET /api/keys` | List keys (prefix only) |
| `POST /api/keys` | `{ "service" }` → returns the full key once |
| `DELETE /api/keys/:id` | Revoke a key |

## Data

SQLite tables: `issues`, `events`, `events_fts` (FTS5), `api_keys` (hashes only).

```sh
sqlite3 data/telemetry.sqlite "SELECT title, culprit, occurrence_count FROM issues ORDER BY last_seen_at DESC"
```
