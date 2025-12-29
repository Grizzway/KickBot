const { exec, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const net = require("net");
const express = require("express");

class MediaManager {
  constructor() {
    this.MAX_DURATION_MINUTES = 8;
    this.MAX_DURATION_SECONDS = this.MAX_DURATION_MINUTES * 60;
    this.MEDIA_DELAY_SECONDS = 3;
    
    this.mediaQueue = [];
    this.knownTitles = new Map();
    this.knownDurations = new Map();
    
    this.vlcSocket = null;
    this.vlcProcess = null;
    this.currentMedia = null;
    this.isPlaying = false;
    this.isPaused = false;
    this.currentVolume = 100;
    this.videoTimer = null;
    this.videoSequenceId = 0;
    this.isTransitioning = false;
    this.skipRequested = false;
    this.pendingDeletions = new Set();
    
    this.outputDir = path.join(__dirname, "media_output");
    this.ytDlpPath = path.join(__dirname, "yt-dlp.exe");
    
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir);
    }
    
    this.initializeVLC();
    this.startPositionTracking();
  }

  initializeVLC() {
    this.launchVLC();
    setTimeout(() => {
      this.connectToVLC();
    }, 3000);
  }

  launchVLC() {
    const vlcPath = `"C:\\Program Files\\VideoLAN\\VLC\\vlc.exe"`;

    this.vlcProcess = spawn(vlcPath, [
      "--extraintf=rc",
      "--rc-host=127.0.0.1:8080",
      "--qt-start-minimized",
      "--no-video-title-show",
      "--no-qt-privacy-ask",
      "--no-video-deco"
    ], {
      shell: true,
      detached: true,
      stdio: 'pipe',
      windowsHide: false
    });

    console.log("VLC launched with remote control interface");
  }

  connectToVLC() {
    if (this.vlcSocket && !this.vlcSocket.destroyed) return;

    console.log("Attempting to connect to VLC on port 8080...");
    
    this.vlcSocket = net.createConnection(8080, "127.0.0.1", () => {
      console.log("Connected to VLC socket successfully");
    });

    this.vlcSocket.on("error", (err) => {
      console.error("VLC socket error:", err.message);
      console.log("Make sure VLC is running with remote control interface");
      setTimeout(() => this.connectToVLC(), 5000);
    });

    this.vlcSocket.on("data", (data) => {
      this.handleVLCResponse(data.toString().trim());
    });

    this.vlcSocket.on("close", () => {
      console.log("VLC socket closed, attempting to reconnect...");
      setTimeout(() => this.connectToVLC(), 3000);
    });
  }

  handleVLCResponse(message) {
    if (message.includes("status change: ( stop state")) {
      console.log("VLC stopped - processing next media after delay");
      if (this.isPlaying && !this.isTransitioning) {
        this.isTransitioning = true;
        
        const fileToDelete = this.currentMedia && this.currentMedia.type === 'music' && this.currentMedia.filename 
          ? this.currentMedia.filename 
          : null;
        
        this.stopVideoTimer();
        
        this.currentMedia = null;
        this.isPaused = false;
        
        if (fileToDelete && fs.existsSync(fileToDelete)) {
          fs.unlink(fileToDelete, (err) => {
            if (!err) {
              console.log(`Deleted file: ${fileToDelete}`);
            }
          });
        }
        
        const delay = this.skipRequested ? 500 : this.MEDIA_DELAY_SECONDS * 1000;
        this.skipRequested = false;
        
        console.log(`Transitioning to next media in ${delay}ms...`);
        setTimeout(() => {
          this.isTransitioning = false;
          this.processNextMedia();
        }, delay);
      }
      return;
    }

    if (message.includes("status change: ( pause state")) {
      this.isPaused = true;
      return;
    }

    if (message.includes("status change: ( play state")) {
      this.isPaused = false;
      return;
    }

    if (!this.currentMedia) return;

    const num = parseInt(message);
    if (!isNaN(num)) {
      if (this.lastQuery === "time") {
        this.currentMedia.position = num;
      } else if (this.lastQuery === "length") {
        this.currentMedia.length = num;
      } else if (this.lastQuery === "volume") {
        this.currentVolume = Math.round(num * 100 / 256);
      }
    }
  }

  safeDeleteFile(filePath, description = "file") {
    if (!filePath) {
      console.log(`No file path provided for ${description} deletion`);
      return;
    }
    
    if (this.pendingDeletions.has(filePath)) {
      console.log(`File ${filePath} already pending deletion`);
      return;
    }
    
    this.pendingDeletions.add(filePath);
    
    if (fs.existsSync(filePath)) {
      console.log(`Attempting to delete ${description}: ${filePath}`);
      fs.unlink(filePath, (err) => {
        this.pendingDeletions.delete(filePath);
        if (!err) {
          console.log(`Successfully deleted ${description}: ${filePath}`);
        } else {
          console.error(`Error deleting ${description} ${filePath}:`, err);
        }
      });
    } else {
      this.pendingDeletions.delete(filePath);
      console.log(`File ${filePath} does not exist, skipping deletion`);
    }
  }

  startPositionTracking() {
    setInterval(() => {
      if (this.isPlaying && this.currentMedia && this.currentMedia.type === 'music') {
        this.queryVLC("get_length", "length");
        setTimeout(() => this.queryVLC("get_time", "time"), 100);
        setTimeout(() => this.queryVLC("volume", "volume"), 200);
      }
    }, 1000);
  }

  queryVLC(command, type) {
    this.lastQuery = type;
    this.sendToVLC(command);
  }

  sendToVLC(command) {
    if (this.vlcSocket && !this.vlcSocket.destroyed) {
      this.vlcSocket.write(command + "\n");
    } else {
      console.error("VLC socket not connected");
    }
  }

  async fetchMediaInfo(url) {
    return new Promise((resolve, reject) => {
      const cachedTitle = this.knownTitles.get(url);
      const cachedDuration = this.knownDurations.get(url);
      
      if (cachedTitle && cachedDuration !== undefined) {
        resolve({ title: cachedTitle, duration: cachedDuration });
        return;
      }

      const cmdWithCookies = `"${this.ytDlpPath}" --cookies-from-browser chrome --print "%(title)s|%(duration)s" "${url}"`;
      const cmdNoCookies = `"${this.ytDlpPath}" --print "%(title)s|%(duration)s" "${url}"`;
      
      console.log(`Fetching media info with cookies: ${cmdWithCookies}`);
      
      exec(cmdWithCookies, (err, stdout, stderr) => {
        if (err) {
          console.log("Failed with cookies, trying without cookies...");
          console.log(`Trying: ${cmdNoCookies}`);
          
          exec(cmdNoCookies, (err2, stdout2, stderr2) => {
            console.log(`yt-dlp stdout: ${stdout2}`);
            console.log(`yt-dlp stderr: ${stderr2}`);
            
            if (err2) {
              console.error(`yt-dlp error: ${err2}`);
              
              const stderrLower = stderr2.toLowerCase();
              
              if (stderrLower.includes('http error 403') || stderrLower.includes('403: forbidden')) {
                reject(new Error("HTTP Error 403: Access forbidden. This video may be blocked or require special permissions."));
              } else if (stderrLower.includes('age') && stderrLower.includes('restricted')) {
                reject(new Error("Age-restricted video - cannot access"));
              } else if (stderrLower.includes('private video')) {
                reject(new Error("Private video"));
              } else if (stderrLower.includes('video unavailable')) {
                reject(new Error("Video unavailable"));
              } else {
                reject(new Error("Invalid YouTube URL or video not accessible"));
              }
              return;
            }

            const lines = stdout2.trim().split('\n');
            const lastLine = lines[lines.length - 1];
            const parts = lastLine.split('|');
            
            if (parts.length === 2) {
              const title = parts[0].trim();
              const duration = parseInt(parts[1]);
              
              this.knownTitles.set(url, title);
              this.knownDurations.set(url, duration);
              
              resolve({ title, duration });
            } else {
              reject(new Error("Invalid response format from yt-dlp"));
            }
          });
          return;
        }

        const lines = stdout.trim().split('\n');
        const lastLine = lines[lines.length - 1];
        const parts = lastLine.split('|');
        
        if (parts.length === 2) {
          const title = parts[0].trim();
          const duration = parseInt(parts[1]);
          
          this.knownTitles.set(url, title);
          this.knownDurations.set(url, duration);
          
          resolve({ title, duration });
        } else {
          reject(new Error("Invalid response format from yt-dlp"));
        }
      });
    });
  }

  async downloadAudio(url) {
    return new Promise((resolve, reject) => {
      const timestamp = Date.now();
      const outputTemplate = path.join(this.outputDir, `music_${timestamp}.%(ext)s`);
      
      const cmdWithCookies = `"${this.ytDlpPath}" --cookies-from-browser chrome -x --audio-format mp3 -o "${outputTemplate}" "${url}"`;
      const cmdNoCookies = `"${this.ytDlpPath}" -x --audio-format mp3 -o "${outputTemplate}" "${url}"`;
      
      console.log(`Downloading audio with cookies: ${cmdWithCookies}`);
      
      exec(cmdWithCookies, (err, stdout, stderr) => {
        if (err) {
          console.log("Failed with cookies, trying without cookies...");
          console.log(`Trying: ${cmdNoCookies}`);
          
          exec(cmdNoCookies, (err2, stdout2, stderr2) => {
            if (err2) {
              console.error(`yt-dlp download error: ${err2}`);
              
              const stderrLower = stderr2.toLowerCase();
              
              if (stderrLower.includes('http error 403') || stderrLower.includes('403: forbidden')) {
                reject(new Error("HTTP Error 403: Access forbidden. This video may be blocked or require special permissions."));
              } else {
                reject(new Error("Failed to download audio"));
              }
              return;
            }

            const outputPath = path.join(this.outputDir, `music_${timestamp}.mp3`);
            
            if (fs.existsSync(outputPath)) {
              console.log(`Audio downloaded: ${outputPath}`);
              resolve(outputPath);
            } else {
              reject(new Error("Download succeeded but file not found"));
            }
          });
          return;
        }

        const outputPath = path.join(this.outputDir, `music_${timestamp}.mp3`);
        
        if (fs.existsSync(outputPath)) {
          console.log(`Audio downloaded: ${outputPath}`);
          resolve(outputPath);
        } else {
          reject(new Error("Download succeeded but file not found"));
        }
      });
    });
  }

  async queueMedia(url, username, type) {
    try {
      console.log(`Fetching info for ${type} from ${username}: ${url}`);
      
      const info = await this.fetchMediaInfo(url);
      
      if (info.duration > this.MAX_DURATION_SECONDS) {
        const maxMinutes = Math.floor(this.MAX_DURATION_SECONDS / 60);
        const actualMinutes = Math.floor(info.duration / 60);
        throw new Error(`${type === 'music' ? 'Music' : 'Video'} too long! Max: ${maxMinutes} min, This: ${actualMinutes} min`);
      }
      
      let filename = null;
      
      if (type === 'music') {
        console.log(`Downloading audio for: ${info.title}`);
        filename = await this.downloadAudio(url);
      }
      
      const media = {
        url,
        title: info.title,
        duration: info.duration,
        requestedBy: username,
        type,
        filename,
        preloaded: type === 'music',
        sequenceId: this.videoSequenceId++
      };
      
      this.mediaQueue.push(media);
      
      console.log(`${type === 'music' ? 'Music' : 'Video'} queued: ${info.title}`);
      
      if (!this.isPlaying) {
        this.processNextMedia();
      }
      
      return {
        success: true,
        title: info.title,
        position: this.mediaQueue.length
      };
      
    } catch (error) {
      console.error(`Failed to queue ${type}:`, error.message);
      throw error;
    }
  }

  async processNextMedia() {
    if (this.mediaQueue.length === 0) {
      console.log("Queue empty - stopping playback");
      this.isPlaying = false;
      this.currentMedia = null;
      this.isPaused = false;
      return;
    }

    const media = this.mediaQueue.shift();
    this.currentMedia = media;
    this.isPlaying = true;
    this.isPaused = false;

    console.log(`Now playing ${media.type}: ${media.title} (requested by ${media.requestedBy})`);

    if (media.type === 'music') {
      this.sendToVLC(`clear`);
      await new Promise(resolve => setTimeout(resolve, 100));
      this.sendToVLC(`add ${media.filename}`);
    } else if (media.type === 'video') {
      this.currentMedia.actualDuration = media.duration;
      this.currentMedia.position = 0;
      
      this.startVideoTimer(media.duration, media.sequenceId);
    }
  }

  startVideoTimer(durationSeconds, sequenceId) {
    this.stopVideoTimer();
    
    let elapsed = 0;
    
    this.videoTimer = setInterval(() => {
      if (this.currentMedia && this.currentMedia.sequenceId === sequenceId) {
        if (!this.isPaused) {
          elapsed++;
          this.currentMedia.position = elapsed;
        }
        
        if (elapsed >= durationSeconds) {
          console.log(`Video timer reached end (${elapsed}s >= ${durationSeconds}s)`);
          this.handleVideoEnd();
        }
      }
    }, 1000);
  }

  handleVideoEnd() {
    if (!this.isPlaying || this.isTransitioning) return;
    
    this.isTransitioning = true;
    
    this.stopVideoTimer();
    
    this.currentMedia = null;
    this.isPaused = false;
    
    const delay = this.skipRequested ? 500 : this.MEDIA_DELAY_SECONDS * 1000;
    this.skipRequested = false;
    
    console.log(`Video ended - transitioning to next media in ${delay}ms...`);
    setTimeout(() => {
      this.isTransitioning = false;
      this.processNextMedia();
    }, delay);
  }

  stopVideoTimer() {
    if (this.videoTimer) {
      clearInterval(this.videoTimer);
      this.videoTimer = null;
    }
  }

  skip() {
    if (!this.isPlaying || this.isTransitioning) {
      return { success: false, message: "No media playing or already transitioning" };
    }
    
    console.log("Skip requested - forcing transition to next media");
    this.skipRequested = true;
    
    try {
      if (this.currentMedia && this.currentMedia.type === 'video') {
        console.log("Skipping video - direct transition");
        this.handleVideoEnd();
        
      } else if (this.currentMedia && this.currentMedia.type === 'music') {
        console.log("Skipping music - sending stop command to VLC");
        const currentTitle = this.currentMedia.title;
        this.sendToVLC("stop");
        console.log(`Skip command sent for music: ${currentTitle}`);
      } else {
        console.log("Skipping unknown media type - forcing next");
        this.isTransitioning = true;
        this.currentMedia = null;
        this.isPaused = false;
        
        setTimeout(() => {
          this.isTransitioning = false;
          this.skipRequested = false;
          this.processNextMedia();
        }, 500);
      }
      
      return { success: true, message: "Skipping current media" };
      
    } catch (error) {
      console.error("Error during skip:", error);
      this.isTransitioning = false;
      this.skipRequested = false;
      return { success: false, message: "Error occurred while skipping" };
    }
  }

  togglePause() {
    if (this.isPlaying) {
      if (this.currentMedia && this.currentMedia.type === 'video') {
        this.isPaused = !this.isPaused;
        return { success: true, message: this.isPaused ? "Pausing video" : "Resuming video" };
      } else {
        this.sendToVLC("pause");
        return { success: true, message: this.isPaused ? "Resuming playback" : "Pausing playback" };
      }
    }
    return { success: false, message: "No media playing" };
  }

  setVolume(volume) {
    if (typeof volume === 'number' && volume >= 0 && volume <= 100) {
      const vlcVolume = Math.round(volume * 256 / 100);
      this.sendToVLC(`volume ${vlcVolume}`);
      this.currentVolume = volume;
      return { success: true, message: `Volume set to ${volume}%` };
    }
    return { success: false, message: "Invalid volume level" };
  }

  removeFromQueue(index) {
    if (typeof index !== 'number' || index < 0 || index >= this.mediaQueue.length) {
      return { success: false, message: "Invalid media index" };
    }
    
    const removedMedia = this.mediaQueue.splice(index, 1)[0];
    
    if (removedMedia.filename) {
      this.safeDeleteFile(removedMedia.filename, "removed queue item");
    }
    
    return { 
      success: true, 
      message: `Removed ${removedMedia.type}: ${removedMedia.title}` 
    };
  }

  reorderQueue(fromIndex, toIndex) {
    if (typeof fromIndex !== 'number' || typeof toIndex !== 'number' || 
        fromIndex < 0 || fromIndex >= this.mediaQueue.length || 
        toIndex < 0 || toIndex >= this.mediaQueue.length) {
      return { success: false, message: "Invalid indices" };
    }
    
    const [movedMedia] = this.mediaQueue.splice(fromIndex, 1);
    this.mediaQueue.splice(toIndex, 0, movedMedia);
    
    return { 
      success: true, 
      message: `Moved ${movedMedia.type}: ${movedMedia.title}` 
    };
  }

  formatTime(seconds) {
    if (typeof seconds !== 'number' || isNaN(seconds)) return "00:00";
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  getCurrentStatus() {
    const current = this.currentMedia ? {
      title: this.currentMedia.title,
      requestedBy: this.currentMedia.requestedBy,
      type: this.currentMedia.type,
      sequenceId: this.currentMedia.sequenceId,
      position: this.formatTime(this.currentMedia.position || 0),
      length: this.formatTime(this.currentMedia.actualDuration || this.currentMedia.length || 0),
      raw: {
        position: this.currentMedia.position || 0,
        length: this.currentMedia.actualDuration || this.currentMedia.length || 0,
        sequenceId: this.currentMedia.sequenceId
      },
      isPaused: this.isPaused,
      url: this.currentMedia.url
    } : {
      title: "No media playing",
      requestedBy: "--",
      type: "none",
      sequenceId: null,
      position: "--:--",
      length: "--:--",
      raw: { position: 0, length: 0, sequenceId: null },
      isPaused: false,
      url: null
    };

    let next = null;
    if (this.mediaQueue.length > 0) {
      const nextMedia = this.mediaQueue[0];
      next = {
        title: nextMedia.title,
        requestedBy: nextMedia.requestedBy,
        type: nextMedia.type,
        sequenceId: nextMedia.sequenceId
      };
    }
    
    return {
      ...current,
      nextMedia: next,
      volume: this.currentVolume,
      isPlaying: this.isPlaying && !this.isPaused,
      queueLength: this.mediaQueue.length
    };
  }

  getQueue() {
    const queue = this.mediaQueue.map(media => ({
      title: media.title,
      requestedBy: media.requestedBy,
      type: media.type,
      sequenceId: media.sequenceId,
      preloaded: media.preloaded || false,
      url: media.url,
      duration: this.formatTime(media.duration)
    }));
    
    return {
      queue,
      current: this.getCurrentStatus()
    };
  }

  cleanupOldFiles(maxAgeMinutes = 30) {
    const now = Date.now();
    const maxAge = maxAgeMinutes * 60 * 1000;
    
    fs.readdir(this.outputDir, (err, files) => {
      if (err) return;
      
      files.forEach(file => {
        const filePath = path.join(this.outputDir, file);
        fs.stat(filePath, (err, stats) => {
          if (err) return;
          
          if (now - stats.mtime.getTime() > maxAge) {
            fs.unlink(filePath, (err) => {
              if (!err) {
                console.log(`Cleaned up old media file: ${file}`);
              }
            });
          }
        });
      });
    });
  }
}

module.exports = MediaManager;