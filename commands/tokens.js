const { tokenManager } = require("../tokenManager");

module.exports = {
  run: async ({ username, message }) => {
    try {
      const normalizedUsername = username.toLowerCase();
      
      const args = message.split(' ');
      let targetUser = normalizedUsername;
      let displayTargetUser = username;
      
      if (args.length > 1 && args[1].startsWith('@')) {
        targetUser = args[1].substring(1).toLowerCase();
        displayTargetUser = args[1].substring(1);
      } else if (args.length > 1) {
        targetUser = args[1].toLowerCase();
        displayTargetUser = args[1];
      }

      const userData = await tokenManager.getUser(targetUser);
      
      if (targetUser === normalizedUsername) {
        await global.sendChatMessage(
          `@${username}: You have ${userData.tokens} tokens! Total earned: ${userData.totalEarned}, Total spent: ${userData.totalSpent}`
        );
      } else {
        if (userData.totalEarned > 0 || userData.totalSpent > 0) {
          await global.sendChatMessage(
            `@${username}: ${displayTargetUser} has ${userData.tokens} tokens (earned: ${userData.totalEarned}, spent: ${userData.totalSpent})`
          );
        } else {
          await global.sendChatMessage(
            `@${username}: ${displayTargetUser} has no token activity yet`
          );
        }
      }

    } catch (error) {
      console.error("Error in tokens command:", error);
      await global.sendChatMessage(`@${username}: Error checking tokens`);
    }
  }
};