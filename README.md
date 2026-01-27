# KickBot - Kick.com Chatbot

A feature-rich chatbot for Kick.com with token economy, AI sound effects, media requests, kicks tracking, and more!

## Features

### Token Economy
- Token system with configurable rewards
- Gift rewards (kicks convert to tokens)
- Channel point redemptions → tokens
- Subscription rewards (both gifted and regular subs)
- New user bonuses
- Persistent user data storage

### Media System
- YouTube music requests (audio only)
- YouTube video requests (with playback)
- Queue system with pre-downloading
- Configurable duration limits (up to 30 min hard cap)
- Real-time overlays with progress bars
- Control dock for OBS

### AI Sound Effects
- ElevenLabs integration for AI-generated SFX
- Real-time playback overlay
- Configurable token costs

### Kicks Tracker
- Track total kicks received
- Set goals with progress bar
- Manual adjustments (add/subtract)
- Real-time overlay
- Control dock for OBS

### Commands
- `>ping` - Test bot responsiveness
- `>tokens` - Check your token balance
- `>tokens @username` - Check another user's balance
- `>sfx <description>` - Generate AI sound effect (costs tokens)
- `>music <youtube_url>` - Queue music (costs tokens)
- `>video <youtube_url>` - Queue video (costs tokens)
- `>dox [@username]` - Fun fake dox command (random data)
- `>help` - List all available commands
- `>help <command>` - Get help for specific command

### Broadcaster-Only Commands
- `>addtokens @username <amount>` - Give tokens to users
- `>disable <command>` - Disable a command
- `>enable <command>` - Re-enable a command

## Setup

### Prerequisites
- .NET 8.0 SDK
- Node.js (for OAuth callback server)
- yt-dlp.exe (place in `Media/` folder)
- ffmpeg/ffprobe (place in `Media/ffmpeg/bin/` folder)

### Installation

1. **Clone the repository**
```bash
git clone <your-repo-url>
cd KickBot
```

2. **Install Node dependencies**
```bash
cd Webserver
npm install
```

3. **Create `.env` file in root directory**
Create a file named `.env` in the root directory with the following template:
```env
KICK_CLIENT_ID=
KICK_CLIENT_SECRET=
KICK_REDIRECT_URI=http://localhost:3000/callback
ELEVENLABS_API_KEY=
```

Fill in your credentials:
- `KICK_CLIENT_ID` and `KICK_CLIENT_SECRET`: Get from Kick.com developer dashboard
- `KICK_REDIRECT_URI`: Keep as `http://localhost:3000/callback` (unless you change the port)
- `ELEVENLABS_API_KEY`: Get from [ElevenLabs](https://elevenlabs.io/) (optional, only needed for SFX feature)

4. **Configure `config.json`**
```json
{
  "ChannelName": "YourChannelName",
  "CommandPrefix": ">",
  "NewUserBonus": 100,
  "WelcomeMessage": "Welcome to chat @{username}! Here are {tokens} bonus tokens!",
  "GiftThankYouMessage": "Thanks for the {giftName}, @{username}! You earned {tokens} tokens!",
  "SubThankYouMessage": "Thanks for gifting {count} sub(s), @{username}! You earned {tokens} tokens!",
  "SfxCost": 25,
  "MusicCost": 50,
  "VideoCost": 100,
  "MinimumKicks": 1,
  "KickToTokenRatio": 1.0,
  "SubToTokenRatio": 500,
  "MaxMediaDurationMinutes": 8
}
```

6. **Build and run**
```bash
dotnet build
dotnet run
```

## OBS Setup

### Browser Sources (Overlays)
Add these as **Browser Sources** in OBS with transparent background:

- **SFX Player**: `http://localhost:3000/sfx.html`
  - Recommended size: 1920x1080
  - Plays AI-generated sound effects

- **Media Player**: `http://localhost:3000/media-player.html`
  - Recommended size: 1920x1080 (or your desired video size)
  - Plays music/video requests

- **Now Playing**: `http://localhost:3000/now-playing.html`
  - Recommended size: 600x200
  - Shows current media with progress bar

- **Kicks Tracker**: `http://localhost:3000/kicks-overlay.html`
  - Recommended size: 400x300
  - Shows total kicks and goal progress

### Custom Browser Docks (Control Panels)
Add these as **Custom Browser Docks** in OBS (View → Docks → Custom Browser Docks):

- **Media Control**: `http://localhost:3000/media-dock.html`
  - Control media playback, view queue, add requests manually

- **Kicks Control**: `http://localhost:3000/kicks-dock.html`
  - Set goals, manually adjust kicks, reset totals

## Channel Point Redemptions

Create channel point rewards with titles matching this format:
- "Redeem 10 tokens"
- "Redeem 50 tokens"
- "Redeem 100 tokens"

The bot automatically parses the number and awards tokens to the redeemer!

## Token Rewards

Users automatically earn tokens from:
- **Gifts/Kicks**: 1 token per kick (configurable via `KickToTokenRatio`)
- **Subscriptions**: 500 tokens per sub (configurable via `SubToTokenRatio`)
- **Gifted Subs**: Gifter gets 500 tokens per sub gifted
- **Channel Points**: Amount specified in redemption title
- **New User Bonus**: 100 tokens (configurable)


## Troubleshooting

### Bot won't start
- Make sure all prerequisites are installed
- Check that `.env` file has correct API keys
- Verify `config.json` has your channel name

### Media requests not working
- Check console for download errors

### Overlays not showing
- Make sure Node server is running (starts automatically with bot)
- Check URLs are exactly as listed above
- Verify port 3000 isn't blocked by firewall

### Kicks tracker not updating
- Open the kicks-dock.html in browser to test API
- Check console for WebSocket connection errors
- Verify port 8082 isn't blocked
