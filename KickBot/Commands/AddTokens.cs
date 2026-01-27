namespace KickBot.Commands;

public class AddTokensCommand : ICommand
{
    public string Name => "addtokens";
    public string Description => "Give tokens to a user (Broadcaster only)";
    public bool BroadcasterOnly => true;

    public async Task ExecuteAsync(string username, string[] args, CommandContext context)
    {
        if (args.Length < 2)
        {
            await context.SendMessage(context.BroadcasterUserId, $"@{username} Usage: {context.CommandPrefix}addtokens @username <amount>");
            return;
        }

        var targetUser = args[0].TrimStart('@').ToLower();

        if (!int.TryParse(args[1], out var amount) || amount <= 0)
        {
            await context.SendMessage(context.BroadcasterUserId, $"@{username} Invalid amount. Must be a positive number.");
            return;
        }

        await context.UserManager.GetOrCreateUserAsync(targetUser);
        context.UserManager.AddTokens(targetUser, amount);
        var newBalance = context.UserManager.GetTokens(targetUser);

        await context.SendMessage(context.BroadcasterUserId, $"@{username} Added {amount} tokens to @{targetUser}. New balance: {newBalance} tokens.");
        Console.WriteLine($"[COMMAND] {username} gave @{targetUser} {amount} tokens (new balance: {newBalance})");
    }
}