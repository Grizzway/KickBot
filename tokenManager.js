const fs = require("fs").promises;
const path = require("path");

class TokenManager {
  constructor(filePath = path.join(__dirname, "users.json")) {
    this.filePath = filePath;
    this.operationQueue = [];
    this.isProcessing = false;
    this.cache = new Map();
    this.lastSaved = 0;
    this.saveInterval = 5000;
    this.initialized = false;
    this.hasUnsavedChanges = false;
  }

  async init() {
    if (this.initialized) {
      return;
    }
    
    try {
      await this.loadFromFile();
      this.initialized = true;
      console.log("Token manager initialized successfully");
    } catch (error) {
      console.log("Creating new users.json file");
      this.initialized = true;
      this.hasUnsavedChanges = true;
      await this.saveToFile();
    }
  }

  async loadFromFile() {
    try {
      const data = await fs.readFile(this.filePath, "utf-8");
      const users = JSON.parse(data);
      
      this.cache.clear();
      Object.entries(users).forEach(([username, userData]) => {
        this.cache.set(username, userData);
      });
      
      console.log(`Loaded ${this.cache.size} users from file`);
      this.hasUnsavedChanges = false;
    } catch (error) {
      if (error.code === "ENOENT") {
        this.cache.clear();
        this.hasUnsavedChanges = true;
      } else {
        throw error;
      }
    }
  }

  async saveToFile() {
    try {
      const users = {};
      this.cache.forEach((userData, username) => {
        users[username] = userData;
      });
      
      const dir = path.dirname(this.filePath);
      try {
        await fs.access(dir);
      } catch {
        await fs.mkdir(dir, { recursive: true });
      }
      
      const tempFile = this.filePath + '.tmp';
      await fs.writeFile(tempFile, JSON.stringify(users, null, 2), 'utf-8');
      
      await fs.rename(tempFile, this.filePath);
      
      this.lastSaved = Date.now();
      this.hasUnsavedChanges = false;
      console.log(`Saved ${this.cache.size} users to file`);
    } catch (error) {
      console.error("Error saving to file:", error);
      throw error;
    }
  }

  queueOperation(operation) {
    return new Promise((resolve, reject) => {
      this.operationQueue.push({ operation, resolve, reject });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.isProcessing || this.operationQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.operationQueue.length > 0) {
      const { operation, resolve, reject } = this.operationQueue.shift();
      
      try {
        const result = await operation();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    }

    this.isProcessing = false;

    if (this.hasUnsavedChanges && (Date.now() - this.lastSaved > this.saveInterval)) {
      try {
        await this.saveToFile();
      } catch (error) {
        console.error("Auto-save failed:", error);
      }
    }
  }

  async isUserRegistered(username) {
    if (!this.initialized) {
      await this.init();
    }
    
    return this.queueOperation(async () => {
      const normalizedUsername = username.toLowerCase();
      return this.cache.has(normalizedUsername);
    });
  }

  async registerUser(username, initialTokens = 0) {
    if (!this.initialized) {
      await this.init();
    }
    
    return this.queueOperation(async () => {
      const normalizedUsername = username.toLowerCase();
      
      if (this.cache.has(normalizedUsername)) {
        return false;
      }
      
      const user = {
        tokens: initialTokens,
        totalSpent: 0,
        totalEarned: initialTokens,
        lastActivity: Date.now(),
        transactions: [{
          type: "earned",
          amount: initialTokens,
          reason: "New user bonus",
          timestamp: Date.now(),
          balance: initialTokens
        }],
        firstSeen: Date.now()
      };
      
      this.cache.set(normalizedUsername, user);
      this.hasUnsavedChanges = true;
      console.log(`Registered new user: ${normalizedUsername} with ${initialTokens} tokens`);
      return true;
    });
  }

  async getUser(username) {
    if (!this.initialized) {
      await this.init();
    }
    
    return this.queueOperation(async () => {
      const normalizedUsername = username.toLowerCase();
      let user = this.cache.get(normalizedUsername);
      if (!user) {
        user = {
          tokens: 0,
          totalSpent: 0,
          totalEarned: 0,
          lastActivity: Date.now(),
          transactions: [],
          firstSeen: Date.now()
        };
        this.cache.set(normalizedUsername, user);
        this.hasUnsavedChanges = true;
        console.log(`Created new user: ${normalizedUsername}`);
      } else {
        user.lastActivity = Date.now();
        this.hasUnsavedChanges = true;
      }
      return { ...user };
    });
  }

  async addTokens(username, amount, reason = "Purchase") {
    if (!this.initialized) {
      await this.init();
    }
    
    return this.queueOperation(async () => {
      const normalizedUsername = username.toLowerCase();
      let user = this.cache.get(normalizedUsername);
      if (!user) {
        user = {
          tokens: 0,
          totalSpent: 0,
          totalEarned: 0,
          lastActivity: Date.now(),
          transactions: [],
          firstSeen: Date.now()
        };
      }

      user.tokens += amount;
      user.totalEarned += amount;
      user.lastActivity = Date.now();
      
      user.transactions.push({
        type: "earned",
        amount: amount,
        reason: reason,
        timestamp: Date.now(),
        balance: user.tokens
      });

      if (user.transactions.length > 50) {
        user.transactions = user.transactions.slice(-50);
      }

      this.cache.set(normalizedUsername, user);
      this.hasUnsavedChanges = true;
      
      console.log(`Added ${amount} tokens to ${normalizedUsername} (${reason}). New balance: ${user.tokens}`);
      return user.tokens;
    });
  }

  async spendTokens(username, amount, reason = "Command") {
    if (!this.initialized) {
      await this.init();
    }
    
    return this.queueOperation(async () => {
      const normalizedUsername = username.toLowerCase();
      let user = this.cache.get(normalizedUsername);
      if (!user) {
        throw new Error("User not found");
      }

      if (user.tokens < amount) {
        throw new Error(`Insufficient tokens. Has ${user.tokens}, needs ${amount}`);
      }

      user.tokens -= amount;
      user.totalSpent += amount;
      user.lastActivity = Date.now();
      
      user.transactions.push({
        type: "spent",
        amount: amount,
        reason: reason,
        timestamp: Date.now(),
        balance: user.tokens
      });

      if (user.transactions.length > 50) {
        user.transactions = user.transactions.slice(-50);
      }

      this.cache.set(normalizedUsername, user);
      this.hasUnsavedChanges = true;
      
      console.log(`${normalizedUsername} spent ${amount} tokens (${reason}). New balance: ${user.tokens}`);
      return user.tokens;
    });
  }

  async hasTokens(username, amount) {
    if (!this.initialized) {
      await this.init();
    }
    
    return this.queueOperation(async () => {
      const normalizedUsername = username.toLowerCase();
      const user = this.cache.get(normalizedUsername);
      return user ? user.tokens >= amount : false;
    });
  }

  async getAllUsers() {
    if (!this.initialized) {
      await this.init();
    }
    
    return this.queueOperation(async () => {
      const users = {};
      this.cache.forEach((userData, username) => {
        users[username] = { ...userData };
      });
      return users;
    });
  }

  async forceSave() {
    if (!this.initialized) {
      await this.init();
    }
    
    try {
      await this.processQueue();
      await this.saveToFile();
      console.log(`Force save completed: ${this.cache.size} users saved`);
      return true;
    } catch (error) {
      console.error("Force save failed:", error);
      throw error;
    }
  }

  async getLeaderboard(type = "tokens", limit = 10) {
    if (!this.initialized) {
      await this.init();
    }
    
    return this.queueOperation(async () => {
      const users = Array.from(this.cache.entries())
        .map(([username, data]) => ({
          username,
          tokens: data.tokens,
          totalEarned: data.totalEarned,
          totalSpent: data.totalSpent
        }))
        .sort((a, b) => {
          switch (type) {
            case "earned": return b.totalEarned - a.totalEarned;
            case "spent": return b.totalSpent - a.totalSpent;
            default: return b.tokens - a.tokens;
          }
        })
        .slice(0, limit);

      return users;
    });
  }

  async getUserStats() {
    if (!this.initialized) {
      await this.init();
    }
    
    return this.queueOperation(async () => {
      const totalUsers = this.cache.size;
      let totalTokensInCirculation = 0;
      let totalTokensEarned = 0;
      let totalTokensSpent = 0;
      let newUsersToday = 0;
      
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
      
      this.cache.forEach((userData) => {
        totalTokensInCirculation += userData.tokens;
        totalTokensEarned += userData.totalEarned;
        totalTokensSpent += userData.totalSpent;
        
        if (userData.firstSeen && userData.firstSeen > oneDayAgo) {
          newUsersToday++;
        }
      });
      
      return {
        totalUsers,
        totalTokensInCirculation,
        totalTokensEarned,
        totalTokensSpent,
        newUsersToday
      };
    });
  }
}

const tokenManager = new TokenManager();

module.exports = {
  TokenManager,
  tokenManager
};