const { tokenManager } = require("../tokenManager");
const path = require("path");

let mediaManager = null;

module.exports = {
  run: async ({ username, message }) => {
    try {
      const VIDEO_COST = 20;
      
      const args = message.split(' ');
      if (args.length < 2) {
        await global.sendChatMessage(`@${username}: Usage: >video YouTube_URL (costs ${VIDEO_COST} tokens)`);
        return;
      }
      
      const videoUrl = args.slice(1).join(' ').trim();
      
      if (!videoUrl.match(/(youtube\.com\/watch\?v=|youtu\.be\/)/)) {
        await global.sendChatMessage(`@${username}: Invalid YouTube URL! Please provide a valid YouTube link.`);
        return;
      }
      
      const hasEnough = await tokenManager.hasTokens(username, VIDEO_COST);
      if (!hasEnough) {
        const userData = await tokenManager.getUser(username);
        await global.sendChatMessage(`@${username}: Not enough tokens! You have ${userData.tokens}, need ${VIDEO_COST}.`);
        return;
      }
      
      if (!mediaManager) {
        mediaManager = global.mediaManager;
        if (!mediaManager) {
          await global.sendChatMessage(`@${username}: Media system not available right now.`);
          return;
        }
      }
      
      const newBalance = await tokenManager.spendTokens(username, VIDEO_COST, "Video Request");
      
      await global.sendChatMessage(`@${username}: Processing video request... (${VIDEO_COST} tokens spent, ${newBalance} remaining)`);
      
      try {
        const result = await mediaManager.queueMedia(videoUrl, username, 'video');
        
        if (result.success) {
          await global.sendChatMessage(`@${username}: "${result.title}" added to queue! Position: ${result.position}`);
        } else {
          throw new Error("Failed to queue video");
        }
        
      } catch (error) {
        console.error("Video request failed:", error);
        
        await tokenManager.addTokens(username, VIDEO_COST, "Video refund - request failed");
        
        if (error.message.includes("too long")) {
          await global.sendChatMessage(`@${username}: ${error.message} Tokens refunded.`);
        } else if (error.message.includes("Age-restricted")) {
          await global.sendChatMessage(`@${username}: Age-restricted video - try a different video. Tokens refunded.`);
        } else if (error.message.includes("Private video")) {
          await global.sendChatMessage(`@${username}: Private video - not accessible. Tokens refunded.`);
        } else if (error.message.includes("Video unavailable")) {
          await global.sendChatMessage(`@${username}: Video unavailable. Tokens refunded.`);
        } else if (error.message.includes("Invalid YouTube URL")) {
          await global.sendChatMessage(`@${username}: Invalid YouTube URL. Tokens refunded.`);
        } else if (error.message.includes("HTTP Error 403") || error.message.includes("403")) {
          await global.sendChatMessage(`@${username}: Video access blocked (403 error). Tokens refunded.`);
        } else {
          await global.sendChatMessage(`@${username}: Video request failed. Tokens refunded.`);
        }
      }
      
    } catch (error) {
      console.error("Error in video command:", error);
      await global.sendChatMessage(`@${username}: Error processing video request`);
    }
  }
};