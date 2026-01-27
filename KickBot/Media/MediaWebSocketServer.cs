using System.Net;
using System.Net.WebSockets;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace KickBot.Media;

public class MediaWebSocketServer
{
    private readonly HttpListener _listener;
    private readonly List<WebSocket> _clients = new();
    private CancellationTokenSource? _cts;
    private MediaManager? _mediaManager;

    public MediaWebSocketServer(string prefix = "http://localhost:8081/")
    {
        _listener = new HttpListener();
        _listener.Prefixes.Add(prefix);
    }

    public void SetMediaManager(MediaManager manager)
    {
        _mediaManager = manager;
    }

    public async Task Start()
    {
        _cts = new CancellationTokenSource();
        _listener.Start();
        Console.WriteLine("[MEDIA-WS] WebSocket server started on ws://localhost:8081");

        _ = Task.Run(async () => await AcceptConnections(_cts.Token));
    }

    private async Task AcceptConnections(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var context = await _listener.GetContextAsync();

                if (context.Request.IsWebSocketRequest)
                {
                    var wsContext = await context.AcceptWebSocketAsync(null);
                    var ws = wsContext.WebSocket;

                    lock (_clients)
                    {
                        _clients.Add(ws);
                    }

                    Console.WriteLine($"[MEDIA-WS] Client connected. Total clients: {_clients.Count}");

                    _ = Task.Run(async () => await HandleClient(ws, ct));
                }
                else
                {
                    await HandleHttpRequest(context);
                }
            }
            catch (Exception ex)
            {
                if (!ct.IsCancellationRequested)
                {
                    Console.WriteLine($"[MEDIA-WS] Error accepting connection: {ex.Message}");
                }
            }
        }
    }

    private async Task HandleHttpRequest(HttpListenerContext context)
    {
        context.Response.Headers.Add("Access-Control-Allow-Origin", "*");
        context.Response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        context.Response.Headers.Add("Access-Control-Allow-Headers", "Content-Type");

        if (context.Request.HttpMethod == "OPTIONS")
        {
            context.Response.StatusCode = 200;
            context.Response.Close();
            return;
        }

        var path = context.Request.Url?.AbsolutePath ?? "";

        if (path == "/api/media/queue" && context.Request.HttpMethod == "POST")
        {
            using var reader = new StreamReader(context.Request.InputStream);
            var body = await reader.ReadToEndAsync();
            var data = JsonConvert.DeserializeObject<Dictionary<string, string>>(body);

            if (data != null && _mediaManager != null)
            {
                var url = data.GetValueOrDefault("url", "");
                var requestedBy = data.GetValueOrDefault("requestedBy", "OBS Dock");
                var typeStr = data.GetValueOrDefault("type", "music");
                var type = typeStr == "video" ? MediaType.Video : MediaType.Music;

                var result = await _mediaManager.QueueMedia(url, requestedBy, type);

                var response = JsonConvert.SerializeObject(result);
                var buffer = Encoding.UTF8.GetBytes(response);

                context.Response.ContentType = "application/json";
                context.Response.ContentLength64 = buffer.Length;
                await context.Response.OutputStream.WriteAsync(buffer);
            }
        }
        else if (path == "/api/media/skip" && context.Request.HttpMethod == "POST")
        {
            if (_mediaManager != null)
            {
                await _mediaManager.Skip();
            }

            var response = JsonConvert.SerializeObject(new { success = true });
            var buffer = Encoding.UTF8.GetBytes(response);

            context.Response.ContentType = "application/json";
            context.Response.ContentLength64 = buffer.Length;
            await context.Response.OutputStream.WriteAsync(buffer);
        }
        else if (path == "/api/media/pause" && context.Request.HttpMethod == "POST")
        {
            if (_mediaManager != null)
            {
                await _mediaManager.TogglePause();
            }

            var response = JsonConvert.SerializeObject(new { success = true });
            var buffer = Encoding.UTF8.GetBytes(response);

            context.Response.ContentType = "application/json";
            context.Response.ContentLength64 = buffer.Length;
            await context.Response.OutputStream.WriteAsync(buffer);
        }
        else
        {
            context.Response.StatusCode = 404;
        }

        context.Response.Close();
    }

    private async Task HandleClient(WebSocket ws, CancellationToken ct)
    {
        var buffer = new byte[4096];

        try
        {
            while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
            {
                var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);

                if (result.MessageType == WebSocketMessageType.Text)
                {
                    var message = Encoding.UTF8.GetString(buffer, 0, result.Count);
                    await HandleClientMessage(message, ws);
                }
            }
        }
        catch
        {
        }
        finally
        {
            lock (_clients)
            {
                _clients.Remove(ws);
            }
            Console.WriteLine($"[MEDIA-WS] Client disconnected. Total clients: {_clients.Count}");
        }
    }

    private async Task HandleClientMessage(string message, WebSocket sender)
    {
        try
        {
            var data = JObject.Parse(message);
            var type = data["type"]?.ToString();

            if (type == "progress_update")
            {
                var currentToken = data["current"];
                var totalToken = data["total"];

                if (currentToken != null && totalToken != null &&
                    currentToken.Type != JTokenType.Null && totalToken.Type != JTokenType.Null)
                {
                    var current = currentToken.ToObject<double>();
                    var total = totalToken.ToObject<double>();

                    if (!double.IsNaN(current) && !double.IsNaN(total) &&
                        !double.IsInfinity(current) && !double.IsInfinity(total) &&
                        total > 0)
                    {
                        await BroadcastProgress(current, total, sender);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[MEDIA-WS] Error handling client message: {ex.Message}");
        }
    }

    private async Task BroadcastProgress(double current, double total, WebSocket? excludeClient = null)
    {
        var message = JsonConvert.SerializeObject(new
        {
            type = "progress",
            current,
            total
        });

        var bytes = Encoding.UTF8.GetBytes(message);

        List<WebSocket> clientsCopy;
        lock (_clients)
        {
            clientsCopy = new List<WebSocket>(_clients);
        }

        foreach (var client in clientsCopy)
        {
            if (client != excludeClient && client.State == WebSocketState.Open)
            {
                try
                {
                    await client.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
                }
                catch
                {
                }
            }
        }
    }

    public async Task Broadcast(string message)
    {
        var bytes = Encoding.UTF8.GetBytes(message);

        List<WebSocket> clientsCopy;
        lock (_clients)
        {
            clientsCopy = new List<WebSocket>(_clients);
        }

        foreach (var client in clientsCopy)
        {
            if (client.State == WebSocketState.Open)
            {
                try
                {
                    await client.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
                }
                catch
                {
                }
            }
        }
    }

    public async Task BroadcastPlay(object data)
    {
        var message = JsonConvert.SerializeObject(new
        {
            type = "play",
            data
        });

        await Broadcast(message);
    }

    public async Task BroadcastControl(string action)
    {
        var message = JsonConvert.SerializeObject(new
        {
            type = "control",
            action
        });

        await Broadcast(message);
    }

    public void Stop()
    {
        _cts?.Cancel();
        _listener.Stop();
    }
}