using System.Net;
using System.Net.WebSockets;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace KickBot.Core;

public class KicksWebSocketServer
{
    private HttpListener? _listener;
    private readonly List<WebSocket> _clients = new();
    private readonly object _clientsLock = new();
    private KicksManager? _kicksManager;

    public void SetKicksManager(KicksManager kicksManager)
    {
        _kicksManager = kicksManager;
    }

    public async Task Start()
    {
        _listener = new HttpListener();
        _listener.Prefixes.Add("http://localhost:8082/");
        _listener.Start();

        Console.WriteLine("[KICKS-WS] WebSocket server started on ws://localhost:8082");

        _ = Task.Run(AcceptClients);
    }

    private async Task AcceptClients()
    {
        while (_listener != null && _listener.IsListening)
        {
            try
            {
                var context = await _listener.GetContextAsync();

                Console.WriteLine($"[KICKS-WS] Incoming: {context.Request.HttpMethod} {context.Request.Url?.AbsolutePath}");

                if (context.Request.HttpMethod == "OPTIONS")
                {
                    Console.WriteLine("[KICKS-WS] Handling OPTIONS preflight");
                    context.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                    context.Response.Headers.Add("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
                    context.Response.Headers.Add("Access-Control-Allow-Headers", "Content-Type");
                    context.Response.StatusCode = 204;
                    context.Response.Close();
                    continue;
                }

                if (context.Request.HttpMethod == "POST")
                {
                    await HandleHttpRequest(context);
                    continue;
                }

                if (context.Request.IsWebSocketRequest)
                {
                    var wsContext = await context.AcceptWebSocketAsync(null);
                    var ws = wsContext.WebSocket;

                    lock (_clientsLock)
                    {
                        _clients.Add(ws);
                        Console.WriteLine($"[KICKS-WS] Client connected. Total clients: {_clients.Count}");
                    }

                    var kicksInfo = _kicksManager?.GetKicksInfo() ?? (0, 0, "Kick Goal");
                    await SendToClient(ws, new
                    {
                        type = "kicks_update",
                        total = kicksInfo.total,
                        goal = kicksInfo.goal,
                        goalTitle = kicksInfo.goalTitle
                    });

                    _ = Task.Run(() => HandleClient(ws));
                }
                else
                {
                    Console.WriteLine($"[KICKS-WS] Rejecting request: {context.Request.HttpMethod}");
                    context.Response.StatusCode = 400;
                    context.Response.Close();
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[KICKS-WS] Error accepting client: {ex.Message}");
            }
        }
    }

    private async Task HandleHttpRequest(HttpListenerContext context)
    {
        context.Response.Headers.Add("Access-Control-Allow-Origin", "*");
        context.Response.Headers.Add("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
        context.Response.Headers.Add("Access-Control-Allow-Headers", "Content-Type");
        context.Response.ContentType = "application/json";

        try
        {
            var path = context.Request.Url?.AbsolutePath;

            using var reader = new StreamReader(context.Request.InputStream);
            var body = await reader.ReadToEndAsync();

            Console.WriteLine($"[KICKS-WS] POST {path}");
            Console.WriteLine($"[KICKS-WS] Body: {body}");

            if (path == "/api/kicks/goal")
            {
                var data = JObject.Parse(body);
                var goal = data["goal"]?.ToObject<int>() ?? 0;
                var title = data["title"]?.ToString() ?? "Kick Goal";

                _kicksManager?.SetGoal(goal, title);

                var info = _kicksManager?.GetKicksInfo() ?? (0, 0, "Kick Goal");
                await BroadcastKicksUpdate(info.total, info.goal, info.goalTitle);

                context.Response.StatusCode = 200;
                var response = Encoding.UTF8.GetBytes("{\"success\":true}");
                await context.Response.OutputStream.WriteAsync(response);
            }
            else if (path == "/api/kicks/add")
            {
                var data = JObject.Parse(body);
                var amount = data["amount"]?.ToObject<int>() ?? 0;

                _kicksManager?.AddKicks(amount);

                context.Response.StatusCode = 200;
                var response = Encoding.UTF8.GetBytes("{\"success\":true}");
                await context.Response.OutputStream.WriteAsync(response);
            }
            else if (path == "/api/kicks/reset")
            {
                _kicksManager?.ResetTotal();

                context.Response.StatusCode = 200;
                var response = Encoding.UTF8.GetBytes("{\"success\":true}");
                await context.Response.OutputStream.WriteAsync(response);
            }
            else
            {
                context.Response.StatusCode = 404;
                var response = Encoding.UTF8.GetBytes("{\"error\":\"Not found\"}");
                await context.Response.OutputStream.WriteAsync(response);
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[KICKS-WS] Error handling HTTP request: {ex.Message}");
            context.Response.StatusCode = 500;
            var response = Encoding.UTF8.GetBytes($"{{\"error\":\"{ex.Message}\"}}");
            await context.Response.OutputStream.WriteAsync(response);
        }
        finally
        {
            context.Response.Close();
        }
    }

    private async Task HandleClient(WebSocket ws)
    {
        var buffer = new byte[1024];

        try
        {
            while (ws.State == WebSocketState.Open)
            {
                var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);

                if (result.MessageType == WebSocketMessageType.Close)
                {
                    await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None);
                    break;
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[KICKS-WS] Client error: {ex.Message}");
        }
        finally
        {
            lock (_clientsLock)
            {
                _clients.Remove(ws);
                Console.WriteLine($"[KICKS-WS] Client disconnected. Total clients: {_clients.Count}");
            }
            ws.Dispose();
        }
    }

    private async Task SendToClient(WebSocket ws, object data)
    {
        try
        {
            var json = JsonConvert.SerializeObject(data);
            var bytes = Encoding.UTF8.GetBytes(json);
            await ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[KICKS-WS] Error sending to client: {ex.Message}");
        }
    }

    public async Task BroadcastKicksUpdate(int total, int goal, string goalTitle)
    {
        var data = new
        {
            type = "kicks_update",
            total,
            goal,
            goalTitle
        };

        await Broadcast(JsonConvert.SerializeObject(data));
    }

    private async Task Broadcast(string message)
    {
        List<WebSocket> clientsCopy;
        lock (_clientsLock)
        {
            clientsCopy = new List<WebSocket>(_clients);
        }

        var bytes = Encoding.UTF8.GetBytes(message);

        foreach (var client in clientsCopy)
        {
            try
            {
                if (client.State == WebSocketState.Open)
                {
                    await client.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[KICKS-WS] Error broadcasting: {ex.Message}");
            }
        }
    }

    public void Stop()
    {
        _listener?.Stop();
        _listener?.Close();
    }
}