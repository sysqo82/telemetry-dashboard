using System.Net.Http.Json;

public static class Telemetry
{
    static readonly HttpClient Client = new() { Timeout = TimeSpan.FromSeconds(3) };

    public static async Task ReportError(string service, Exception ex)
    {
        try
        {
            var req = new HttpRequestMessage(HttpMethod.Post, Environment.GetEnvironmentVariable("TELEMETRY_URL") + "/v1/events")
            {
                Content = JsonContent.Create(new
                {
                    service,
                    level = "error",
                    message = ex.Message,
                    exception = new { type = ex.GetType().FullName, stacktrace = ex.StackTrace }
                })
            };
            req.Headers.Add("X-Api-Key", Environment.GetEnvironmentVariable("TELEMETRY_KEY"));
            await Client.SendAsync(req);
        }
        catch { /* telemetry must never crash the app */ }
    }
}
