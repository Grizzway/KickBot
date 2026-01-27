using Newtonsoft.Json.Linq;

namespace KickBot.Commands;

public class DoxCommand : ICommand
{
    public string Name => "dox";
    public string Description => "Fake dox someone for fun";
    public bool BroadcasterOnly => false;

    public async Task ExecuteAsync(string username, string[] args, CommandContext context)
    {
        string targetUser = username;

        if (args.Length > 0)
        {
            targetUser = args[0].TrimStart('@');
        }

        try
        {
            var doxData = await GetDoxData(targetUser.ToLower());
            await context.SendMessage(
                context.BroadcasterUserId,
                $"@{targetUser}'s real name is {doxData.name} and they live at {doxData.address}"
            );
            Console.WriteLine($"[COMMAND] {username} doxed {targetUser}");
        }
        catch (Exception ex)
        {
            await context.SendMessage(
                context.BroadcasterUserId,
                $"@{username} Failed to fetch dox for @{targetUser}. Try again later."
            );
            Console.WriteLine($"[ERROR] Dox command failed: {ex.Message}");
        }
    }

    private async Task<(string name, string address)> GetDoxData(string user)
    {
        var seed = user.Length >= 17 ? user.Substring(0, 17) : user;

        using var client = new HttpClient();
        var response = await client.GetStringAsync($"https://randomuser.me/api/?inc=name,location&noinfo&seed={seed}");
        var json = JObject.Parse(response);
        var data = json["results"]![0]!;

        var firstName = data["name"]!["first"]!.ToString();
        var lastName = data["name"]!["last"]!.ToString();
        var name = $"{firstName} {lastName}";

        var streetNumber = data["location"]!["street"]!["number"]!.ToString();
        var streetName = data["location"]!["street"]!["name"]!.ToString();
        var city = data["location"]!["city"]!.ToString();
        var state = data["location"]!["state"]!.ToString();
        var postcode = data["location"]!["postcode"]!.ToString();
        var address = $"{streetNumber} {streetName}, {city}, {state} {postcode}";

        return (name, address);
    }
}