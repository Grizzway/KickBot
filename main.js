const startChatListener = require('./kickChatListener');
const { tokenManager } = require('./tokenManager');
const ElevenLabsManager = require('./elevenLabsManager');
const SFXManager = require('./sfxManager');
const MediaApiServer = require('./mediaApiServer');
const KicksOverlayServer = require('./kicksOverlayServer');

async function main() {
  try {
    console.log("Starting bot...");
    
    const elevenLabsManager = new ElevenLabsManager();
    await elevenLabsManager.initialize();
    
    const sfxManager = new SFXManager(elevenLabsManager);
    const mediaApiServer = new MediaApiServer(3333);
    
    global.elevenLabsManager = elevenLabsManager;
    global.sfxManager = sfxManager;
    
    global.modelManager = elevenLabsManager;
    
    console.log("Starting Media API server...");
    await mediaApiServer.start();
    
    global.mediaManager = mediaApiServer.getMediaManager();
    
    console.log("Starting Kicks overlay server...");
    const kicksOverlayServer = new KicksOverlayServer(3335);
    kicksOverlayServer.start();

    global.kicksTracker = kicksOverlayServer.getKicksTracker();
    
    console.log("Starting chat listener...");
    const chatBot = await startChatListener();
    
    if (chatBot && chatBot.isReady()) {
      console.log("Chat listener initialized successfully!");
      
      await chatBot.startChatMonitor();
            
      const usage = elevenLabsManager.getUsageStats();
      console.log(`ElevenLabs Usage This Month:`);
      console.log(`   Characters used: ${usage.used}/${usage.limit} (${usage.percentUsed}%)`);
      console.log(`   Characters remaining: ${usage.remaining}`);
      console.log(`   Estimated SFX remaining: ~${Math.floor(usage.remaining / 50)} generations`);
      
      if (usage.percentUsed > 80) {
        console.log(`Warning: High usage - consider upgrading ElevenLabs plan`);
      }
      
      console.log("=".repeat(60));      
      await sendOnlineMessage(chatBot);

      setInterval(async () => {
        try {
          await tokenManager.forceSave();
        } catch (error) {
          console.error("Auto-save error:", error);
        }
      }, 30000);
      
      setInterval(async () => {
        try {
          await tokenManager.forceSave();
          console.log("Backup save completed");
        } catch (error) {
          console.error("Backup save error:", error);
        }
      }, 300000);
      
      setInterval(() => {
        global.mediaManager.cleanupOldFiles(30);
      }, 300000);
      
      setInterval(() => {
        elevenLabsManager.saveUsageStats();
      }, 600000);
      
      setInterval(() => {
        const usage = elevenLabsManager.getUsageStats();
        if (usage.percentUsed > 50) {
          console.log(`Daily usage check: ${usage.used}/${usage.limit} characters (${usage.percentUsed}%)`);
        }
      }, 86400000);
      
    } else {
      console.log("Failed to initialize chat bot");
      process.exit(1);
    }
    
  } catch (error) {
    console.error("Error starting integrated system:", error.message);
    process.exit(1);
  }
}

async function sendOnlineMessage(chatBot) {
  console.log("=".repeat(60));
  console.log("ALL SYSTEMS ONLINE!");
  console.log("=".repeat(60));
  console.log("Chat bot: ONLINE");
  console.log("Gift detection: ONLINE"); 
  console.log("Token system: ONLINE");
  console.log("ElevenLabs SFX: READY");
  console.log("Media system: ONLINE");
  console.log("API Server: http://localhost:3333");
  console.log("=".repeat(60));
  console.log("Available overlays:");
  console.log("   - Now Playing: http://localhost:3333/nowplaying.html");
  console.log("   - Video Overlay: http://localhost:3333/video.html");
  console.log("   - OBS Control: http://localhost:3333/dock.html");
  console.log("   - Kicks Tracker: http://localhost:3335/kicks-overlay-auto.html");
  console.log("=".repeat(60));
  console.log("Bot is running... Press Ctrl+C to stop");
  
  const success = await chatBot.sendChatMessage("Bot online!");
  if (!success) {
    console.log("If message failed, your cookies might be expired");
  }
}

process.on('SIGINT', async () => {
  console.log('\nShutting down integrated system...');
  
  try {
    if (global.elevenLabsManager) {
      global.elevenLabsManager.saveUsageStats();
      console.log("ElevenLabs usage stats saved");
    }

    console.log("Saving user data...");
    await tokenManager.forceSave();
    console.log("User data saved successfully");
    
    if (global.mediaManager) {
      console.log("Stopping media system...");
    }
    
    console.log("Ensuring all data is written to disk...");
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log("Shutdown complete");
    
  } catch (error) {
    console.error("Error during shutdown:", error);
    
    try {
      console.log("Emergency user save attempt...");
      await tokenManager.forceSave();
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (emergencyError) {
      console.error("Emergency save failed:", emergencyError);
    }
  }
  
  process.exit(0);
});

process.on('uncaughtException', async (error) => {
  console.error('Uncaught Exception:', error);
  
  try {
    console.log("Emergency save on crash...");
    
    await tokenManager.forceSave();
    console.log("Users saved during crash handling");
    
    if (global.elevenLabsManager) {
      global.elevenLabsManager.saveUsageStats();
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  } catch (saveError) {
    console.error("Error during crash cleanup:", saveError);
  }
  
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  
  try {
    console.log("Emergency save on rejection...");
    
    await tokenManager.forceSave();
    console.log("Users saved during rejection handling");
    
    if (global.elevenLabsManager) {
      global.elevenLabsManager.saveUsageStats();
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  } catch (saveError) {
    console.error("Error during rejection cleanup:", saveError);
  }
});

main();