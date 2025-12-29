const fs = require('fs');
const path = require('path');

class KicksTracker {
  constructor() {
    this.dataFile = path.join(__dirname, 'data', 'kicks-total.json');
    this.data = {
      totalKicks: 0,
      lastUpdated: new Date().toISOString(),
      history: []
    };
    this.loadData();
  }

  loadData() {
    try {
      const dataDir = path.dirname(this.dataFile);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      if (fs.existsSync(this.dataFile)) {
        const rawData = fs.readFileSync(this.dataFile, 'utf-8');
        this.data = JSON.parse(rawData);
        console.log(`Loaded kicks data: ${this.data.totalKicks} total kicks`);
      } else {
        this.saveData();
        console.log('Created new kicks tracking file');
      }
    } catch (error) {
      console.error('Error loading kicks data:', error);
      this.saveData();
    }
  }

  saveData() {
    try {
      fs.writeFileSync(this.dataFile, JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.error('Error saving kicks data:', error);
    }
  }

  addKicks(amount, giftName, sender) {
    this.data.totalKicks += amount;
    this.data.lastUpdated = new Date().toISOString();

    this.data.history.push({
      timestamp: new Date().toISOString(),
      amount: amount,
      giftName: giftName,
      sender: sender,
      runningTotal: this.data.totalKicks
    });

    if (this.data.history.length > 100) {
      this.data.history = this.data.history.slice(-100);
    }

    this.saveData();
    
    console.log(`📊 Total kicks: ${this.data.totalKicks} (+${amount} from ${sender})`);
    
    return this.data.totalKicks;
  }

  getTotalKicks() {
    return this.data.totalKicks;
  }

  getHistory() {
    return this.data.history;
  }

  reset() {
    this.data.totalKicks = 0;
    this.data.history = [];
    this.data.lastUpdated = new Date().toISOString();
    this.saveData();
    console.log('Kicks tracker reset to 0');
  }

  setTotal(amount) {
    this.data.totalKicks = amount;
    this.data.lastUpdated = new Date().toISOString();
    this.saveData();
    console.log(`Kicks total manually set to: ${amount}`);
  }
}

module.exports = KicksTracker;