namespace KickBot.Commands;

public class VideoCommand : ICommand
{
    public string Name => "video";
    public string Description => "Queue a video request from YouTube";
    public bool BroadcasterOnly => false;

    public async Task ExecuteAsync(string username, string[] args, CommandContext context)
    {
        if (context.MediaManager == null)
        {
            await context.SendMessage(context.BroadcasterUserId, $"@{username} Media requests are not enabled!");
            return;
        }

        if (args.Length == 0)
        {
            await context.SendMessage(context.BroadcasterUserId, $"@{username} Usage: {context.CommandPrefix}video <youtube url> (Cost: {context.VideoCost} tokens)");
            return;
        }

        var userData = context.UserManager.GetOrCreateUser(username);

        if (userData.Tokens < context.VideoCost)
        {
            await context.SendMessage(context.BroadcasterUserId, $"@{username} Not enough tokens! You need {context.VideoCost} tokens but only have {userData.Tokens}.");
            return;
        }

        var url = args[0];

        if (!url.Contains("youtube.com/watch") && !url.Contains("youtu.be/"))
        {
            await context.SendMessage(context.BroadcasterUserId, $"@{username} Invalid YouTube URL!");
            return;
        }

        try
        {
            var result = await context.MediaManager.QueueMedia(url, username, Media.MediaType.Video);

            if (result.Success)
            {
                context.UserManager.SpendTokens(username, context.VideoCost);
                await context.SendMessage(context.BroadcasterUserId, $"@{username} Video queued! Position: {result.QueuePosition} (Cost: {context.VideoCost} tokens)");
                Console.WriteLine($"[COMMAND] {username} queued video: {url} - Cost: {context.VideoCost} tokens");
            }
            else
            {
                await context.SendMessage(context.BroadcasterUserId, $"@{username} Failed to queue video: {result.Message}");
            }
        }
        catch (Exception ex)
        {
            await context.SendMessage(context.BroadcasterUserId, $"@{username} Failed to queue video. Please try again.");
            Console.WriteLine($"[ERROR] Video queue failed: {ex.Message}");
        }
    }
}