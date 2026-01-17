# Spotify Guessing Game

A Jackbox/Hitster-style multiplayer music guessing game powered by Spotify.

## How It Works

1. **Host** creates a room and connects a Spotify playlist
2. **Players** (up to 6) join the room using a 4-letter code on their phones
3. A random song from the playlist plays on the host's screen
4. Players guess facts about the song:
   - Song name (search from playlist)
   - Artist
   - Release year
   - Duration (over/under 3 minutes)
5. Player with the most correct answers wins a star (ties broken by submission time)
6. First to 10 stars wins!

## Requirements

- Node.js 18+
- Spotify Premium account (for the host)

## Setup

### 1. Create a Spotify App

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create a new app
3. Set the Redirect URI to `http://localhost:3001/callback`
4. Note your Client ID and Client Secret

### 2. Configure Environment

```bash
cd server
cp .env.example .env
```

Edit `.env` with your Spotify credentials:
```
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
REDIRECT_URI=http://localhost:3001/callback
PORT=3001
```

### 3. Install Dependencies

```bash
# Install server dependencies
cd server
npm install

# Install client dependencies
cd ../client
npm install
```

### 4. Run the Game

In two separate terminals:

```bash
# Terminal 1: Start the server
cd server
npm run dev

# Terminal 2: Start the client
cd client
npm run dev
```

### 5. Play!

1. Open `http://localhost:5173` in your browser
2. Click "Host a Game" and log in with Spotify
3. Paste a Spotify playlist URL
4. Share the room code with players
5. Players go to `http://localhost:5173/play` on their phones and enter the code

## Tech Stack

- **Frontend**: React + Vite
- **Backend**: Node.js + Express + Socket.io
- **Music**: Spotify Web Playback SDK

## Project Structure

```
spotify-guessing-game/
├── client/                 # React frontend
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home.jsx    # Landing page
│   │   │   ├── Host.jsx    # Host screen (TV)
│   │   │   └── Player.jsx  # Player screen (phone)
│   │   ├── App.jsx
│   │   └── App.css
│   └── package.json
├── server/                 # Node.js backend
│   ├── index.js            # Express + Socket.io + game logic
│   ├── .env.example
│   └── package.json
└── README.md
```

## Notes

- The host needs Spotify Premium for full song playback
- Players don't need Spotify accounts
- Works best with host on a big screen and players on phones
- For local network play, replace `localhost` with your computer's local IP
