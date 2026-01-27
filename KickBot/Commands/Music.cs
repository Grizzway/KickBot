namespace KickBot.Commands;

public class MusicCommand : ICommand
{
    public string Name => "music";
    public string Description => "Queue a music request from YouTube";
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
            await context.SendMessage(context.BroadcasterUserId, $"@{username} Usage: {context.CommandPrefix}music <youtube url> (Cost: {context.MusicCost} tokens)");
            return;
        }

        var userData = context.UserManager.GetOrCreateUser(username);

        if (userData.Tokens < context.MusicCost)
        {
            await context.SendMessage(context.BroadcasterUserId, $"@{username} Not enough tokens! You need {context.MusicCost} tokens but only have {userData.Tokens}.");
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
            var result = await context.MediaManager.QueueMedia(url, username, Media.MediaType.Music);

            if (result.Success)
            {
                context.UserManager.SpendTokens(username, context.MusicCost);
                await context.SendMessage(context.BroadcasterUserId, $"@{username} Music queued! Position: {result.QueuePosition} (Cost: {context.MusicCost} tokens)");
                Console.WriteLine($"[COMMAND] {username} queued music: {url} - Cost: {context.MusicCost} tokens");
            }
            else
            {
                await context.SendMessage(context.BroadcasterUserId, $"@{username} Failed to queue music: {result.Message}");
            }
        }
        catch (Exception ex)
        {
            await context.SendMessage(context.BroadcasterUserId, $"@{username} Failed to queue music. Please try again.");
            Console.WriteLine($"[ERROR] Music queue failed: {ex.Message}");
        }
    }
}