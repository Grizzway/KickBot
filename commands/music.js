const { tokenManager } = require("../tokenManager");
const path = require("path");

let mediaManager = null;

module.exports = {
  run: async ({ username, message }) => {
    try {
      const MUSIC_COST = 10; 
      
      const args = message.split(' ');
      if (args.length < 2) {
        await global.sendChatMessage(`@${username}: Usage: >music YouTube_URL (costs ${MUSIC_COST} tokens)`);
        return;
      }
      
      const musicUrl = args.slice(1).join(' ').trim();
      
      if (!musicUrl.match(/(youtube\.com\/watch\?v=|youtu\.be\/)/)) {
        await global.sendChatMessage(`@${username}: Invalid YouTube URL! Please provide a valid YouTube link.`);
        return;
      }
      
      const hasEnough = await tokenManager.hasTokens(username, MUSIC_COST);
      if (!hasEnough) {
        const userData = await tokenManager.getUser(username);
        await global.sendChatMessage(`@${username}: Not enough tokens! You have ${userData.tokens}, need ${MUSIC_COST}. Buy tokens with kicks.`);
        return;
      }
      
      if (!mediaManager) {
        mediaManager = global.mediaManager;
        if (!mediaManager) {
          await global.sendChatMessage(`@${username}: Media system not available right now.`);
          return;
        }
      }
      
      const newBalance = await tokenManager.spendTokens(username, MUSIC_COST, "Music Request");
      
      await global.sendChatMessage(`@${username}: Processing music request... (${MUSIC_COST} tokens spent, ${newBalance} remaining)`);
      
      try {
        const result = await mediaManager.queueMedia(musicUrl, username, 'music');
        
        if (result.success) {
          await global.sendChatMessage(`@${username}: "${result.title}" added to queue! Position: ${result.position}`);
        } else {
          throw new Error("Failed to queue music");
        }
        
      } catch (error) {
        console.error("Music request failed:", error);
        
        await tokenManager.addTokens(username, MUSIC_COST, "Music refund - request failed");
        
        if (error.message.includes("too long")) {
          await global.sendChatMessage(`@${username}: ${error.message} Tokens refunded.`);
        } else if (error.message.includes("Invalid YouTube URL")) {
          await global.sendChatMessage(`@${username}: Invalid YouTube URL. Tokens refunded.`);
        } else if (error.message.includes("HTTP Error 403") || error.message.includes("403")) {
          await global.sendChatMessage(`@${username}: Music access blocked (403 error). Tokens refunded.`);
        } else {
          await global.sendChatMessage(`@${username}: Music request failed. Tokens refunded.`);
        }
      }
      
    } catch (error) {
      console.error("Error in music command:", error);
      await global.sendChatMessage(`@${username}: Error processing music request`);
    }
  }
};