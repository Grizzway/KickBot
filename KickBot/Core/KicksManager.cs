using Newtonsoft.Json;

namespace KickBot.Core;

public class KicksManager
{
    private readonly string _kicksFilePath;
    private KicksData _data;
    private readonly Timer _autoSaveTimer;

    public event Func<int, Task>? OnKicksUpdated;

    public KicksManager(string kicksFilePath = "kicks.json")
    {
        _kicksFilePath = kicksFilePath;
        _data = LoadKicks();

        _autoSaveTimer = new Timer(AutoSave, null, TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(5));
    }

    private void AutoSave(object? state)
    {
        SaveKicks();
        Console.WriteLine($"[AUTO-SAVE] kicks.json saved at {DateTime.UtcNow:HH:mm:ss}");
    }

    private KicksData LoadKicks()
    {
        if (!File.Exists(_kicksFilePath))
        {
            var emptyData = new KicksData { Total = 0, Goal = 0, GoalTitle = "Kick Goal" };
            SaveKicks(emptyData);
            Console.WriteLine($"Created new {_kicksFilePath}");
            return emptyData;
        }

        try
        {
            var json = File.ReadAllText(_kicksFilePath);
            return JsonConvert.DeserializeObject<KicksData>(json) ?? new KicksData { Total = 0, Goal = 0, GoalTitle = "Kick Goal" };
        }
        catch
        {
            return new KicksData { Total = 0, Goal = 0, GoalTitle = "Kick Goal" };
        }
    }

    private void SaveKicks(KicksData? data = null)
    {
        var dataToSave = data ?? _data;
        var json = JsonConvert.SerializeObject(dataToSave, Formatting.Indented);
        File.WriteAllText(_kicksFilePath, json);
    }

    public void AddKicks(int amount)
    {
        _data.Total += amount;
        SaveKicks();
        OnKicksUpdated?.Invoke(_data.Total);
        Console.WriteLine($"[KICKS] Added {amount} kicks. New total: {_data.Total}");
    }

    public int GetTotal() => _data.Total;

    public void SetGoal(int goal, string? title = null)
    {
        _data.Goal = goal;
        if (title != null)
        {
            _data.GoalTitle = title;
        }
        SaveKicks();
        Console.WriteLine($"[KICKS] Goal set to {goal} - '{_data.GoalTitle}'");
    }

    public (int total, int goal, string goalTitle) GetKicksInfo()
    {
        return (_data.Total, _data.Goal, _data.GoalTitle);
    }

    public void ResetTotal()
    {
        _data.Total = 0;
        SaveKicks();
        OnKicksUpdated?.Invoke(_data.Total);
        Console.WriteLine($"[KICKS] Total reset to 0");
    }

    public void EmergencySave()
    {
        SaveKicks();
        Console.WriteLine($"[EMERGENCY-SAVE] kicks.json saved");
    }

    public void Dispose()
    {
        _autoSaveTimer?.Dispose();
        EmergencySave();
    }
}

public class KicksData
{
    [JsonProperty("total")]
    public int Total { get; set; }

    [JsonProperty("goal")]
    public int Goal { get; set; }

    [JsonProperty("goalTitle")]
    public string GoalTitle { get; set; } = "Kick Goal";
}