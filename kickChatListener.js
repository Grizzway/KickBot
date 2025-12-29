const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");
const path = require("path");
const express = require("express");
const { tokenManager } = require("./tokenManager");
const KickGiftListener = require("./KickGiftListener");

puppeteer.use(StealthPlugin());

const CHANNEL = "Grizzway";
const COOKIES_PATH = path.join(__dirname, "cookies.json");
const NEW_USER_BONUS = 100;

let commandQueue = [];
let isProcessingCommand = false;

let chatMessages = [];
let overlayApp = null;
let overlayServer = null;
let deletedMessageIds = new Set();

let recentCommandKeys = new Map();

function startOverlayServer() {
  if (overlayServer) return;

  overlayApp = express();

  overlayApp.use("/overlays", express.static(path.join(__dirname, "overlays")));

  overlayApp.get("/api/chat", (req, res) => {
    const activeMessages = chatMessages.filter((msg) => !deletedMessageIds.has(msg.dataIndex));
    res.json({
      messages: activeMessages.slice(-20),
    });
  });

  overlayServer = overlayApp.listen(3334, () => {
    console.log("Chat overlay server running on http://localhost:3334");
    console.log("OBS Browser Source URL: http://localhost:3334/overlays/chat-overlay.html");
  });
}

function addChatMessage(username, message, badges = [], userColor = "#ffffff", dataIndex = null, isGift = false, giftData = null) {
  const chatMessage = {
    id: Date.now() + Math.random(),
    username,
    message,
    badges,
    userColor,
    timestamp: Date.now(),
    dataIndex,
    isGift,
    giftData,
  };

  chatMessages.push(chatMessage);

  if (chatMessages.length > 50) {
    chatMessages = chatMessages.slice(-50);
  }

  if (!isGift) {
    console.log(`[CHAT] ${username}: ${message}`);
  }
}

function markMessageDeleted(dataIndex) {
  deletedMessageIds.add(dataIndex);
}

module.exports = async function startChatListener() {
  if (!fs.existsSync(COOKIES_PATH)) {
    console.log("No cookies found! Please run: node getCookie-simple.js");
    throw new Error("Cookies required - run getCookie-simple.js first");
  }

  console.log("Starting bot with saved cookies...");

  startOverlayServer();

  const giftListener = new KickGiftListener();

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 800, height: 600 },
    args: ["--window-size=800,600", "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600 });

  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

  try {
    const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, "utf-8"));
    await page.setCookie(...cookies);
    console.log(`Loaded ${cookies.length} cookies`);
  } catch (error) {
    console.log("Error loading cookies:", error.message);
    throw error;
  }

  console.log("Opening chat page...");
  await page.goto(`https://kick.com/popout/${CHANNEL}/chat`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  await new Promise((resolve) => setTimeout(resolve, 5000));

  await page.addStyleTag({
    content: `
      body > div:last-child:has(span[style*="white-space: nowrap"]) {
        display: none !important;
      }
    `,
  });
  console.log("Hidden debug font test elements");

  try {
    await page.waitForSelector('[data-testid="chat-input"]', {
      timeout: 15000,
    });
    console.log("Chat ready - you appear to be logged in!");
  } catch {
    console.log("Chat input not found - cookies might be expired");
  }

  async function sendChatMessage(message) {
    try {
      console.log(`Sending: ${message}`);

      const chatInput = await page.$('[data-testid="chat-input"]');
      if (!chatInput) {
        console.log("Chat input not found");
        return false;
      }

      await chatInput.click();
      await new Promise((resolve) => setTimeout(resolve, 200));

      await page.evaluate(() => {
        const input = document.querySelector('[data-testid="chat-input"]');
        if (input) {
          input.innerHTML = '<p class="editor-paragraph"><br></p>';
          input.focus();
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      for (let char of message) {
        await page.keyboard.type(char);
      }

      await new Promise((resolve) => setTimeout(resolve, 200));

      await page.keyboard.press("Enter");

      console.log(`Message sent: ${message}`);
      return true;
    } catch (error) {
      console.log("Error sending message:", error.message);
      return false;
    }
  }

  global.sendChatMessage = sendChatMessage;

  function loadCommands() {
    const commands = new Map();
    const commandsDir = path.join(__dirname, "commands");

    if (!fs.existsSync(commandsDir)) {
      console.log("Commands folder not found, creating it...");
      fs.mkdirSync(commandsDir);
      console.log("Created commands folder");
      return commands;
    }

    const commandFiles = fs.readdirSync(commandsDir).filter((file) => file.endsWith(".js"));

    commandFiles.forEach((file) => {
      try {
        const commandName = file.replace(".js", "");
        delete require.cache[require.resolve(path.join(commandsDir, file))];
        const commandModule = require(path.join(commandsDir, file));
        if (commandModule && commandModule.run) {
          commands.set(commandName, commandModule);
          console.log(`Loaded command: >${commandName}`);
        }
      } catch (error) {
        console.log(`Error loading command ${file}:`, error.message);
      }
    });

    return commands;
  }

  const commands = loadCommands();

  async function handleNewUser(username) {
    const normalizedUsername = username.toLowerCase();

    const isRegistered = await tokenManager.isUserRegistered(normalizedUsername);
    if (!isRegistered) {
      console.log(`New user detected: ${username} - giving ${NEW_USER_BONUS} tokens`);
      await tokenManager.registerUser(normalizedUsername, NEW_USER_BONUS);

      await sendChatMessage(`Welcome ${username}! You've received ${NEW_USER_BONUS} free tokens!`);
    }
  }

  async function processCommandQueue() {
    if (isProcessingCommand || commandQueue.length === 0) {
      return;
    }

    isProcessingCommand = true;

    const { commandName, username, message } = commandQueue.shift();

    try {
      const command = commands.get(commandName);
      if (command && command.run) {
        console.log(`Executing command: >${commandName} for ${username}`);
        await command.run({
          username,
          message,
          sendMessage: sendChatMessage,
          tokenManager,
        });
      }
    } catch (error) {
      console.log(`Error executing command >${commandName}:`, error.message);
    } finally {
      isProcessingCommand = false;

      if (commandQueue.length > 0) {
        setTimeout(processCommandQueue, 100);
      }
    }
  }

  async function startChatMonitor() {
    console.log("Starting chat monitor...");

    await page.exposeFunction("handleMessage", async (data) => {
      const { username, message, userColor, badges, dataIndex, isGift, giftData, dedupKey } = data;

      addChatMessage(username, message, badges, userColor, dataIndex, isGift, giftData);

      if (!isGift) {
        await handleNewUser(username);
      }

      if (!isGift) {
        const normalized = String(message || "").replace(/\u200B/g, "").trim();

        if (normalized.startsWith(">")) {
          const commandName = normalized.slice(1).split(/\s+/)[0];
          const now = Date.now();

          const key = String(dedupKey || `${String(dataIndex || "")}|${String(username || "").toLowerCase()}|${normalized.toLowerCase()}`);

          const last = recentCommandKeys.get(key);
          if (last && now - last < 3000) {
            return;
          }

          recentCommandKeys.set(key, now);

          if (recentCommandKeys.size > 4000) {
            for (const [k, t] of recentCommandKeys) {
              if (now - t > 20000) recentCommandKeys.delete(k);
            }
          }

          console.log(`Command detected: >${commandName} from ${username}`);

          if (commands.has(commandName)) {
            commandQueue.push({
              commandName,
              username,
              message: normalized,
            });
            console.log(`Command queued: >${commandName} (Queue length: ${commandQueue.length})`);

            processCommandQueue();
          } else {
            console.log(`Unknown command: >${commandName}`);
          }
        }
      }
    });

    await page.exposeFunction("handleGiftMessage", async (data) => {
      console.log("Gift message received:", data);
      await giftListener.processGiftMessage(data);
    });

    await page.exposeFunction("handleDeletedMessage", async (data) => {
      const { dataIndex } = data;
      markMessageDeleted(dataIndex);
    });

    const result = await page.evaluate(() => {
      const normalizeText = (s) => String(s || "").replace(/\u200B/g, "").replace(/\s+/g, " ").trim();

      if (window.chatObserver) {
        window.chatObserver.disconnect();
      }

      if (window.chatScanInterval) {
        clearInterval(window.chatScanInterval);
      }

      if (window.deletedScanInterval) {
        clearInterval(window.deletedScanInterval);
      }

      window.processedMessageKeys = window.processedMessageKeys || new Set();
      window.processedDeletions = window.processedDeletions || new Set();
      window.processedCommandKeys = window.processedCommandKeys || new Set();

      const buildKey = (dataIndex, timestampText, username, message) => {
        return `${String(dataIndex || "")}|${normalizeText(timestampText)}|${normalizeText(username)}|${normalizeText(message)}`;
      };

      const buildCommandKey = (timestampText, username, message) => {
        return `${normalizeText(timestampText)}|${normalizeText(username).toLowerCase()}|${normalizeText(message)}`;
      };

      const findChatContainer = () => {
        return (
          document.querySelector("#chatroom-messages .no-scrollbar") ||
          document.querySelector('[data-testid="chatroom-messages"] .no-scrollbar') ||
          document.querySelector("#chatroom-messages") ||
          document.querySelector('[data-testid="chatroom-messages"]') ||
          document.querySelector('[role="log"]') ||
          document.querySelector("main") ||
          document.body
        );
      };

      const trimSets = () => {
        if (window.processedMessageKeys.size > 8000) {
          const entries = Array.from(window.processedMessageKeys);
          window.processedMessageKeys = new Set(entries.slice(-4000));
        }
        if (window.processedCommandKeys.size > 8000) {
          const entries = Array.from(window.processedCommandKeys);
          window.processedCommandKeys = new Set(entries.slice(-4000));
        }
      };

      const parseMessageContainer = (msgContainer) => {
        try {
          if (!msgContainer || msgContainer.nodeType !== 1) return;

          const dataIndex = msgContainer.getAttribute && msgContainer.getAttribute("data-index");

          if (window.processedDeletions.has(dataIndex)) {
            return;
          }

          const isNewMessagesDiv = msgContainer.querySelector && msgContainer.querySelector('span[style*="color: rgb(83, 252, 24)"]');
          if (isNewMessagesDiv) {
            return;
          }

          const deletedSpan = msgContainer.querySelector && msgContainer.querySelector("span.line-through");
          const deletedText = msgContainer.querySelector && msgContainer.querySelector("span.font-semibold");

          if (deletedSpan || (deletedText && deletedText.textContent && deletedText.textContent.includes("(Deleted)"))) {
            window.processedDeletions.add(dataIndex);
            window.dispatchEvent(
              new CustomEvent("chatMessageDeleted", {
                detail: { dataIndex },
              })
            );
            return;
          }

          const usernameButton = msgContainer.querySelector && msgContainer.querySelector('button.inline.font-bold[title]');
          const messageSpan = msgContainer.querySelector && msgContainer.querySelector("span.font-normal");
          const timestampSpan = msgContainer.querySelector && msgContainer.querySelector("span.text-neutral");

          const username = usernameButton ? normalizeText(usernameButton.textContent) : "";
          const message = messageSpan ? normalizeText(messageSpan.textContent) : "";
          const timestampText = timestampSpan ? normalizeText(timestampSpan.textContent) : "";

          const messageKey = buildKey(dataIndex, timestampText, username, message);

          if (window.processedMessageKeys.has(messageKey)) {
            return;
          }

          const giftText = msgContainer.querySelector && msgContainer.querySelector("b.font-semibold");
          const isGiftMessage = giftText && msgContainer.textContent && msgContainer.textContent.includes(" sent ");

          if (isGiftMessage) {
            const kickAmount = msgContainer.querySelector && msgContainer.querySelector("span[title]");
            if (usernameButton && giftText && kickAmount) {
              const sender = normalizeText(usernameButton.textContent);
              const giftName = normalizeText(giftText.textContent);
              const kicks = parseInt(kickAmount.getAttribute("title") || kickAmount.textContent, 10);

              window.dispatchEvent(
                new CustomEvent("kickGift", {
                  detail: {
                    sender,
                    giftName,
                    kickAmount: kicks,
                    messageId: dataIndex,
                    dataIndex,
                  },
                })
              );

              const userColor = (usernameButton && usernameButton.style && usernameButton.style.color) || "#ffffff";

              window.dispatchEvent(
                new CustomEvent("chatMessage", {
                  detail: {
                    username: sender,
                    message: `sent ${giftName}`,
                    userColor,
                    badges: [],
                    dataIndex,
                    isGift: true,
                    giftData: { giftName, kicks },
                    dedupKey: messageKey,
                  },
                })
              );

              window.processedMessageKeys.add(messageKey);
              trimSets();
              return;
            }
          }

          if (usernameButton && messageSpan) {
            const userColor = (usernameButton && usernameButton.style && usernameButton.style.color) || "#ffffff";

            const badges = [];
            const badgeSvgs = msgContainer.querySelectorAll ? msgContainer.querySelectorAll("svg") : [];
            badgeSvgs.forEach((svg) => {
              const titled = svg.closest && svg.closest("[title]");
              if (titled) {
                const title = titled.getAttribute("title");
                if (title && title !== username) {
                  badges.push({ title, svg: svg.outerHTML });
                }
              }
            });

            if (message && message.startsWith(">")) {
              const cmdKey = buildCommandKey(timestampText, username, message);
              if (window.processedCommandKeys.has(cmdKey)) {
                window.processedMessageKeys.add(messageKey);
                trimSets();
                return;
              }
              window.processedCommandKeys.add(cmdKey);
            }

            window.dispatchEvent(
              new CustomEvent("chatMessage", {
                detail: { username, message, userColor, badges, dataIndex, dedupKey: messageKey },
              })
            );

            window.processedMessageKeys.add(messageKey);
            trimSets();
          }
        } catch (err) {}
      };

      const scanAllMessages = () => {
        const all = document.querySelectorAll ? document.querySelectorAll("[data-index]") : [];
        all.forEach((msgContainer) => parseMessageContainer(msgContainer));
      };

      window.deletedScanInterval = setInterval(() => {
        const allMessages = document.querySelectorAll ? document.querySelectorAll("[data-index]") : [];
        allMessages.forEach((msgContainer) => {
          const dataIndex = msgContainer.getAttribute && msgContainer.getAttribute("data-index");
          if (window.processedDeletions.has(dataIndex)) return;

          const deletedSpan = msgContainer.querySelector && msgContainer.querySelector("span.line-through");
          const deletedText = msgContainer.querySelector && msgContainer.querySelector("span.font-semibold");

          if (deletedSpan || (deletedText && deletedText.textContent && deletedText.textContent.includes("(Deleted)"))) {
            window.processedDeletions.add(dataIndex);
            window.dispatchEvent(
              new CustomEvent("chatMessageDeleted", {
                detail: { dataIndex },
              })
            );
          }
        });
      }, 2000);

      window.chatScanInterval = setInterval(() => {
        scanAllMessages();
      }, 750);

      window.chatObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node && node.nodeType === 1) {
              if (node.matches && node.matches("[data-index]")) {
                parseMessageContainer(node);
              } else if (node.querySelectorAll) {
                const msgContainers = node.querySelectorAll("[data-index]");
                msgContainers.forEach((msgContainer) => parseMessageContainer(msgContainer));
              }
            }
          });
        });
      });

      const chatContainer = findChatContainer();

      if (chatContainer) {
        window.chatObserver.observe(chatContainer, {
          childList: true,
          subtree: true,
        });
        scanAllMessages();
        console.log("Chat observer started");
        console.log("Gift detection enabled");
        console.log("Deleted message checker started (runs every 2 seconds)");
        console.log("Periodic chat scan enabled");
        return true;
      } else {
        console.log("Chat container not found");
        return false;
      }
    });

    await page.evaluate(() => {
      window.addEventListener("chatMessage", (event) => {
        window.handleMessage(event.detail);
      });

      window.addEventListener("kickGift", (event) => {
        window.handleGiftMessage(event.detail);
      });

      window.addEventListener("chatMessageDeleted", (event) => {
        window.handleDeletedMessage(event.detail);
      });
    });

    if (result) {
      console.log("Chat monitor started successfully!");
      console.log("Now listening for messages...");
    } else {
      console.log("WARNING: Chat monitor failed to start - chat container not found");
    }
  }

  console.log("Commands loaded:");
  commands.forEach((cmd, name) => {
    console.log(`   >${name}`);
  });

  return {
    browser,
    page,
    sendChatMessage,
    startChatMonitor,
    isReady: () => page && !page.isClosed(),
    stopOverlayServer: () => {
      if (overlayServer) {
        overlayServer.close();
        overlayServer = null;
      }
    },
  };
};
