namespace KickBot.Commands;

public class HelpCommand : ICommand
{
    public string Name => "help";
    public string Description => "List all commands or get details about a specific command";
    public bool BroadcasterOnly => false;

    public async Task ExecuteAsync(string username, string[] args, CommandContext context)
    {
        if (args.Length == 0)
        {
            var commands = context.CommandHandler.GetAllCommands();
            var commandNames = commands
                .Where(c => !c.BroadcasterOnly || context.IsBroadcaster)
                .Select(c => $"{context.CommandPrefix}{c.Name}")
                .ToList();

            await context.SendMessage(
                context.BroadcasterUserId,
                $"@{username} Available commands: {string.Join(", ", commandNames)}. Use {context.CommandPrefix}help <command> for details."
            );
        }
        else
        {
            var commandName = args[0].TrimStart(context.CommandPrefix[0]).ToLower();
            var command = context.CommandHandler.GetCommand(commandName);

            if (command == null)
            {
                await context.SendMessage(
                    context.BroadcasterUserId,
                    $"@{username} Command '{commandName}' not found."
                );
                return;
            }

            if (command.BroadcasterOnly && !context.IsBroadcaster)
            {
                await context.SendMessage(
                    context.BroadcasterUserId,
                    $"@{username} Command '{commandName}' not found."
                );
                return;
            }

            var broadcasterTag = command.BroadcasterOnly ? " [Broadcaster Only]" : "";
            await context.SendMessage(
                context.BroadcasterUserId,
                $"@{username} {context.CommandPrefix}{command.Name}{broadcasterTag}: {command.Description}"
            );
        }

        Console.WriteLine($"[COMMAND] {username} used help");
    }
}