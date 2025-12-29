const fs = require("fs");
const path = require("path");

module.exports = {
  run: async ({ username }) => {
    const commandFiles = fs.readdirSync(path.join(__dirname)).filter(f => f.endsWith(".js"));
    const commandNames = commandFiles.map(f => `>${f.replace(".js", "")}`).join(", ");
    await global.sendChatMessage(`@${username}: Available commands: ${commandNames}`);
  }
};
