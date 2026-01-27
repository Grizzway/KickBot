using Newtonsoft.Json;

namespace KickBot.Config;

public class BotConfig
{
    [JsonProperty("ChannelName")]
    public string ChannelName { get; set; } = "";

    [JsonProperty("CommandPrefix")]
    public string CommandPrefix { get; set; } = ">";

    [JsonProperty("NewUserBonus")]
    public int NewUserBonus { get; set; } = 100;

    [JsonProperty("WelcomeMessage")]
    public string WelcomeMessage { get; set; } = "Welcome to chat @{username}! Here are {tokens} bonus tokens!";

    [JsonProperty("GiftThankYouMessage")]
    public string GiftThankYouMessage { get; set; } = "Thanks for the {giftName}, @{username}! You earned {tokens} tokens!";

    [JsonProperty("SubThankYouMessage")]
    public string SubThankYouMessage { get; set; } = "Thanks for gifting {count} sub(s), @{username}! You earned {tokens} tokens!";

    [JsonProperty("SfxCost")]
    public int SfxCost { get; set; } = 25;

    [JsonProperty("MusicCost")]
    public int MusicCost { get; set; } = 50;

    [JsonProperty("VideoCost")]
    public int VideoCost { get; set; } = 100;

    [JsonProperty("MinimumKicks")]
    public int MinimumKicks { get; set; } = 1;

    [JsonProperty("KickToTokenRatio")]
    public double KickToTokenRatio { get; set; } = 1.0;

    [JsonProperty("SubToTokenRatio")]
    public int SubToTokenRatio { get; set; } = 500;

    [JsonProperty("MaxMediaDurationMinutes")]
    public int MaxMediaDurationMinutes { get; set; } = 8;

    public static BotConfig Load(string path = "config.json")
    {
        var fullPath = Path.GetFullPath(path);

        if (!File.Exists(fullPath))
        {
            var defaultConfig = new BotConfig();
            File.WriteAllText(fullPath, JsonConvert.SerializeObject(defaultConfig, Formatting.Indented));
            return defaultConfig;
        }

        var json = File.ReadAllText(fullPath);
        var config = JsonConvert.DeserializeObject<BotConfig>(json) ?? new BotConfig();

        return config;
    }
}