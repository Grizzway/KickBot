using Newtonsoft.Json;

namespace KickBot.Core;

public class UserManager
{
    private readonly string _usersFilePath;
    private Dictionary<string, UserData> _users;
    private readonly int _newUserBonus;
    private readonly Timer _autoSaveTimer;
    private DateTime _lastSave = DateTime.UtcNow;

    public event Func<string, Task>? OnNewUser;

    public UserManager(int newUserBonus, string usersFilePath = "users.json")
    {
        _newUserBonus = newUserBonus;
        _usersFilePath = usersFilePath;
        _users = LoadUsers();

        _autoSaveTimer = new Timer(AutoSave, null, TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(5));
    }

    private void AutoSave(object? state)
    {
        SaveUsers(_users);
        Console.WriteLine($"[AUTO-SAVE] users.json saved at {DateTime.UtcNow:HH:mm:ss}");
    }

    private Dictionary<string, UserData> LoadUsers()
    {
        if (!File.Exists(_usersFilePath))
        {
            var emptyUsers = new Dictionary<string, UserData>();
            SaveUsers(emptyUsers);
            Console.WriteLine($"Created new {_usersFilePath}");
            return emptyUsers;
        }

        try
        {
            var json = File.ReadAllText(_usersFilePath);
            return JsonConvert.DeserializeObject<Dictionary<string, UserData>>(json)
                   ?? new Dictionary<string, UserData>();
        }
        catch
        {
            return new Dictionary<string, UserData>();
        }
    }

    private void SaveUsers(Dictionary<string, UserData> users)
    {
        var json = JsonConvert.SerializeObject(users, Formatting.Indented);
        File.WriteAllText(_usersFilePath, json);
        _lastSave = DateTime.UtcNow;
    }

    public async Task<UserData> GetOrCreateUserAsync(string username)
    {
        var normalizedUsername = username.ToLower();

        if (!_users.ContainsKey(normalizedUsername))
        {
            _users[normalizedUsername] = new UserData
            {
                Tokens = _newUserBonus,
                TotalSpent = 0,
                TotalEarned = _newUserBonus,
                LastActivity = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                FirstSeen = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                IsNewUser = true
            };

            SaveUsers(_users);
            Console.WriteLine($"[USER] New user {username} created with {_newUserBonus} tokens");

            if (OnNewUser != null)
            {
                await OnNewUser(username);
            }
        }
        else
        {
            _users[normalizedUsername].LastActivity = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (_users[normalizedUsername].IsNewUser)
            {
                _users[normalizedUsername].IsNewUser = false;
                SaveUsers(_users);
            }
        }

        return _users[normalizedUsername];
    }

    public UserData GetOrCreateUser(string username)
    {
        return GetOrCreateUserAsync(username).GetAwaiter().GetResult();
    }

    public void UpdateUser(string username, UserData userData)
    {
        var normalizedUsername = username.ToLower();
        _users[normalizedUsername] = userData;
        SaveUsers(_users);
    }

    public int GetTokens(string username)
    {
        var user = GetOrCreateUser(username);
        return user.Tokens;
    }

    public void AddTokens(string username, int amount)
    {
        var user = GetOrCreateUser(username);
        user.Tokens += amount;
        user.TotalEarned += amount;
        UpdateUser(username, user);
    }

    public bool SpendTokens(string username, int amount)
    {
        var user = GetOrCreateUser(username);

        if (user.Tokens < amount)
        {
            return false;
        }

        user.Tokens -= amount;
        user.TotalSpent += amount;
        UpdateUser(username, user);
        return true;
    }

    public void EmergencySave()
    {
        SaveUsers(_users);
        Console.WriteLine($"[EMERGENCY-SAVE] users.json saved");
    }

    public void Dispose()
    {
        _autoSaveTimer?.Dispose();
        EmergencySave();
    }
}

public class UserData
{
    [JsonProperty("tokens")]
    public int Tokens { get; set; }

    [JsonProperty("totalSpent")]
    public int TotalSpent { get; set; }

    [JsonProperty("totalEarned")]
    public int TotalEarned { get; set; }

    [JsonProperty("lastActivity")]
    public long LastActivity { get; set; }

    [JsonProperty("firstSeen")]
    public long FirstSeen { get; set; }

    [JsonProperty("isNewUser")]
    public bool IsNewUser { get; set; }
}