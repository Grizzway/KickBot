namespace KickBot.Commands;

public class SfxCommand : ICommand
{
    public string Name => "sfx";
    public string Description => "Generate an AI sound effect";
    public bool BroadcasterOnly => false;

    public async Task ExecuteAsync(string username, string[] args, CommandContext context)
    {
        if (context.ElevenLabsManager == null || context.SfxWebSocketServer == null)
        {
            await context.SendMessage(context.BroadcasterUserId, $"@{username} SFX is not enabled!");
            return;
        }

        if (args.Length == 0)
        {
            await context.SendMessage(context.BroadcasterUserId, $"@{username} Usage: {context.CommandPrefix}sfx <description> (Cost: {context.SfxCost} tokens)");
            return;
        }

        var userData = context.UserManager.GetOrCreateUser(username);

        if (userData.Tokens < context.SfxCost)
        {
            await context.SendMessage(context.BroadcasterUserId, $"@{username} Not enough tokens! You need {context.SfxCost} tokens but only have {userData.Tokens}.");
            return;
        }

        var prompt = string.Join(" ", args);

        await context.SendMessage(context.BroadcasterUserId, $"@{username} Generating SFX: \"{prompt}\"... (Cost: {context.SfxCost} tokens)");

        try
        {
            var filePath = await context.ElevenLabsManager.GenerateSoundEffect(prompt, username);

            context.UserManager.SpendTokens(username, context.SfxCost);

            await context.SfxWebSocketServer.BroadcastSfx(filePath);

            Console.WriteLine($"[COMMAND] {username} generated SFX: {prompt} - Cost: {context.SfxCost} tokens");
        }
        catch (Exception ex)
        {
            await context.SendMessage(context.BroadcasterUserId, $"@{username} Failed to generate SFX. Please try again.");
            Console.WriteLine($"[ERROR] SFX generation failed: {ex.Message}");
        }
    }
}