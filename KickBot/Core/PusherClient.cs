using System.Net.WebSockets;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System.Text.RegularExpressions;

namespace KickBot.Core;

public class PusherClient
{
    private ClientWebSocket? _ws;
    private readonly string _chatroomId;
    private readonly int _channelId;
    private CancellationTokenSource? _cts;

    public event EventHandler<ChatMessageEvent>? OnChatMessage;
    public event EventHandler<GiftEvent>? OnGift;
    public event EventHandler<SubscriptionEvent>? OnSubscription;
    public event EventHandler<RewardRedeemEvent>? OnRewardRedeem;
    public event EventHandler? OnConnected;

    public PusherClient(int chatroomId, int channelId)
    {
        _chatroomId = chatroomId.ToString();
        _channelId = channelId;
    }

    public async Task Connect()
    {
        _ws = new ClientWebSocket();
        _cts = new CancellationTokenSource();

        var pusherUrl = "wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0&flash=false";

        await _ws.ConnectAsync(new Uri(pusherUrl), _cts.Token);

        _ = Task.Run(() => ReceiveLoop(_cts.Token));

        await Task.Delay(500);

        await Subscribe($"chatrooms.{_chatroomId}.v2");
        await Subscribe($"chatroom_{_chatroomId}");
        await Subscribe($"channel_{_channelId}");

        OnConnected?.Invoke(this, EventArgs.Empty);
    }

    private async Task Subscribe(string channel)
    {
        var subscribeMsg = new
        {
            @event = "pusher:subscribe",
            data = new { channel }
        };

        await SendMessage(JsonConvert.SerializeObject(subscribeMsg));
    }

    private async Task ReceiveLoop(CancellationToken ct)
    {
        var buffer = new byte[8192];

        try
        {
            while (_ws?.State == WebSocketState.Open && !ct.IsCancellationRequested)
            {
                var result = await _ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);

                if (result.MessageType == WebSocketMessageType.Close)
                {
                    await _ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "", ct);
                    break;
                }

                var message = Encoding.UTF8.GetString(buffer, 0, result.Count);
                HandleMessage(message);
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"WebSocket error: {ex.Message}");
        }
    }

    private void HandleMessage(string message)
    {
        try
        {
            var json = JObject.Parse(message);
            var eventType = json["event"]?.ToString();

            if (eventType == "pusher:connection_established")
            {
                Console.WriteLine("Connected to chat");
                return;
            }

            if (eventType == "pusher:error")
            {
                Console.WriteLine($"Pusher error: {json["data"]}");
                return;
            }

            Console.WriteLine($"[EVENT] {eventType}");

            if (eventType == "App\\Events\\ChatMessageEvent")
            {
                var dataStr = json["data"]?.ToString();
                if (string.IsNullOrEmpty(dataStr)) return;

                var data = JObject.Parse(dataStr);
                var username = data["sender"]?["username"]?.ToString() ?? "Unknown";
                var content = data["content"]?.ToString() ?? "";

                var isBroadcaster = false;
                var badges = data["sender"]?["identity"]?["badges"];
                if (badges != null)
                {
                    foreach (var badge in badges)
                    {
                        if (badge["type"]?.ToString() == "broadcaster")
                        {
                            isBroadcaster = true;
                            break;
                        }
                    }
                }

                OnChatMessage?.Invoke(this, new ChatMessageEvent
                {
                    Username = username,
                    Content = content,
                    IsBroadcaster = isBroadcaster
                });
            }

            if (eventType == "KicksGifted")
            {
                var dataStr = json["data"]?.ToString();
                if (string.IsNullOrEmpty(dataStr)) return;

                var data = JObject.Parse(dataStr);
                var senderUsername = data["sender"]?["username"]?.ToString() ?? "Unknown";
                var giftName = data["gift"]?["name"]?.ToString() ?? "Unknown Gift";
                var giftId = data["gift"]?["gift_id"]?.ToString() ?? "";
                var amount = data["gift"]?["amount"]?.ToObject<int>() ?? 1;
                var giftTier = data["gift"]?["tier"]?.ToString() ?? "BASIC";

                OnGift?.Invoke(this, new GiftEvent
                {
                    GifterUsername = senderUsername,
                    GiftName = giftName,
                    GiftId = giftId,
                    GiftAmount = amount,
                    GiftTier = giftTier
                });
            }

            if (eventType == "App\\Events\\SubscriptionEvent")
            {
                var dataStr = json["data"]?.ToString();
                if (string.IsNullOrEmpty(dataStr)) return;

                var data = JObject.Parse(dataStr);
                var username = data["username"]?.ToString() ?? "Unknown";

                OnSubscription?.Invoke(this, new SubscriptionEvent
                {
                    GifterUsername = username,
                    SubCount = 1,
                    IsGift = false
                });
            }

            if (eventType == "GiftedSubscriptionsEvent")
            {
                var dataStr = json["data"]?.ToString();
                if (string.IsNullOrEmpty(dataStr)) return;

                var data = JObject.Parse(dataStr);
                var gifterUsername = data["gifter_username"]?.ToString() ?? "Unknown";
                var giftedUsernames = data["gifted_usernames"]?.ToObject<List<string>>() ?? new List<string>();

                OnSubscription?.Invoke(this, new SubscriptionEvent
                {
                    GifterUsername = gifterUsername,
                    SubCount = giftedUsernames.Count,
                    IsGift = true
                });
            }

            if (eventType == "RewardRedeemedEvent")
            {
                var dataStr = json["data"]?.ToString();
                if (string.IsNullOrEmpty(dataStr)) return;

                var data = JObject.Parse(dataStr);
                var username = data["username"]?.ToString() ?? "Unknown";
                var rewardTitle = data["reward_title"]?.ToString() ?? "";

                var match = Regex.Match(rewardTitle, @"Redeem (\d+) tokens?", RegexOptions.IgnoreCase);
                if (match.Success && int.TryParse(match.Groups[1].Value, out var tokenAmount))
                {
                    OnRewardRedeem?.Invoke(this, new RewardRedeemEvent
                    {
                        Username = username,
                        RewardTitle = rewardTitle,
                        TokenAmount = tokenAmount
                    });
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error parsing message: {ex.Message}");
        }
    }

    private async Task SendMessage(string message)
    {
        if (_ws?.State != WebSocketState.Open) return;

        var bytes = Encoding.UTF8.GetBytes(message);
        await _ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
    }

    public void Disconnect()
    {
        _cts?.Cancel();
        _ws?.Dispose();
    }
}

public class ChatMessageEvent
{
    public string Username { get; set; } = "";
    public string Content { get; set; } = "";
    public bool IsBroadcaster { get; set; }
}

public class GiftEvent
{
    public string GifterUsername { get; set; } = "";
    public string GiftName { get; set; } = "";
    public string GiftId { get; set; } = "";
    public int GiftAmount { get; set; }
    public string GiftTier { get; set; } = "";
}

public class SubscriptionEvent
{
    public string GifterUsername { get; set; } = "";
    public int SubCount { get; set; }
    public bool IsGift { get; set; }
}

public class RewardRedeemEvent
{
    public string Username { get; set; } = "";
    public string RewardTitle { get; set; } = "";
    public int TokenAmount { get; set; }
}