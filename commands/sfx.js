const { tokenManager } = require("../tokenManager");
const path = require("path");

module.exports = {
  run: async ({ username, message, args }) => {
    try {
      const SFX_COST = 25;
      
      let sfxPrompt;
      
      if (args && Array.isArray(args) && args.length > 0) {
        sfxPrompt = args.join(' ');
      } else if (message && typeof message === 'string') {
        const messageParts = message.trim().split(' ');
        if (messageParts.length < 2) {
          await global.sendChatMessage(`@${username}: Usage: >sfx your sound effect description (costs ${SFX_COST} tokens)`);
          return;
        }
        sfxPrompt = messageParts.slice(1).join(' ');
      } else {
        console.error('sfx.js received invalid parameters:', { username, message, args });
        await global.sendChatMessage(`@${username}: Usage: >sfx your sound effect description (costs ${SFX_COST} tokens)`);
        return;
      }
      
      if (!sfxPrompt || sfxPrompt.trim().length === 0) {
        await global.sendChatMessage(`@${username}: Please provide a sound effect description!`);
        return;
      }
      
      if (sfxPrompt.length > 150) {
        await global.sendChatMessage(`@${username}: Prompt too long! Max 150 characters.`);
        return;
      }
      
      const hasEnough = await tokenManager.hasTokens(username, SFX_COST);
      if (!hasEnough) {
        const userData = await tokenManager.getUser(username);
        await global.sendChatMessage(`@${username}: Not enough tokens! You have ${userData.tokens}, need ${SFX_COST}.`);
        return;
      }
      
      if (global.modelManager && global.modelManager.isGenerating) {
        await global.sendChatMessage(`@${username}: AI generation already in progress. Please wait a moment.`);
        return;
      }
      
      if (!global.modelManager || !global.sfxManager) {
        await global.sendChatMessage(`@${username}: SFX system not ready. Please try again in a moment.`);
        return;
      }
      
      const newBalance = await tokenManager.spendTokens(username, SFX_COST, "AI SFX Generation");
      
      await global.sendChatMessage(`@${username}: Generating AI sound effect... (${SFX_COST} tokens spent, ${newBalance} remaining)`);
      
      try {
        const audioFile = await global.sfxManager.generateSFX(sfxPrompt, username);
        
        await global.sfxManager.playAudioWithWakeupSound(audioFile, username);
        
        await global.sendChatMessage(`@${username}: AI SFX "${sfxPrompt}" played successfully!`);
        
        console.log(`SFX file saved: ${path.basename(audioFile)}`);
        
      } catch (error) {
        console.error("AI SFX generation failed:", error);
        
        await tokenManager.addTokens(username, SFX_COST, "SFX refund - generation failed");
        await global.sendChatMessage(`@${username}: SFX generation failed. Tokens refunded.`);
      }
      
    } catch (error) {
      console.error("Error in AI SFX command:", error);
      console.error("Parameters received:", { username, message, args });
      await global.sendChatMessage(`@${username}: Error processing SFX command`);
    }
  }
};