const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");

class SFXManager {
  constructor(elevenLabsManager) {
    this.elevenLabsManager = elevenLabsManager;
    this.outputDir = path.join(__dirname, "elevenlabs_output");
    
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir);
    }

    this.vlcPath = this.findVLC();
  }

  findVLC() {
    const possiblePaths = [
      path.join(__dirname, "vlc", "vlc.exe"),
      "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe",
      "C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe",
      path.join(process.env.PROGRAMFILES || "", "VideoLAN", "VLC", "vlc.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] || "", "VideoLAN", "VLC", "vlc.exe")
    ];

    for (const vlcPath of possiblePaths) {
      if (fs.existsSync(vlcPath)) {
        console.log(`Found VLC at: ${vlcPath}`);
        return vlcPath;
      }
    }

    console.log("VLC not found - will use PowerShell fallback");
    return null;
  }

  async generateSFX(prompt, username, durationSeconds = 15.0) {
    console.log(`Generating ElevenLabs SFX for ${username}: "${prompt}" (${durationSeconds}s)`);
    
    try {
      const audioFile = await this.elevenLabsManager.generateSFX(prompt, username, durationSeconds);
      console.log(`ElevenLabs SFX generated successfully: ${path.basename(audioFile)}`);
      return audioFile;
    } catch (error) {
      console.error(`ElevenLabs SFX generation failed:`, error.message);
      throw error;
    }
  }

  async playAudio(audioFile) {
    return new Promise((resolve) => {
      console.log(`Playing ElevenLabs SFX: ${path.basename(audioFile)}`);
      
      if (this.vlcPath && fs.existsSync(this.vlcPath)) {
        const vlcCmd = `"${this.vlcPath}" --play-and-exit --intf dummy --quiet --no-plugins-cache "${audioFile}" >NUL 2>&1`;
        
        exec(vlcCmd, { timeout: 15000 }, (vlcError) => {
          if (!vlcError) {
            console.log("ElevenLabs SFX played successfully via VLC");
          } else {
            console.error("VLC playback failed:", vlcError.message);
          }
          resolve();
        });
      } else {
        const fallbackCmd = `powershell -c "Add-Type -AssemblyName PresentationCore; $mediaPlayer = New-Object System.Windows.Media.MediaPlayer; $mediaPlayer.Open([uri]'${audioFile}'); $mediaPlayer.Play(); Start-Sleep -Seconds 5; $mediaPlayer.Stop(); $mediaPlayer.Close()"`;
        
        exec(fallbackCmd, { timeout: 15000 }, (psError) => {
          if (!psError) {
            console.log("ElevenLabs SFX played successfully via PowerShell");
          } else {
            console.error("PowerShell playback failed:", psError.message);
          }
          resolve();
        });
      }
    });
  }

  async playAudioWithWakeupSound(audioFile, username) {
    return new Promise((resolve, reject) => {
      const ffmpegPath = path.join(__dirname, "ffmpeg", "bin", "ffmpeg.exe");
      const wakeupSound = path.join(__dirname, "tts-sound.mp3");
      const timestamp = Date.now();
      const combinedFile = path.join(this.outputDir, `combined_sfx_${username}_${timestamp}.mp3`);
      
      if (!fs.existsSync(wakeupSound)) {
        console.log("Wake-up sound not found, playing SFX directly");
        return this.playAudio(audioFile).then(resolve).catch(reject);
      }
      
      if (!fs.existsSync(ffmpegPath)) {
        console.log("FFmpeg not found, playing SFX directly");
        return this.playAudio(audioFile).then(resolve).catch(reject);
      }
      
      
      const concatCmd = `"${ffmpegPath}" -i "${wakeupSound}" -i "${audioFile}" -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1[out]" -map "[out]" -c:a mp3 -b:a 128k "${combinedFile}"`;
      
      exec(concatCmd, { timeout: 15000 }, (concatError) => {
        if (concatError) {
          console.error("Failed to combine audio:", concatError.message);
          return this.playAudio(audioFile).then(resolve).catch(reject);
        }
        
        console.log(`Combined audio created: ${path.basename(combinedFile)}`);
        
        this.playAudio(combinedFile).then(() => {
          console.log("Combined SFX playback completed");
          resolve();
        }).catch((playError) => {
          console.error("Combined audio playback failed:", playError.message);
          this.playAudio(audioFile).then(resolve).catch(reject);
        });
      });
    });
  }

  getUsageStats() {
    return this.elevenLabsManager.getUsageStats();
  }
}

module.exports = SFXManager;