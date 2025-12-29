const fs = require("fs");
const path = require("path");

const COOKIES_PATH = path.join(__dirname, "cookies.json");

console.log("SUPER SIMPLE Cookie Extractor");
console.log("================================");
console.log("");

if (fs.existsSync(COOKIES_PATH)) {
  console.log("Existing cookies found - this will overwrite them");
  console.log("");
}

console.log("EASIEST METHOD - Just copy raw cookies:");
console.log("");
console.log("1. Open your browser and go to https://kick.com");
console.log("2. Make sure you're logged in");
console.log("3. Open Developer Tools (F12)");
console.log("4. Go to the 'Console' tab");
console.log("5. Copy and paste this ONE LINE:");
console.log("");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("document.cookie");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("");
console.log("6. Press ENTER");
console.log("7. Copy the output (the long string in quotes)");
console.log("8. Paste it below (WITHOUT the quotes):");
console.log("");

const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Paste your cookie string here: ', (cookieString) => {
  try {
    if (!cookieString || cookieString.trim().length === 0) {
      console.log("No cookie data provided");
      rl.close();
      return;
    }

    let cleanCookieString = cookieString.trim();
    if (cleanCookieString.startsWith('"') && cleanCookieString.endsWith('"')) {
      cleanCookieString = cleanCookieString.slice(1, -1);
    }

    const cookies = cleanCookieString.split('; ').map(cookiePair => {
      const [name, ...valueParts] = cookiePair.split('=');
      const value = valueParts.join('=');
      
      return {
        name: name.trim(),
        value: value || '',
        domain: '.kick.com',
        path: '/',
        httpOnly: false,
        secure: true,
        sameSite: 'Lax'
      };
    }).filter(cookie => cookie.name && cookie.name.length > 0);

    if (cookies.length > 0) {
      fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
      
      console.log("");
      console.log("SUCCESS! Cookies saved successfully!");
      console.log(`Saved ${cookies.length} cookies to: ${COOKIES_PATH}`);
      console.log("");
      console.log("You can now run your bot with: node main.js");
      console.log("");
      console.log("Cookie Summary:");
      cookies.forEach((cookie, index) => {
        console.log(`   ${index + 1}. ${cookie.name}`);
      });
      
    } else {
      console.log("No valid cookies found in the string");
      console.log("Make sure you:");
      console.log("   - Are logged into Kick.com");
      console.log("   - Copied the output from 'document.cookie'");
      console.log("   - Pasted the string without the outer quotes");
    }
    
  } catch (error) {
    console.log("Error processing cookies:", error.message);
    console.log("Make sure you copied just the cookie string");
    console.log("Don't include the quotes around it");
  }
  
  rl.close();
});

process.on('SIGINT', () => {
  console.log('\nCancelled by user');
  process.exit(0);
});