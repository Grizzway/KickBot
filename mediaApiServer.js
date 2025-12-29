const express = require('express');
const path = require('path');
const MediaManager = require('./mediaManager');

class MediaApiServer {
  constructor(port = 3333) {
    this.port = port;
    this.app = express();
    this.mediaManager = new MediaManager();
    this.server = null;
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use((req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      next();
    });

    this.app.use(express.json());
    
    this.app.use(express.static(path.join(__dirname, 'overlays')));
  }

  setupRoutes() {
    this.app.get("/nowplaying", (req, res) => {
      const status = this.mediaManager.getCurrentStatus();
      res.json(status);
    });

    this.app.get("/queue", (req, res) => {
      const queueData = this.mediaManager.getQueue();
      res.json(queueData);
    });

    this.app.post("/control/skip", (req, res) => {
      const result = this.mediaManager.skip();
      res.json(result);
    });

    this.app.post("/control/toggle-pause", (req, res) => {
      const result = this.mediaManager.togglePause();
      res.json(result);
    });

    this.app.post("/control/volume", (req, res) => {
      const { volume } = req.body;
      const result = this.mediaManager.setVolume(volume);
      res.json(result);
    });

    this.app.post("/control/add-media", (req, res) => {
      const { url, requestedBy, type } = req.body;
      
      if (!url || !url.match(/(youtube\.com\/watch\?v=|youtu\.be\/)/)) {
        return res.json({ success: false, message: "Invalid YouTube URL" });
      }
      
      this.mediaManager.queueMedia(url, requestedBy || "OBS Dock", type || "music")
        .then(result => res.json(result))
        .catch(error => res.json({ success: false, message: error.message }));
    });

    this.app.post("/control/add-song", (req, res) => {
      const { url, requestedBy } = req.body;
      
      if (!url || !url.match(/(youtube\.com\/watch\?v=|youtu\.be\/)/)) {
        return res.json({ success: false, message: "Invalid YouTube URL" });
      }
      
      this.mediaManager.queueMedia(url, requestedBy || "OBS Dock", "music")
        .then(result => res.json(result))
        .catch(error => res.json({ success: false, message: error.message }));
    });

    this.app.post("/control/remove-media", (req, res) => {
      const { index } = req.body;
      const result = this.mediaManager.removeFromQueue(index);
      res.json(result);
    });
 
    this.app.post("/control/remove-song", (req, res) => {
      const { index } = req.body;
      const result = this.mediaManager.removeFromQueue(index);
      res.json(result);
    });

    this.app.post("/control/reorder-queue", (req, res) => {
      const { fromIndex, toIndex } = req.body;
      const result = this.mediaManager.reorderQueue(fromIndex, toIndex);
      res.json(result);
    });

    this.app.get("/video-status", (req, res) => {
      const status = this.mediaManager.getCurrentStatus();
      
      if (status.type === 'video' && status.isPlaying) {
        res.json({
          isPlaying: true,
          title: status.title,
          requestedBy: status.requestedBy,
          position: status.position,
          length: status.length,
          raw: status.raw,
          timeRemaining: this.mediaManager.formatTime(status.raw.length - status.raw.position),
          url: status.url
        });
      } else {
        res.json({
          isPlaying: false,
          title: null,
          requestedBy: null,
          position: "00:00",
          length: "00:00",
          raw: { position: 0, length: 0 },
          timeRemaining: "00:00",
          url: null
        });
      }
    });

    this.app.get("/health", (req, res) => {
      res.json({ 
        status: "ok", 
        mediaManager: "running",
        queueLength: this.mediaManager.mediaQueue.length,
        currentMedia: this.mediaManager.currentMedia ? this.mediaManager.currentMedia.title : "none"
      });
    });
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, (err) => {
        if (err) {
          reject(err);
        } else {
          console.log(`Media API server running on port ${this.port}`);
          console.log(`Now Playing overlay: http://localhost:${this.port}/nowplaying.html`);
          console.log(`Video overlay: http://localhost:${this.port}/video.html`);
          console.log(`OBS Control dock: http://localhost:${this.port}/dock.html`);
          resolve();
        }
      });
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
    }
  }

  getMediaManager() {
    return this.mediaManager;
  }
}

module.exports = MediaApiServer;