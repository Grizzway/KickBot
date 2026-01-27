namespace KickBot.Commands;

public class PingCommand : ICommand
{
    public string Name => "ping";
    public string Description => "Check if bot is responsive";
    public bool BroadcasterOnly => false;

    public async Task ExecuteAsync(string username, string[] args, CommandContext context)
    {
        Console.WriteLine($"[COMMAND] {username} used ping");
        await context.SendMessage(context.BroadcasterUserId, $"@{username} Pong!");
    }
}