const express = require('express');
const path = require('path');
const app = express();

console.log('Starting Express server...');
console.log('__dirname:', __dirname);

app.use(express.json());
app.use(express.static(__dirname));
app.use('/sfx', express.static(path.join(__dirname, 'sfx')));
app.use('/media/music', express.static(path.join(__dirname, '..', 'Media', 'media', 'music')));
app.use('/media/video', express.static(path.join(__dirname, '..', 'Media', 'media', 'video')));

app.get('/callback', (req, res) => {
    console.log('Callback route hit');
    res.sendFile(path.join(__dirname, 'callback.html'));
});

app.get('/sfx.html', (req, res) => {
    console.log('SFX route hit');
    res.sendFile(path.join(__dirname, 'sfx.html'));
});

app.get('/media-player.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'media-player.html'));
});

app.get('/media-dock.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'media-dock.html'));
});

app.get('/now-playing.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'now-playing.html'));
});

app.get('/kicks-overlay.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'kicks-overlay.html'));
});

app.get('/kicks-dock.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'kicks-dock.html'));
});

app.use((req, res) => {
    console.log('404:', req.url);
    res.status(404).send('Not found');
});

app.listen(3000, () => {
    console.log('OAuth callback server running on http://localhost:3000');
    console.log('Routes registered: /callback, /sfx.html, /media-player.html, /media-dock.html, /now-playing.html, /kicks-overlay.html, /kicks-dock.html');
});