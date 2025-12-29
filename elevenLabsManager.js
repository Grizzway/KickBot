require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

class ElevenLabsManager {
  constructor() {
    this.apiKey = process.env.ELEVENLABS_API_KEY;
    this.baseURL = 'https://api.elevenlabs.io/v1';
    this.outputDir = path.join(__dirname, "elevenlabs_output");
    
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir);
    }
    
    this.isGenerating = false;
    this.monthlyUsage = 0;
    this.monthlyLimit = 28000;
  }

  async generateSFX(prompt, username, durationSeconds = 15.0) {
    if (this.isGenerating) {
      throw new Error("Generation already in progress");
    }

    this.isGenerating = true;

    try {
      if (this.monthlyUsage >= this.monthlyLimit) {
        throw new Error("Monthly ElevenLabs usage limit reached. Please upgrade plan or wait for next month.");
      }

      console.log(`Generating ElevenLabs SFX for ${username}: "${prompt}" (${durationSeconds}s)`);

      const characterCount = prompt.length;
      if (this.monthlyUsage + characterCount > this.monthlyLimit) {
        throw new Error(`Not enough characters remaining this month. Need ${characterCount}, have ${this.monthlyLimit - this.monthlyUsage} left.`);
      }

      const response = await axios.post(
        `${this.baseURL}/sound-generation`,
        {
          text: prompt,
          duration_seconds: durationSeconds,
          prompt_influence: 0.3
        },
        {
          headers: {
            'xi-api-key': this.apiKey,
            'Content-Type': 'application/json'
          },
          responseType: 'arraybuffer'
        }
      );

      this.monthlyUsage += characterCount;
      this.saveUsageStats();

      const timestamp = Date.now();
      const outputFile = path.join(this.outputDir, `sfx_${username}_${timestamp}.mp3`);
      
      fs.writeFileSync(outputFile, response.data);
      
      console.log(`ElevenLabs SFX generated: ${path.basename(outputFile)} (${durationSeconds}s, ${characterCount} chars, ${this.monthlyUsage}/${this.monthlyLimit} used)`);
      return outputFile;

    } catch (error) {
      console.error('ElevenLabs SFX failed:', error.response?.data || error.message);
      
      if (error.response?.status === 401) {
        throw new Error('ElevenLabs API authentication failed. Check your API key.');
      } else if (error.response?.status === 422) {
        throw new Error('Invalid SFX request. Try a different prompt or check your subscription plan.');
      } else if (error.response?.status === 429) {
        throw new Error('ElevenLabs rate limit exceeded. Please wait a moment and try again.');
      } else if (error.response?.status === 400) {
        throw new Error('Bad SFX request. The prompt might be too long or contain invalid characters.');
      }
      
      throw new Error(`SFX generation failed: ${error.response?.data?.detail || error.message}`);
    } finally {
      this.isGenerating = false;
    }
  }

  getUsageStats() {
    const remaining = this.monthlyLimit - this.monthlyUsage;
    const percentUsed = (this.monthlyUsage / this.monthlyLimit) * 100;
    
    return {
      used: this.monthlyUsage,
      limit: this.monthlyLimit,
      remaining: remaining,
      percentUsed: percentUsed.toFixed(1)
    };
  }

  saveUsageStats() {
    const statsFile = path.join(__dirname, 'elevenlabs_usage.json');
    const stats = {
      monthlyUsage: this.monthlyUsage,
      lastUpdated: new Date().toISOString(),
      month: new Date().getMonth(),
      year: new Date().getFullYear()
    };
    
    fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
  }

  loadUsageStats() {
    const statsFile = path.join(__dirname, 'elevenlabs_usage.json');
    
    if (fs.existsSync(statsFile)) {
      try {
        const stats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
        const currentMonth = new Date().getMonth();
        const currentYear = new Date().getFullYear();
        
        if (stats.month !== currentMonth || stats.year !== currentYear) {
          console.log('New month detected - resetting usage counter');
          this.monthlyUsage = 0;
          this.saveUsageStats();
        } else {
          this.monthlyUsage = stats.monthlyUsage || 0;
          console.log(`Loaded usage stats: ${this.monthlyUsage}/${this.monthlyLimit} characters used`);
        }
      } catch (error) {
        console.error('Error loading usage stats:', error.message);
        this.monthlyUsage = 0;
      }
    }
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
            fs.unlink(filePath, () => {
              console.log(`Cleaned up old audio: ${file}`);
            });
          }
        });
      });
    });
  }

  async initialize() {
    console.log('Initializing ElevenLabs Manager...');
    
    if (!this.apiKey) {
      throw new Error('ELEVENLABS_API_KEY not found in environment variables');
    }
    
    this.loadUsageStats();
    
    const usage = this.getUsageStats();
    console.log(`ElevenLabs usage: ${usage.used}/${usage.limit} characters (${usage.percentUsed}% used)`);
    
    if (usage.percentUsed > 80) {
      console.log('Warning: High ElevenLabs usage this month');
    }
    
    console.log('ElevenLabs Manager ready!');
  }
}

module.exports = ElevenLabsManager;