const { tokenManager } = require("./tokenManager");
const config = require("./KickGiftConfig");
const KicksTracker = require("./KicksTracker");

class KickGiftListener {
  constructor() {
    this.processedGifts = new Set();
    this.config = config;
    this.kicksTracker = global.kicksTracker || new KicksTracker();
  }

  async processGiftMessage(giftData) {
    const { sender, giftName, kickAmount, messageId } = giftData;
    if (this.processedGifts.has(messageId)) {
      return;
    }

    this.processedGifts.add(messageId);

    if (this.processedGifts.size > this.config.processing.maxProcessedGifts) {
      const oldestIds = Array.from(this.processedGifts).slice(0, 100);
      oldestIds.forEach(id => this.processedGifts.delete(id));
    }
    
    console.log(`KICK GIFT: ${sender} sent ${giftName} (${kickAmount} kicks)`);
  
    if (kickAmount < this.config.processing.minimumKicks) {
      console.log(`Gift amount below minimum: ${kickAmount} kicks`);
      if (global.sendChatMessage && this.config.messages.giftTooSmall) {
        const message = this.config.messages.giftTooSmall
          .replace('{username}', sender)
          .replace('{giftName}', giftName);
        await global.sendChatMessage(message);
      }
      return;
    }

    let conversionRate = this.config.kickGifts.defaultRate;
    
    if (this.config.kickGifts.giftRates && this.config.kickGifts.giftRates[giftName]) {
      conversionRate = this.config.kickGifts.giftRates[giftName];
    }
    
    const tokensEarned = Math.floor(kickAmount * conversionRate);
    
    if (tokensEarned <= 0) {
      console.log(`Calculated tokens too small: ${tokensEarned}`);
      return;
    }
    
    try {
      const normalizedUsername = sender.toLowerCase();
      const newBalance = await tokenManager.addTokens(
        normalizedUsername,
        tokensEarned,
        `Kick gift: ${giftName} (${kickAmount} kicks)`
      );
      
      console.log(`Added ${tokensEarned} tokens to ${sender} for ${giftName} gift`);
      console.log(`   ${sender} now has ${newBalance} tokens`);
      console.log(`   Conversion rate: ${conversionRate} token${conversionRate !== 1 ? 's' : ''} per kick`);
      const totalKicks = this.kicksTracker.addKicks(kickAmount, giftName, sender);
      
      if (global.sendChatMessage && this.config.messages.giftConfirmation) {
        const message = this.config.messages.giftConfirmation
          .replace('{username}', sender)
          .replace('{giftName}', giftName)
          .replace('{tokens}', tokensEarned)
          .replace('{balance}', newBalance);
        await global.sendChatMessage(message);
      }
      
      return {
        success: true,
        sender,
        giftName,
        kickAmount,
        tokensEarned,
        newBalance,
        conversionRate
      };
      
    } catch (error) {
      console.error("Error processing kick gift:", error);
      
      if (global.sendChatMessage && this.config.messages.giftError) {
        const message = this.config.messages.giftError
          .replace('{username}', sender)
          .replace('{giftName}', giftName);
        await global.sendChatMessage(message);
      }
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  parseGiftElement(htmlString) {
    try {

      const giftMatch = htmlString.match(/<button[^>]*title="([^"]+)"[^>]*>([^<]+)<\/button>\s*sent\s*<b[^>]*>([^<]+)<\/b>/);
      if (!giftMatch) {
        return null;
      }
      
      const sender = giftMatch[2].trim();
      const giftName = giftMatch[3].trim();
      const kickMatch = htmlString.match(/<span title="(\d+)">(\d+)<\/span>/);
      const kickAmount = kickMatch ? parseInt(kickMatch[1]) : 0;
      const indexMatch = htmlString.match(/data-index="(\d+)"/);
      const messageId = indexMatch ? indexMatch[1] : Date.now().toString();
      
      return {
        sender,
        giftName,
        kickAmount,
        messageId
      };
    } catch (error) {
      console.error("Error parsing gift element:", error);
      return null;
    }
  }
}

module.exports = KickGiftListener;