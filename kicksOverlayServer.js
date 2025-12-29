const express = require('express');
const KicksTracker = require('./KicksTracker');

class KicksOverlayServer {
  constructor(port = 3335) {
    this.port = port;
    this.app = express();
    this.server = null;
    this.kicksTracker = new KicksTracker();
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }
      next();
    });
    
    this.app.use(express.json());
    this.app.use(express.static('public'));
  }

 setupRoutes() {
  this.app.get('/api/kicks', (req, res) => {
    res.json({
      totalKicks: this.kicksTracker.getTotalKicks(),
      lastUpdated: this.kicksTracker.data.lastUpdated
    });
  });

  this.app.get('/api/kicks/history', (req, res) => {
    res.json({ history: this.kicksTracker.getHistory() });
  });

  this.app.post('/api/kicks/set', (req, res) => {
    const { amount } = req.body;
    if (typeof amount !== 'number' || amount < 0)
      return res.status(400).json({ error: 'Invalid amount' });

    this.kicksTracker.setTotal(amount);
    res.json({ success: true, totalKicks: this.kicksTracker.getTotalKicks() });
  });

  this.app.post('/api/kicks/add', (req, res) => {
    const { amount, giftName = 'Test', sender = 'TestUser' } = req.body;
    if (typeof amount !== 'number' || amount <= 0)
      return res.status(400).json({ error: 'Invalid amount' });

    const newTotal = this.kicksTracker.addKicks(amount, giftName, sender);
    res.json({ success: true, totalKicks: newTotal });
  });

  this.app.post('/api/kicks/reset', (req, res) => {
    this.kicksTracker.reset();
    res.json({ success: true, totalKicks: 0 });
  });

  this.app.get('/kicks-overlay', (req, res) => {
    res.sendFile(__dirname + '/overlays/kicks-overlay-auto.html');
  });
}


  start() {
    this.server = this.app.listen(this.port, () => {
      console.log(`Kicks overlay server running on http://localhost:${this.port}`);
      console.log(`OBS Browser Source URL: http://localhost:${this.port}/kicks-overlay`);
      console.log(`API endpoint: http://localhost:${this.port}/api/kicks`);
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      console.log('Kicks overlay server stopped');
    }
  }

  getKicksTracker() {
    return this.kicksTracker;
  }
}

module.exports = KicksOverlayServer;