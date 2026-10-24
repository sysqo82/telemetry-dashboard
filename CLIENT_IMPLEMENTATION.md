# Telemetry Client Implementation Guide (for AI implementers)

Goal: add error reporting to any app, in any language, so errors appear on the dashboard at **https://telemetry.lockpc.co.uk/**.

Reference implementations (copy the pattern): [Node.js](examples/node.mjs), [Python](examples/python.py), [C#](examples/Telemetry.cs), [Kotlin](examples/Telemetry.kt).

## 1. Configuration

Read from environment variables. Never hardcode or commit the key.

| Variable | Value |
|---|---|
| `TELEMETRY_URL` | `https://telemetry.lockpc.co.uk` (no trailing slash) |
| `TELEMETRY_KEY` | The API key issued **for this specific service** (see below) |

### Getting an API key (one per service/app)

Each app/service needs its own key, and a key only works for the one service name it was created for.

1. Ask the dashboard owner (or, if you have access, sign in at https://telemetry.lockpc.co.uk/ with the admin username/password) to open the **API keys** tab.
2. Enter the exact `service` name the app will send (e.g. `booklog-pantry`) and click **Create API key**.
3. Copy the key (`tm_...`) immediately — it is shown only once and cannot be recovered. If lost, create a new key and revoke the old one.
4. Store it as `TELEMETRY_KEY` in the app's environment/secret store. Never commit it, and never reuse one key across apps.

The `service` field in every event **must exactly match** the service the key was created for, otherwise the server returns `403`. To rotate: create a new key, deploy it, then revoke the old key. Programmatic creation is possible via the authenticated `POST /api/keys` endpoint (`{"service":"..."}`) but normally the dashboard is used.

Add both to the app's `.env.example` with a placeholder key, and make sure the real `.env` is git-ignored.

## 2. API contract

`POST {TELEMETRY_URL}/v1/events`

Headers: `Content-Type: application/json`, `X-Api-Key: {TELEMETRY_KEY}`

| Field | Required | Notes |
|---|---|---|
| `service` | yes | Stable app name, e.g. `booklog-pantry`. Same name on every call, and **must equal the service the API key was issued for**. |
| `message` | yes | Non-empty human-readable message. |
| `level` | no | `debug` `info` `warn` `error` (default) `fatal`. **Only `error` and `fatal` trigger push alerts.** |
| `environment` | no | Default `production`. Set e.g. `development` locally. |
| `exception.type` | no | Exception class name. |
| `exception.value` | no | Exception message. |
| `exception.stacktrace` | no | Full stack trace string (see grouping below). |
| `tags` | no | Flat `{ "key": "string value" }` — values must be strings. |
| `metadata` | no | Any JSON object. |
| `timestamp` | no | ISO-8601 **with timezone** (`2026-10-24T10:00:00Z`); defaults to now. |

Responses: `202 {"status":"accepted","issueId":"..."}`, `401` unknown/revoked key, `403` key not valid for this `service`, `400` invalid payload.

Minimal test:

```sh
curl -X POST https://telemetry.lockpc.co.uk/v1/events \
  -H "Content-Type: application/json" -H "X-Api-Key: $TELEMETRY_KEY" \
  -d '{"service":"my-app","level":"error","message":"test error","exception":{"type":"TestError","stacktrace":"at main (/app/main.ts:1)"}}'
```

## 3. Grouping rules (affects how you format stack traces)

Errors are grouped into one issue by `SHA-256(service + exception.type + top app stack frame)`. The top frame is the first line that **starts with `at `** (after trimming) and does not contain `node_modules`, `node:internal` or `internal/`. Line numbers/digits are normalized away. If no such line exists, the normalized `message` is used instead.

Therefore:
- Always send `exception.type`.
- For languages whose traces are not `at ...` formatted (Python, Go, Rust, PHP, Ruby…), convert frames into lines like `at functionName (path/file.ext:line)` before sending, so grouping is stable. Keep the original trace too if useful (e.g. in `metadata`).
- Never put variable data (IDs, timestamps) in `exception.type` or `service`.

## 4. Mandatory behavior of every client

1. **Never throw or crash the host app.** Wrap everything in try/catch and swallow errors.
2. **Never block the app.** Use a short timeout (≤ 3 s) and fire-and-forget/async where the platform allows.
3. **No-op if `TELEMETRY_URL` or `TELEMETRY_KEY` is missing** (do not throw).
4. Do not log or send secrets, passwords, tokens or full request bodies in `message`/`metadata`.
5. Don't report the telemetry request's own failures back to telemetry (avoid loops).
6. Use HTTPS only; do not disable certificate verification.
7. Prefer the platform's built-in HTTP client; add a dependency only if none exists.

## 5. Implementation steps

1. Inspect the target project: language, framework, existing error handling, HTTP client, config/env loading.
2. Add one small helper (`reportError(service, error, extra)`) following the matching example above. For languages without an example, port the Node.js example: build the JSON body, POST with the two headers, 3 s timeout, swallow errors.
3. Hook it into **global/uncaught error handlers** and key `catch` blocks:

| Platform | Hook |
|---|---|
| Node.js | `process.on('uncaughtException'/'unhandledRejection')`, Express/Fastify error middleware |
| Browser JS | `window.onerror`, `unhandledrejection` (send via a backend proxy — never ship the API key to browsers) |
| Python | `sys.excepthook`, framework error handlers (Flask `errorhandler`, Django middleware, FastAPI exception handler) |
| C# / .NET | `AppDomain.CurrentDomain.UnhandledException`, `TaskScheduler.UnobservedTaskException`, ASP.NET exception middleware |
| Kotlin/Java/Android | `Thread.setDefaultUncaughtExceptionHandler`; keep the previous handler and call it afterwards |
| Go | `recover()` in a deferred handler/HTTP middleware |
| Other | Equivalent top-level crash/exception handler |

4. Preserve existing behavior: chain to any previously installed handler; do not swallow the original error for the app itself.
5. Add `tags` for useful context (e.g. host, version, platform) as string values.

## 6. Verification checklist

- [ ] With env vars set, a deliberately thrown test error returns `202` and appears at https://telemetry.lockpc.co.uk/ (sign in with the admin username and password) as an issue under the chosen `service`. A `403` means the key was issued for a different service name; `401` means the key is wrong or revoked.
- [ ] Throwing the same error twice increments the occurrence count of one issue (grouping works).
- [ ] With env vars unset or the server unreachable, the app still runs normally and no exception escapes.
- [ ] Existing tests/build of the target project still pass.
- [ ] The API key is not present in source control.
