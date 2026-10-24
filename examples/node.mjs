export async function reportError(service, error, extra = {}) {
  try {
    await fetch(process.env.TELEMETRY_URL + '/v1/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': process.env.TELEMETRY_KEY },
      body: JSON.stringify({
        service,
        level: 'error',
        message: error.message,
        exception: { type: error.name, stacktrace: error.stack },
        ...extra,
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // telemetry must never crash the app
  }
}
