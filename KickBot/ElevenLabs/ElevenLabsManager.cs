using ElevenLabs;
using ElevenLabs.SoundGeneration;

namespace KickBot.ElevenLabs;

public class ElevenLabsManager
{
    private readonly ElevenLabsClient _client;
    private readonly string _outputDirectory;

    public ElevenLabsManager(string apiKey, string outputDirectory = "sfx")
    {
        _client = new ElevenLabsClient(apiKey);
        _outputDirectory = outputDirectory;

        if (!Directory.Exists(_outputDirectory))
        {
            Directory.CreateDirectory(_outputDirectory);
        }
    }

    public async Task<string> GenerateSoundEffect(string prompt, string username)
    {
        try
        {
            Console.WriteLine($"[ELEVENLABS] Generating SFX for {username}: {prompt}");

            var request = new SoundGenerationRequest(prompt, duration: 15);
            var clip = await _client.SoundGenerationEndpoint.GenerateSoundAsync(request);

            var timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var sanitizedUsername = SanitizeFilename(username);
            var fileName = $"{sanitizedUsername}_{timestamp}.mp3";
            var finalPath = Path.Combine(_outputDirectory, fileName);

            await File.WriteAllBytesAsync(finalPath, clip.ClipData.ToArray());

            Console.WriteLine($"[ELEVENLABS] SFX saved to: {finalPath}");

            return finalPath;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ELEVENLABS] Error generating SFX: {ex.Message}");
            throw;
        }
    }

    private string SanitizeFilename(string filename)
    {
        var invalid = Path.GetInvalidFileNameChars();
        return string.Join("_", filename.Split(invalid, StringSplitOptions.RemoveEmptyEntries));
    }
}