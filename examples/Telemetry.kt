import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

private val client = HttpClient.newHttpClient()

private fun esc(s: String) = s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r")

fun reportError(service: String, e: Throwable) {
    try {
        val body = """{"service":"${esc(service)}","level":"error","message":"${esc(e.message ?: e.toString())}",""" +
            """"exception":{"type":"${esc(e.javaClass.name)}","stacktrace":"${esc(e.stackTraceToString())}"}}"""
        val req = HttpRequest.newBuilder(URI.create(System.getenv("TELEMETRY_URL") + "/v1/events"))
            .timeout(Duration.ofSeconds(3))
            .header("Content-Type", "application/json")
            .header("X-Api-Key", System.getenv("TELEMETRY_KEY"))
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build()
        client.sendAsync(req, HttpResponse.BodyHandlers.discarding())
    } catch (_: Exception) {
        // telemetry must never crash the app
    }
}
