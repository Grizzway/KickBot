using KickBot.Commands;
using KickBot.Config;
using KickBot.ElevenLabs;
using KickBot.Media;
using KickLib;
using KickLib.Auth;
using KickLib.Core;
using Newtonsoft.Json;
using System.Diagnostics;
using System.IO;
using System.Web;

namespace KickBot.Core;

public class Bot
{
    private readonly BotConfig _config;
    private IKickApi? _api;
    private int _chatroomId;
    private int _broadcasterUserId;
    private PusherClient? _pusherClient;
    private CommandHandler? _commandHandler;
    private UserManager? _userManager;
    private ElevenLabsManager? _elevenLabsManager;
    private SfxWebSocketServer? _sfxWebSocketServer;
    private MediaManager? _mediaManager;
    private KicksManager? _kicksManager;
    private KicksWebSocketServer? _kicksWebSocketServer;
    private Process? _nodeServerProcess;

    public Bot()
    {
        _config = BotConfig.Load();

        AppDomain.CurrentDomain.ProcessExit += OnProcessExit;
        Console.CancelKeyPress += OnCancelKeyPress;
    }

    private void OnProcessExit(object? sender, EventArgs e)
    {
        Console.WriteLine("Bot shutting down...");
        _userManager?.EmergencySave();
        _kicksManager?.EmergencySave();
        _pusherClient?.Disconnect();
        _sfxWebSocketServer?.Stop();
        _kicksWebSocketServer?.Stop();

        if (_nodeServerProcess != null && !_nodeServerProcess.HasExited)
        {
            _nodeServerProcess.Kill(true);
            Console.WriteLine("[NODE] Server stopped");
        }
    }

    private void OnCancelKeyPress(object? sender, ConsoleCancelEventArgs e)
    {
        Console.WriteLine("Bot shutting down...");
        _userManager?.EmergencySave();
        _kicksManager?.EmergencySave();
        _pusherClient?.Disconnect();
        _sfxWebSocketServer?.Stop();
        _kicksWebSocketServer?.Stop();

        if (_nodeServerProcess != null && !_nodeServerProcess.HasExited)
        {
            _nodeServerProcess.Kill(true);
            Console.WriteLine("[NODE] Server stopped");
        }

        e.Cancel = false;
    }

    public async Task Start()
    {
        Console.WriteLine("Starting KickBot...");

        StartOAuthServer();

        var clientId = Environment.GetEnvironmentVariable("KICK_CLIENT_ID") ?? throw new Exception("KICK_CLIENT_ID not set");
        var clientSecret = Environment.GetEnvironmentVariable("KICK_CLIENT_SECRET") ?? throw new Exception("KICK_CLIENT_SECRET not set");
        var redirectUri = Environment.GetEnvironmentVariable("KICK_REDIRECT_URI") ?? "http://localhost:3000/callback";

        var settings = LoadTokens();
        if (settings == null)
        {
            var authGenerator = new KickOAuthGenerator();

            var url = authGenerator.GetAuthorizationUri(
                redirectUri,
                clientId,
                new List<string>
                {
                    "user:read",
                    "channel:read",
                    "channel:write",
                    "channel:rewards:read",
                    "channel:rewards:write",
                    "chat:write",
                    "events:subscribe",
                    "moderation:ban",
                    "moderation:chat_message:manage",
                    "kicks:read"
                },
                out var verifier);

            Process.Start(new ProcessStartInfo { FileName = url.ToString(), UseShellExecute = true });
            Console.WriteLine("Enter the FULL callback URL:");
            var callbackUrl = Console.ReadLine()?.Trim();

            if (string.IsNullOrEmpty(callbackUrl))
            {
                throw new Exception("No callback URL entered");
            }

            var uri = new Uri(callbackUrl);
            var queryParams = HttpUtility.ParseQueryString(uri.Query);
            var code = queryParams["code"];
            var state = queryParams["state"];

            var tokenResult = await authGenerator.ExchangeCodeForTokenAsync(
                code!,
                clientId,
                clientSecret,
                redirectUri,
                state!);

            if (!tokenResult.IsSuccess)
            {
                throw new Exception("Token exchange failed");
            }

            settings = new ApiSettings
            {
                AccessToken = tokenResult.Value.AccessToken,
                RefreshToken = tokenResult.Value.RefreshToken,
                ClientId = clientId,
                ClientSecret = clientSecret
            };

            SaveTokens(settings);
            Console.WriteLine("Authentication successful!");
        }
        else
        {
            Console.WriteLine("Loaded existing tokens");
        }

        _api = KickApi.Create(settings);

        var channelResponse = await _api.Channels.GetChannelAsync(_config.ChannelName.ToLower());
        if (!channelResponse.IsSuccess || channelResponse.Value == null)
        {
            throw new Exception($"Could not find channel: {_config.ChannelName}");
        }

        _broadcasterUserId = channelResponse.Value.BroadcasterUserId;

        var (chatroomId, channelId) = await GetChannelIdsFromPublicApi(_config.ChannelName);
        _chatroomId = chatroomId;
        Console.WriteLine($"Connected to {_config.ChannelName} (Chatroom ID: {_chatroomId}, Channel ID: {channelId}, Broadcaster ID: {_broadcasterUserId})");

        _userManager = new UserManager(_config.NewUserBonus);

        _userManager.OnNewUser += async (username) =>
        {
            var message = _config.WelcomeMessage
                .Replace("{username}", username)
                .Replace("{tokens}", _config.NewUserBonus.ToString());

            await _api!.Chat.SendMessageAsUserAsync(_broadcasterUserId, message);
        };

        _kicksManager = new KicksManager();
        _kicksWebSocketServer = new KicksWebSocketServer();
        await _kicksWebSocketServer.Start();
        _kicksWebSocketServer.SetKicksManager(_kicksManager);

        _kicksManager.OnKicksUpdated += async (total) =>
        {
            var info = _kicksManager.GetKicksInfo();
            await _kicksWebSocketServer.BroadcastKicksUpdate(info.total, info.goal, info.goalTitle);
        };

        var initialKicks = _kicksManager.GetKicksInfo();
        await _kicksWebSocketServer.BroadcastKicksUpdate(initialKicks.total, initialKicks.goal, initialKicks.goalTitle);
        Console.WriteLine("Kicks Tracker enabled");

        _commandHandler = new CommandHandler(_config.CommandPrefix);

        var exeDirectory = Path.GetDirectoryName(AppContext.BaseDirectory) ?? AppContext.BaseDirectory;

        var elevenLabsApiKey = Environment.GetEnvironmentVariable("ELEVENLABS_API_KEY");
        if (!string.IsNullOrEmpty(elevenLabsApiKey))
        {
            var sfxPath = Path.Combine(exeDirectory, "Webserver", "sfx");
            Directory.CreateDirectory(sfxPath);

            _elevenLabsManager = new ElevenLabsManager(elevenLabsApiKey, sfxPath);
            _sfxWebSocketServer = new SfxWebSocketServer();
            await _sfxWebSocketServer.Start();
            Console.WriteLine("ElevenLabs SFX enabled");
        }
        else
        {
            Console.WriteLine("ELEVENLABS_API_KEY not found, SFX disabled");
        }

        var mediaPath = Path.Combine(exeDirectory, "Media", "media");
        _mediaManager = new MediaManager(mediaPath, _config.MaxMediaDurationMinutes);
        Console.WriteLine("Media Manager enabled");

        _pusherClient = new PusherClient(_chatroomId, channelId);

        _pusherClient.OnConnected += async (sender, e) =>
        {
            await _api.Chat.SendMessageAsUserAsync(_broadcasterUserId, "Bot online!");
        };

        _pusherClient.OnChatMessage += async (sender, e) =>
        {
            await _userManager!.GetOrCreateUserAsync(e.Username);

            Console.WriteLine($"[{e.Username}]: {e.Content}");

            var context = new CommandContext
            {
                BroadcasterUserId = _broadcasterUserId,
                SendMessage = async (userId, message) =>
                {
                    await _api.Chat.SendMessageAsUserAsync(userId, message);
                },
                UserManager = _userManager,
                ElevenLabsManager = _elevenLabsManager,
                SfxWebSocketServer = _sfxWebSocketServer,
                MediaManager = _mediaManager,
                SfxCost = _config.SfxCost,
                MusicCost = _config.MusicCost,
                VideoCost = _config.VideoCost,
                CommandPrefix = _config.CommandPrefix,
                IsBroadcaster = e.IsBroadcaster,
                CommandHandler = _commandHandler
            };

            await _commandHandler!.HandleMessageAsync(e.Username, e.Content, context);
        };

        _pusherClient.OnGift += async (sender, e) =>
        {
            var tokensEarned = (int)(e.GiftAmount * _config.KickToTokenRatio);

            _userManager!.AddTokens(e.GifterUsername, tokensEarned);

            _kicksManager!.AddKicks(e.GiftAmount);

            var message = _config.GiftThankYouMessage
                .Replace("{username}", e.GifterUsername)
                .Replace("{giftName}", e.GiftName)
                .Replace("{tokens}", tokensEarned.ToString());

            await _api!.Chat.SendMessageAsUserAsync(_broadcasterUserId, message);

            Console.WriteLine($"[GIFT] {e.GifterUsername} sent {e.GiftAmount}x {e.GiftName} ({e.GiftTier}) - Earned {tokensEarned} tokens, {e.GiftAmount} kicks");
        };

        _pusherClient.OnSubscription += async (sender, e) =>
        {
            await _userManager!.GetOrCreateUserAsync(e.GifterUsername);

            var tokensEarned = e.SubCount * _config.SubToTokenRatio;
            _userManager.AddTokens(e.GifterUsername, tokensEarned);

            var message = _config.SubThankYouMessage
                .Replace("{username}", e.GifterUsername)
                .Replace("{count}", e.SubCount.ToString())
                .Replace("{tokens}", tokensEarned.ToString());

            await _api!.Chat.SendMessageAsUserAsync(_broadcasterUserId, message);

            Console.WriteLine($"[SUB] {e.GifterUsername} gifted {e.SubCount} sub(s) - Earned {tokensEarned} tokens");
        };

        _pusherClient.OnRewardRedeem += async (sender, e) =>
        {
            await _userManager!.GetOrCreateUserAsync(e.Username);

            _userManager.AddTokens(e.Username, e.TokenAmount);

            await _api!.Chat.SendMessageAsUserAsync(_broadcasterUserId, $"@{e.Username} redeemed {e.TokenAmount} tokens from channel points!");

            Console.WriteLine($"[REWARD] {e.Username} redeemed {e.TokenAmount} tokens from channel points - '{e.RewardTitle}'");
        };

        await _pusherClient.Connect();

        Console.WriteLine("Bot is running...");
        Console.WriteLine("Channel point redemptions enabled: Create rewards titled 'Redeem X tokens' to give users tokens");
    }

    private async Task<(int chatroomId, int channelId)> GetChannelIdsFromPublicApi(string channelName)
    {
        using var client = new HttpClient();
        client.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0");

        var response = await client.GetStringAsync($"https://twlkit.com/kick/__data.json?login={channelName.ToLower()}&x-sveltekit-invalidated=__1");

        var chatroomMatch = System.Text.RegularExpressions.Regex.Match(response, @"(\d{8,}),\s*""App\\\\Models\\\\Channel""");

        var allMatches = System.Text.RegularExpressions.Regex.Matches(response, @"\b(\d{8,})\b");

        if (!chatroomMatch.Success)
        {
            throw new Exception($"Could not extract chatroom ID from twlkit response");
        }

        if (allMatches.Count < 2)
        {
            throw new Exception($"Could not find enough IDs in twlkit response");
        }

        var channelId = int.Parse(allMatches[0].Groups[1].Value);

        Console.WriteLine($"DEBUG: Found {allMatches.Count} 8-digit IDs, using first one: {channelId}");

        return (int.Parse(chatroomMatch.Groups[1].Value), channelId);
    }

    private ApiSettings? LoadTokens()
    {
        if (!File.Exists("tokens.json")) return null;

        try
        {
            var json = File.ReadAllText("tokens.json");
            var data = JsonConvert.DeserializeObject<Dictionary<string, string>>(json);

            if (data == null || !data.ContainsKey("access_token") || !data.ContainsKey("refresh_token"))
            {
                File.Delete("tokens.json");
                return null;
            }

            var clientId = Environment.GetEnvironmentVariable("KICK_CLIENT_ID");
            var clientSecret = Environment.GetEnvironmentVariable("KICK_CLIENT_SECRET");

            return new ApiSettings
            {
                AccessToken = data["access_token"],
                RefreshToken = data["refresh_token"],
                ClientId = clientId!,
                ClientSecret = clientSecret!
            };
        }
        catch
        {
            File.Delete("tokens.json");
            return null;
        }
    }

    private void SaveTokens(ApiSettings settings)
    {
        var tokens = new Dictionary<string, string>
        {
            ["access_token"] = settings.AccessToken!,
            ["refresh_token"] = settings.RefreshToken!
        };

        File.WriteAllText("tokens.json", JsonConvert.SerializeObject(tokens, Formatting.Indented));
    }

    private void StartOAuthServer()
    {
        var exeDirectory = Path.GetDirectoryName(AppContext.BaseDirectory) ?? AppContext.BaseDirectory;
        var webserverPath = Path.Combine(exeDirectory, "Webserver");

        if (!Directory.Exists(webserverPath))
        {
            Console.WriteLine($"[NODE-ERROR] Webserver directory not found at: {webserverPath}");
            Console.WriteLine("[NODE-ERROR] Make sure the Webserver folder is in the same directory as KickBot.exe");
            Console.WriteLine("Press any key to exit...");
            Console.ReadKey();
            Environment.Exit(1);
            return;
        }

        Console.WriteLine($"[NODE] Starting server from: {webserverPath}");

        _nodeServerProcess = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = "node",
                Arguments = "server.js",
                WorkingDirectory = webserverPath,
                UseShellExecute = false,
                CreateNoWindow = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            }
        };

        _nodeServerProcess.OutputDataReceived += (sender, e) =>
        {
            if (!string.IsNullOrEmpty(e.Data))
                Console.WriteLine($"[NODE] {e.Data}");
        };

        _nodeServerProcess.ErrorDataReceived += (sender, e) =>
        {
            if (!string.IsNullOrEmpty(e.Data))
                Console.WriteLine($"[NODE-ERROR] {e.Data}");
        };

        try
        {
            _nodeServerProcess.Start();
            _nodeServerProcess.BeginOutputReadLine();
            _nodeServerProcess.BeginErrorReadLine();

            Thread.Sleep(2000);
            Console.WriteLine("[NODE] Server should be running");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[NODE-ERROR] Failed to start Node server: {ex.Message}");
            Console.WriteLine("[NODE-ERROR] Make sure Node.js is installed and 'node' is in your PATH");
            Console.WriteLine("Press any key to exit...");
            Console.ReadKey();
            Environment.Exit(1);
        }
    }
}