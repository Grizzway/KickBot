namespace KickBot.Commands;

public class EnableCommand : ICommand
{
    public string Name => "enable";
    public string Description => "Enable a previously disabled command (Broadcaster only)";
    public bool BroadcasterOnly => true;

    public async Task ExecuteAsync(string username, string[] args, CommandContext context)
    {
        if (args.Length == 0)
        {
            await context.SendMessage(context.BroadcasterUserId, $"@{username} Usage: {context.CommandPrefix}enable <command>");
            return;
        }

        var commandName = args[0].TrimStart(context.CommandPrefix[0]).ToLower();

        var command = context.CommandHandler.GetCommand(commandName);

        if (command == null)
        {
            await context.SendMessage(context.BroadcasterUserId, $"@{username} Command '{commandName}' not found.");
            return;
        }

        if (!context.CommandHandler.IsCommandDisabled(commandName))
        {
            await context.SendMessage(context.BroadcasterUserId, $"@{username} Command '{context.CommandPrefix}{commandName}' is already enabled.");
            return;
        }

        context.CommandHandler.EnableCommand(commandName);
        await context.SendMessage(context.BroadcasterUserId, $"@{username} Command '{context.CommandPrefix}{commandName}' has been enabled.");
        Console.WriteLine($"[COMMAND] {username} enabled command: {commandName}");
    }
}