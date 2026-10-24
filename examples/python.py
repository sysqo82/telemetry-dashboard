import os
import traceback
import requests  # pip install requests


def report_error(service, exc, **extra):
    try:
        requests.post(
            os.environ["TELEMETRY_URL"] + "/v1/events",
            headers={"X-Api-Key": os.environ["TELEMETRY_KEY"]},
            json={
                "service": service,
                "level": "error",
                "message": str(exc),
                "exception": {
                    "type": type(exc).__name__,
                    "stacktrace": "".join(traceback.format_exception(exc)),
                },
                **extra,
            },
            timeout=3,
        )
    except Exception:
        pass  # telemetry must never crash the app
