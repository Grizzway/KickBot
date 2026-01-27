using Newtonsoft.Json;
using System.Diagnostics;
using System.Text;

namespace KickBot.Media;

public class MediaManager
{
    private readonly string _mediaDirectory;
    private readonly string _musicDirectory;
    private readonly string _videoDirectory;
    private readonly Queue<MediaItem> _queue = new();
    private MediaItem? _currentItem;
    private readonly MediaWebSocketServer _webSocketServer;
    private readonly string _ytdlpPath;
    private readonly string _ffprobePath;
    private readonly string _ffmpegPath;
    private bool _isPaused = false;
    private CancellationTokenSource? _playbackCts;
    private CancellationTokenSource? _downloadCts;
    private CancellationTokenSource? _predownloadCts;
    private bool _isProcessing = false;
    private readonly SemaphoreSlim _queueLock = new(1, 1);
    private readonly int _maxMediaMinutes;
    private const int HARD_CAP_MINUTES = 30;

    public MediaManager(string mediaDirectory = "media", int maxMediaMinutes = 10)
    {
        _mediaDirectory = Path.GetFullPath(mediaDirectory);
        _musicDirectory = Path.Combine(_mediaDirectory, "music");
        _videoDirectory = Path.Combine(_mediaDirectory, "video");
        _maxMediaMinutes = Math.Min(maxMediaMinutes, HARD_CAP_MINUTES);

        Directory.CreateDirectory(_musicDirectory);
        Directory.CreateDirectory(_videoDirectory);

        var projectRoot = Directory.GetParent(AppContext.BaseDirectory)!.Parent!.Parent!.Parent!.FullName;
        var mediaToolsPath = Path.Combine(projectRoot, "Media");
        _ytdlpPath = Path.Combine(mediaToolsPath, "yt-dlp.exe");
        _ffprobePath = Path.Combine(mediaToolsPath, "ffmpeg", "bin", "ffprobe.exe");
        _ffmpegPath = Path.Combine(mediaToolsPath, "ffmpeg", "bin", "ffmpeg.exe");

        if (!File.Exists(_ytdlpPath))
        {
            throw new Exception($"yt-dlp.exe not found at: {_ytdlpPath}");
        }

        if (!File.Exists(_ffprobePath))
        {
            throw new Exception($"ffprobe.exe not found at: {_ffprobePath}");
        }

        if (!File.Exists(_ffmpegPath))
        {
            throw new Exception($"ffmpeg.exe not found at: {_ffmpegPath}");
        }

        _webSocketServer = new MediaWebSocketServer();
        _webSocketServer.Start().Wait();
        _webSocketServer.SetMediaManager(this);

        Console.WriteLine($"[MEDIA] Media directory: {_mediaDirectory}");
        Console.WriteLine($"[MEDIA] yt-dlp path: {_ytdlpPath}");
        Console.WriteLine($"[MEDIA] ffprobe path: {_ffprobePath}");
        Console.WriteLine($"[MEDIA] ffmpeg path: {_ffmpegPath}");
        Console.WriteLine($"[MEDIA] Max media duration: {_maxMediaMinutes} minutes (HARD CAP: {HARD_CAP_MINUTES} minutes)");
        Console.WriteLine($"[MEDIA] Pre-download enabled: downloads next item while current plays");
    }

    public async Task<MediaQueueResult> QueueMedia(string url, string requestedBy, MediaType type)
    {
        if (!IsValidYouTubeUrl(url))
        {
            return new MediaQueueResult { Success = false, Message = "Invalid YouTube URL" };
        }

        var duration = await GetVideoDuration(url);

        if (duration > HARD_CAP_MINUTES * 60)
        {
            var durationMinutes = (int)(duration / 60);
            Console.WriteLine($"[MEDIA] Rejected: {url} - Duration {durationMinutes}min exceeds {HARD_CAP_MINUTES}min limit");
            return new MediaQueueResult
            {
                Success = false,
                Message = $"Video is {durationMinutes} minutes long. Maximum allowed: {HARD_CAP_MINUTES} minutes."
            };
        }

        await _queueLock.WaitAsync();
        try
        {
            var videoId = ExtractVideoId(url);
            var maxSeconds = _maxMediaMinutes * 60;

            var cachedFile = type == MediaType.Music
                ? Path.Combine(_musicDirectory, $"{videoId}_0-{maxSeconds}_audio.m4a")
                : Path.Combine(_videoDirectory, $"{videoId}_0-{maxSeconds}_360p.mp4");

            if (File.Exists(cachedFile))
            {
                Console.WriteLine($"[MEDIA] Found in cache, will play instantly: {videoId}");
            }

            var titleArgs = $"--get-title {url}";
            var titlePsi = new ProcessStartInfo
            {
                FileName = _ytdlpPath,
                Arguments = titleArgs,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                CreateNoWindow = true
            };

            string? title = null;
            using var titleProcess = Process.Start(titlePsi);
            if (titleProcess != null)
            {
                title = (await titleProcess.StandardOutput.ReadToEndAsync()).Trim();
                await titleProcess.WaitForExitAsync();
            }

            var item = new MediaItem
            {
                Id = Guid.NewGuid().ToString(),
                Url = url,
                Title = title ?? "Unknown Title",
                RequestedBy = requestedBy,
                Type = type,
                Status = MediaStatus.Queued
            };

            _queue.Enqueue(item);

            await BroadcastQueueUpdate();

            Console.WriteLine($"[MEDIA] Queued {type}: {title} by {requestedBy}");

            if (!_isProcessing)
            {
                _ = Task.Run(ProcessQueue);
            }

            return new MediaQueueResult { Success = true, Message = "Media queued", QueuePosition = _queue.Count };
        }
        finally
        {
            _queueLock.Release();
        }
    }

    private async Task<double> GetVideoDuration(string url)
    {
        var psi = new ProcessStartInfo
        {
            FileName = _ytdlpPath,
            Arguments = $"--get-duration {url}",
            UseShellExecute = false,
            RedirectStandardOutput = true,
            CreateNoWindow = true
        };

        using var process = Process.Start(psi);
        if (process == null) return 0;

        var output = (await process.StandardOutput.ReadToEndAsync()).Trim();
        await process.WaitForExitAsync();

        var parts = output.Split(':');
        if (parts.Length == 2)
        {
            if (int.TryParse(parts[0], out var minutes) && int.TryParse(parts[1], out var seconds))
            {
                return minutes * 60 + seconds;
            }
        }
        else if (parts.Length == 3)
        {
            if (int.TryParse(parts[0], out var hours) && int.TryParse(parts[1], out var minutes) && int.TryParse(parts[2], out var seconds))
            {
                return hours * 3600 + minutes * 60 + seconds;
            }
        }

        return 0;
    }

    private async Task ProcessQueue()
    {
        if (_isProcessing) return;

        await _queueLock.WaitAsync();
        if (_isProcessing)
        {
            _queueLock.Release();
            return;
        }
        _isProcessing = true;
        _queueLock.Release();

        while (true)
        {
            await _queueLock.WaitAsync();
            if (_queue.Count == 0)
            {
                _isProcessing = false;
                _currentItem = null;
                _queueLock.Release();
                await BroadcastNowPlaying();
                await BroadcastQueueUpdate();
                break;
            }

            _currentItem = _queue.Dequeue();
            _queueLock.Release();

            _currentItem.Status = MediaStatus.Downloading;
            _isPaused = false;

            await BroadcastNowPlaying();
            await BroadcastQueueUpdate();

            try
            {
                _downloadCts = new CancellationTokenSource();
                var startTime = DateTime.Now;
                var filePath = await DownloadMedia(_currentItem, _downloadCts.Token);
                var downloadTime = (DateTime.Now - startTime).TotalSeconds;

                if (_currentItem == null || _downloadCts.Token.IsCancellationRequested)
                {
                    if (!string.IsNullOrEmpty(filePath) && File.Exists(filePath))
                    {
                        File.Delete(filePath);
                    }
                    continue;
                }

                Console.WriteLine($"[MEDIA] Download completed in {downloadTime:F1}s");

                _currentItem.FilePath = filePath;
                _currentItem.Status = MediaStatus.Playing;

                await BroadcastNowPlaying();

                CheckAndStartPredownload();

                await PlayMedia(_currentItem);
            }
            catch (OperationCanceledException)
            {
                Console.WriteLine($"[MEDIA] Download cancelled");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[MEDIA] Error processing media: {ex.Message}");
                if (_currentItem != null)
                {
                    _currentItem.Status = MediaStatus.Error;
                }
            }

            CheckAndStartPredownload();
            await Task.Delay(2000);
        }
    }

    private void CheckAndStartPredownload()
    {
        _ = Task.Run(async () =>
        {
            await _queueLock.WaitAsync();
            MediaItem? nextItem = null;

            if (_currentItem != null && _currentItem.Status == MediaStatus.Playing && _queue.Count > 0)
            {
                nextItem = _queue.Peek();
            }

            _queueLock.Release();

            if (nextItem == null) return;

            var videoId = ExtractVideoId(nextItem.Url);
            var maxSeconds = _maxMediaMinutes * 60;

            var cachedFile = nextItem.Type == MediaType.Music
                ? Path.Combine(_musicDirectory, $"{videoId}_0-{maxSeconds}_audio.m4a")
                : Path.Combine(_videoDirectory, $"{videoId}_0-{maxSeconds}_360p.mp4");

            if (File.Exists(cachedFile))
            {
                Console.WriteLine($"[MEDIA-PREDOWNLOAD] Next item already cached: {nextItem.Title}");
                return;
            }

            _predownloadCts?.Cancel();
            _predownloadCts = new CancellationTokenSource();

            Console.WriteLine($"[MEDIA-PREDOWNLOAD] Starting background download: {nextItem.Title}");

            try
            {
                await DownloadMediaBackground(nextItem, _predownloadCts.Token);
                Console.WriteLine($"[MEDIA-PREDOWNLOAD] Completed: {nextItem.Title}");
            }
            catch (OperationCanceledException)
            {
                Console.WriteLine($"[MEDIA-PREDOWNLOAD] Cancelled");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[MEDIA-PREDOWNLOAD] Error: {ex.Message}");
            }
        });
    }

    private async Task<string> DownloadMedia(MediaItem item, CancellationToken ct)
    {
        var outputDir = item.Type == MediaType.Music ? _musicDirectory : _videoDirectory;
        var videoId = ExtractVideoId(item.Url);
        var maxSeconds = _maxMediaMinutes * 60;

        var cachedFile = item.Type == MediaType.Music
            ? Path.Combine(outputDir, $"{videoId}_0-{maxSeconds}_audio.m4a")
            : Path.Combine(outputDir, $"{videoId}_0-{maxSeconds}_360p.mp4");

        if (File.Exists(cachedFile))
        {
            Console.WriteLine($"[MEDIA] Using cached file (instant): {Path.GetFileName(cachedFile)}");
            return cachedFile;
        }

        var outputTemplate = item.Type == MediaType.Music
            ? Path.Combine(outputDir, $"{videoId}_0-{maxSeconds}_audio.%(ext)s")
            : Path.Combine(outputDir, $"{videoId}_0-{maxSeconds}_360p.%(ext)s");

        var args = item.Type == MediaType.Music
            ? $"-f \"bestaudio/best\" --external-downloader ffmpeg --external-downloader-args \"ffmpeg_i:-ss 0 -to {maxSeconds}\" -o \"{outputTemplate}\" {item.Url}"
            : $"-f \"best[height<=360][ext=mp4]/best[height<=360]\" --external-downloader ffmpeg --external-downloader-args \"ffmpeg_i:-ss 0 -to {maxSeconds}\" -o \"{outputTemplate}\" {item.Url}";

        Console.WriteLine($"[MEDIA] Downloading {_maxMediaMinutes}min from YouTube (max allowed: {HARD_CAP_MINUTES}min)...");

        var psi = new ProcessStartInfo
        {
            FileName = _ytdlpPath,
            Arguments = args,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        psi.Environment["PATH"] = Path.GetDirectoryName(_ffmpegPath) + ";" + Environment.GetEnvironmentVariable("PATH");

        using var process = Process.Start(psi);
        if (process == null)
            throw new Exception("Failed to start yt-dlp");

        var output = new StringBuilder();
        var error = new StringBuilder();

        process.OutputDataReceived += (sender, e) =>
        {
            if (!string.IsNullOrEmpty(e.Data))
            {
                output.AppendLine(e.Data);
                Console.WriteLine($"[YT-DLP] {e.Data}");
            }
        };

        process.ErrorDataReceived += (sender, e) =>
        {
            if (!string.IsNullOrEmpty(e.Data))
            {
                error.AppendLine(e.Data);
                Console.WriteLine($"[YT-DLP-ERROR] {e.Data}");
            }
        };

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        await using (ct.Register(() =>
        {
            try
            {
                if (!process.HasExited)
                {
                    process.Kill(true);
                }
            }
            catch { }
        }))
        {
            await process.WaitForExitAsync(ct);
        }

        if (ct.IsCancellationRequested)
        {
            throw new OperationCanceledException();
        }

        if (process.ExitCode != 0)
        {
            throw new Exception($"yt-dlp failed with exit code {process.ExitCode}: {error}");
        }

        if (File.Exists(cachedFile))
        {
            Console.WriteLine($"[MEDIA] Downloaded and cached: {Path.GetFileName(cachedFile)}");
            return cachedFile;
        }

        var possibleFiles = Directory.GetFiles(outputDir, $"{videoId}_0-{maxSeconds}_*.*");
        if (possibleFiles.Length > 0)
        {
            var actualPath = possibleFiles[0];
            Console.WriteLine($"[MEDIA] Downloaded and cached: {Path.GetFileName(actualPath)}");
            return actualPath;
        }

        Console.WriteLine($"[MEDIA] No files found with pattern: {videoId}_0-{maxSeconds}_*");
        Console.WriteLine($"[MEDIA] Output dir contents: {string.Join(", ", Directory.GetFiles(outputDir))}");
        throw new Exception($"Download failed - no file found");
    }

    private async Task DownloadMediaBackground(MediaItem item, CancellationToken ct)
    {
        var outputDir = item.Type == MediaType.Music ? _musicDirectory : _videoDirectory;
        var videoId = ExtractVideoId(item.Url);
        var maxSeconds = _maxMediaMinutes * 60;

        var cachedFile = item.Type == MediaType.Music
            ? Path.Combine(outputDir, $"{videoId}_0-{maxSeconds}_audio.m4a")
            : Path.Combine(outputDir, $"{videoId}_0-{maxSeconds}_360p.mp4");

        if (File.Exists(cachedFile))
        {
            return;
        }

        var outputTemplate = item.Type == MediaType.Music
            ? Path.Combine(outputDir, $"{videoId}_0-{maxSeconds}_audio.%(ext)s")
            : Path.Combine(outputDir, $"{videoId}_0-{maxSeconds}_360p.%(ext)s");

        var args = item.Type == MediaType.Music
            ? $"-f \"bestaudio/best\" --external-downloader ffmpeg --external-downloader-args \"ffmpeg_i:-ss 0 -to {maxSeconds}\" -o \"{outputTemplate}\" {item.Url}"
            : $"-f \"best[height<=360][ext=mp4]/best[height<=360]\" --external-downloader ffmpeg --external-downloader-args \"ffmpeg_i:-ss 0 -to {maxSeconds}\" -o \"{outputTemplate}\" {item.Url}";

        var psi = new ProcessStartInfo
        {
            FileName = _ytdlpPath,
            Arguments = args,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        psi.Environment["PATH"] = Path.GetDirectoryName(_ffmpegPath) + ";" + Environment.GetEnvironmentVariable("PATH");

        using var process = Process.Start(psi);
        if (process == null)
            throw new Exception("Failed to start yt-dlp");

        var output = new StringBuilder();
        var error = new StringBuilder();

        process.OutputDataReceived += (sender, e) =>
        {
            if (!string.IsNullOrEmpty(e.Data))
            {
                output.AppendLine(e.Data);
                Console.WriteLine($"[YT-DLP-PREDOWNLOAD] {e.Data}");
            }
        };

        process.ErrorDataReceived += (sender, e) =>
        {
            if (!string.IsNullOrEmpty(e.Data))
            {
                error.AppendLine(e.Data);
            }
        };

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        await using (ct.Register(() =>
        {
            try
            {
                if (!process.HasExited)
                {
                    process.Kill(true);
                }
            }
            catch { }
        }))
        {
            await process.WaitForExitAsync(ct);
        }
    }

    private string ExtractVideoId(string url)
    {
        if (url.Contains("youtu.be/"))
        {
            var parts = url.Split('/');
            var idPart = parts[^1];
            return idPart.Split('?')[0];
        }
        else if (url.Contains("youtube.com/watch"))
        {
            var uri = new Uri(url);
            var query = System.Web.HttpUtility.ParseQueryString(uri.Query);
            return query["v"] ?? Guid.NewGuid().ToString();
        }
        return Guid.NewGuid().ToString();
    }

    private async Task PlayMedia(MediaItem item)
    {
        var fileName = Path.GetFileName(item.FilePath!);
        var url = item.Type == MediaType.Music
            ? $"http://localhost:3000/media/music/{fileName}"
            : $"http://localhost:3000/media/video/{fileName}";

        var duration = await GetMediaDuration(item.FilePath!);

        await _webSocketServer.BroadcastPlay(new
        {
            type = item.Type.ToString().ToLower(),
            url,
            title = item.Title,
            requestedBy = item.RequestedBy,
            id = item.Id,
            duration
        });

        _playbackCts = new CancellationTokenSource();

        try
        {
            await Task.Delay(TimeSpan.FromSeconds(duration + 5), _playbackCts.Token);
        }
        catch (TaskCanceledException)
        {
        }
    }

    private async Task<double> GetMediaDuration(string filePath)
    {
        var psi = new ProcessStartInfo
        {
            FileName = _ffprobePath,
            Arguments = $"-v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 \"{filePath}\"",
            UseShellExecute = false,
            RedirectStandardOutput = true,
            CreateNoWindow = true
        };

        using var process = Process.Start(psi);
        if (process == null) return 180;

        var output = await process.StandardOutput.ReadToEndAsync();
        await process.WaitForExitAsync();

        return double.TryParse(output.Trim(), out var duration) ? duration : 180;
    }

    public async Task Skip()
    {
        _downloadCts?.Cancel();
        _playbackCts?.Cancel();
        _predownloadCts?.Cancel();

        var itemToClean = _currentItem;
        _currentItem = null;

        if (itemToClean != null)
        {
            await _webSocketServer.BroadcastControl("skip");
        }

        await BroadcastNowPlaying();

        CheckAndStartPredownload();
    }

    public async Task TogglePause()
    {
        _isPaused = !_isPaused;
        await _webSocketServer.BroadcastControl(_isPaused ? "pause" : "resume");
        await BroadcastNowPlaying();
        Console.WriteLine($"[MEDIA] {(_isPaused ? "Paused" : "Resumed")}");
    }

    private async Task BroadcastNowPlaying()
    {
        var data = new
        {
            type = "nowplaying",
            current = _currentItem == null ? null : new
            {
                id = _currentItem.Id,
                title = _currentItem.Title,
                requestedBy = _currentItem.RequestedBy,
                mediaType = _currentItem.Type.ToString().ToLower(),
                status = _currentItem.Status.ToString().ToLower()
            },
            queueLength = _queue.Count,
            isPaused = _isPaused
        };

        await _webSocketServer.Broadcast(JsonConvert.SerializeObject(data));
    }

    private async Task BroadcastQueueUpdate()
    {
        var data = new
        {
            type = "queue",
            items = _queue.Select(x => new
            {
                id = x.Id,
                title = x.Title ?? "Loading...",
                requestedBy = x.RequestedBy,
                mediaType = x.Type.ToString().ToLower()
            })
        };

        await _webSocketServer.Broadcast(JsonConvert.SerializeObject(data));
    }

    private bool IsValidYouTubeUrl(string url)
    {
        return url.Contains("youtube.com/watch") || url.Contains("youtu.be/");
    }
}

public class MediaItem
{
    public string Id { get; set; } = "";
    public string Url { get; set; } = "";
    public string? Title { get; set; }
    public string RequestedBy { get; set; } = "";
    public MediaType Type { get; set; }
    public MediaStatus Status { get; set; }
    public string? FilePath { get; set; }
}

public enum MediaType
{
    Music,
    Video
}

public enum MediaStatus
{
    Queued,
    Downloading,
    Playing,
    Error
}

public class MediaQueueResult
{
    public bool Success { get; set; }
    public string Message { get; set; } = "";
    public int QueuePosition { get; set; }
}