const axios = require('axios');

module.exports = {
  run: async ({ username, message }) => {
    try {
      const args = message.split(' ');
      let targetUser = username;
      
      if (args.length > 1 && args[1].startsWith('@')) {
        targetUser = args[1].substring(1);
      } else if (args.length > 1) {
        targetUser = args[1];
      }

      const doxData = await getDoxData(targetUser.toLowerCase());
      
      await global.sendChatMessage(
        `@${targetUser}'s real name is ${doxData.name} and they live at ${doxData.address}`
      );

    } catch (error) {
      console.error("Error in dox command:", error);
      await global.sendChatMessage(`@${username}: Failed to fetch dox for @${targetUser}. Try again later.`);
    }
  }
};

async function getDoxData(user) {
  const seed = user.slice(0, 17);

  const response = await axios.get(`https://randomuser.me/api/?inc=name,location&noinfo&seed=${seed}`);
  const data = response.data.results[0];

  const name = `${data.name.first} ${data.name.last}`;
  const address = `${data.location.street.number} ${data.location.street.name}, ${data.location.city}, ${data.location.state} ${data.location.postcode}`;

  return { name, address };
}