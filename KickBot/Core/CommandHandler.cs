using KickBot.Commands;
using System.Reflection;

namespace KickBot.Core;

public class CommandHandler
{
    private readonly Dictionary<string, ICommand> _commands = new();
    private readonly HashSet<string> _disabledCommands = new();
    private readonly string _prefix;

    public CommandHandler(string prefix)
    {
        _prefix = prefix;
        LoadCommands();
    }

    private void LoadCommands()
    {
        var commandType = typeof(ICommand);
        var assembly = Assembly.GetExecutingAssembly();

        var commandTypes = assembly.GetTypes()
            .Where(t => t.IsClass && !t.IsAbstract && commandType.IsAssignableFrom(t));

        foreach (var type in commandTypes)
        {
            var command = (ICommand)Activator.CreateInstance(type)!;
            _commands[command.Name.ToLower()] = command;
            Console.WriteLine($"Loaded command: {_prefix}{command.Name}");
        }

        Console.WriteLine($"Total commands loaded: {_commands.Count}");
    }

    public async Task HandleMessageAsync(string username, string content, CommandContext context)
    {
        if (!content.StartsWith(_prefix)) return;

        var parts = content.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var commandName = parts[0].Substring(_prefix.Length).ToLower();
        var args = parts.Skip(1).ToArray();

        if (_commands.TryGetValue(commandName, out var command))
        {
            if (_disabledCommands.Contains(commandName))
            {
                Console.WriteLine($"[COMMAND] {username} tried to use disabled command: {commandName}");
                return;
            }

            if (command.BroadcasterOnly && !context.IsBroadcaster)
            {
                await context.SendMessage(context.BroadcasterUserId, $"@{username} This command is broadcaster-only.");
                Console.WriteLine($"[COMMAND] {username} tried to use broadcaster-only command: {commandName}");
                return;
            }

            try
            {
                await command.ExecuteAsync(username, args, context);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ERROR] Command '{commandName}' failed: {ex.Message}");
            }
        }
    }

    public void DisableCommand(string commandName)
    {
        var normalizedName = commandName.ToLower();
        if (_commands.ContainsKey(normalizedName))
        {
            _disabledCommands.Add(normalizedName);
        }
    }

    public void EnableCommand(string commandName)
    {
        var normalizedName = commandName.ToLower();
        _disabledCommands.Remove(normalizedName);
    }

    public bool IsCommandDisabled(string commandName)
    {
        return _disabledCommands.Contains(commandName.ToLower());
    }

    public List<ICommand> GetAllCommands() => _commands.Values.ToList();

    public ICommand? GetCommand(string name) => _commands.GetValueOrDefault(name.ToLower());
}