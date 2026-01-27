using System.Net;
using System.Net.WebSockets;
using System.Text;
using Newtonsoft.Json;

namespace KickBot.ElevenLabs;

public class SfxWebSocketServer
{
    private readonly HttpListener _listener;
    private readonly List<WebSocket> _clients = new();
    private CancellationTokenSource? _cts;

    public SfxWebSocketServer(string prefix = "http://localhost:8080/")
    {
        _listener = new HttpListener();
        _listener.Prefixes.Add(prefix);
    }

    public async Task Start()
    {
        _cts = new CancellationTokenSource();
        _listener.Start();
        Console.WriteLine("[SFX-WS] WebSocket server started on ws://localhost:8080");

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

                    Console.WriteLine($"[SFX-WS] Client connected. Total clients: {_clients.Count}");

                    _ = Task.Run(async () => await HandleClient(ws, ct));
                }
                else
                {
                    context.Response.StatusCode = 400;
                    context.Response.Close();
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[SFX-WS] Error accepting connection: {ex.Message}");
            }
        }
    }

    private async Task HandleClient(WebSocket ws, CancellationToken ct)
    {
        var buffer = new byte[1024];

        try
        {
            while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
            {
                await ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
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
            Console.WriteLine($"[SFX-WS] Client disconnected. Total clients: {_clients.Count}");
        }
    }

    public async Task BroadcastSfx(string filePath)
    {
        var fileName = Path.GetFileName(filePath);
        var message = JsonConvert.SerializeObject(new
        {
            type = "playSfx",
            url = $"http://localhost:3000/sfx/{fileName}"
        });

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

        // Cleanup after 30 seconds
        _ = Task.Run(async () =>
        {
            await Task.Delay(30000);
            try
            {
                if (File.Exists(filePath))
                {
                    File.Delete(filePath);
                    Console.WriteLine($"[SFX-WS] Cleaned up: {fileName}");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[SFX-WS] Cleanup error: {ex.Message}");
            }
        });
    }

    public void Stop()
    {
        _cts?.Cancel();
        _listener.Stop();
    }
}