const fs = require("fs");
const path = require("path");

const COOKIES_PATH = path.join(__dirname, "cookies.json");

async function setupAuth(page, channel) {
  console.log("Setting up authentication...");
  
  if (!fs.existsSync(COOKIES_PATH)) {
    fs.writeFileSync(COOKIES_PATH, JSON.stringify([], null, 2));
    console.log("Created cookies.json file");
  }

  try {
    console.log("Navigating to login page...");
    await page.goto("https://kick.com/login", {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    await page.waitForTimeout(2000);

    console.log("Please log in manually in the browser window...");
    console.log("Waiting for login to complete...");

    await page.waitForFunction(
      () => {
        const userMenu = document.querySelector('[data-testid="user-menu"]');
        const loginButton = document.querySelector('button[data-testid="login-button"]');
        const profileIcon = document.querySelector('[data-testid="profile-icon"]');
        const userAvatar = document.querySelector('img[alt*="avatar"], img[alt*="profile"]');
        
        return (userMenu || profileIcon || userAvatar) && !loginButton;
      },
      {
        timeout: 300000,
        polling: 1000
      }
    );

    console.log("Login detected!");

    const cookies = await page.cookies();
    fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
    console.log("Cookies saved successfully");

    await page.waitForTimeout(2000);

  } catch (error) {
    if (error.message.includes('timeout')) {
      console.log("Login timeout - please try again");
      console.log("Make sure to complete the login process within 5 minutes");
    } else {
      console.log("Authentication error:", error.message);
    }
    throw error;
  }
}

async function verifyCookies(page, channel) {
  try {
    console.log("Verifying cookie validity...");
    
    await page.goto(`https://kick.com/${channel}`, {
      waitUntil: "domcontentloaded",
      timeout: 15000
    });

    await page.waitForTimeout(3000);

    const loginButton = await page.$('button[data-testid="login-button"]');
    const userMenu = await page.$('[data-testid="user-menu"]');
    
    if (!loginButton && userMenu) {
      console.log("Cookies are valid");
      return true;
    } else {
      console.log("Cookies are expired or invalid");
      return false;
    }
  } catch (error) {
    console.log("Error verifying cookies:", error.message);
    return false;
  }
}

function clearCookies() {
  try {
    if (fs.existsSync(COOKIES_PATH)) {
      fs.unlinkSync(COOKIES_PATH);
      console.log("Cleared invalid cookies");
    }
  } catch (error) {
    console.log("Error clearing cookies:", error.message);
  }
}

module.exports = { 
  setupAuth, 
  verifyCookies, 
  clearCookies 
};