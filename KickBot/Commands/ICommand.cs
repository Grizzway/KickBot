namespace KickBot.Commands;

public interface ICommand
{
    string Name { get; }
    string Description { get; }
    bool BroadcasterOnly { get; }
    Task ExecuteAsync(string username, string[] args, CommandContext context);
}

public class CommandContext
{
    public int BroadcasterUserId { get; set; }
    public Func<int, string, Task> SendMessage { get; set; } = null!;
    public Core.UserManager UserManager { get; set; } = null!;
    public ElevenLabs.ElevenLabsManager? ElevenLabsManager { get; set; }
    public ElevenLabs.SfxWebSocketServer? SfxWebSocketServer { get; set; }
    public Media.MediaManager? MediaManager { get; set; }
    public int SfxCost { get; set; }
    public int MusicCost { get; set; }
    public int VideoCost { get; set; }
    public string CommandPrefix { get; set; } = ">";
    public bool IsBroadcaster { get; set; }
    public Core.CommandHandler CommandHandler { get; set; } = null!;
}