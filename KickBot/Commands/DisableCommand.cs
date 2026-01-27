namespace KickBot.Commands;

public class DisableCommand : ICommand
{
    public string Name => "disable";
    public string Description => "Disable a command (Broadcaster only)";
    public bool BroadcasterOnly => true;

    public async Task ExecuteAsync(string username, string[] args, CommandContext context)
    {
        if (args.Length == 0)
        {
            await context.SendMessage(context.BroadcasterUserId, $"@{username} Usage: {context.CommandPrefix}disable <command>");
            return;
        }

        var commandName = args[0].TrimStart(context.CommandPrefix[0]).ToLower();

        if (commandName == "disable" || commandName == "enable")
        {
            await context.SendMessage(context.BroadcasterUserId, $"@{username} Cannot disable the {commandName} command!");
            return;
        }

        var command = context.CommandHandler.GetCommand(commandName);

        if (command == null)
        {
            await context.SendMessage(context.BroadcasterUserId, $"@{username} Command '{commandName}' not found.");
            return;
        }

        if (context.CommandHandler.IsCommandDisabled(commandName))
        {
            await context.SendMessage(context.BroadcasterUserId, $"@{username} Command '{context.CommandPrefix}{commandName}' is already disabled.");
            return;
        }

        context.CommandHandler.DisableCommand(commandName);
        await context.SendMessage(context.BroadcasterUserId, $"@{username} Command '{context.CommandPrefix}{commandName}' has been disabled.");
        Console.WriteLine($"[COMMAND] {username} disabled command: {commandName}");
    }
}