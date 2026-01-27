namespace KickBot.Commands;

public class TokensCommand : ICommand
{
    public string Name => "tokens";
    public string Description => "Check your token balance or another user's balance";
    public bool BroadcasterOnly => false;

    public async Task ExecuteAsync(string username, string[] args, CommandContext context)
    {
        var normalizedUsername = username.ToLower();
        string targetUser = normalizedUsername;
        string displayTargetUser = username;

        if (args.Length > 0)
        {
            targetUser = args[0].TrimStart('@').ToLower();
            displayTargetUser = args[0].TrimStart('@');
        }

        var userData = context.UserManager.GetOrCreateUser(targetUser);

        if (targetUser == normalizedUsername)
        {
            await context.SendMessage(
                context.BroadcasterUserId,
                $"@{username}: You have {userData.Tokens} tokens! Total earned: {userData.TotalEarned}, Total spent: {userData.TotalSpent}"
            );
        }
        else
        {
            if (userData.TotalEarned > 0 || userData.TotalSpent > 0)
            {
                await context.SendMessage(
                    context.BroadcasterUserId,
                    $"@{username}: {displayTargetUser} has {userData.Tokens} tokens (earned: {userData.TotalEarned}, spent: {userData.TotalSpent})"
                );
            }
            else
            {
                await context.SendMessage(
                    context.BroadcasterUserId,
                    $"@{username}: {displayTargetUser} has no token activity yet"
                );
            }
        }

        Console.WriteLine($"[COMMAND] {username} checked tokens for {displayTargetUser}");
    }
}