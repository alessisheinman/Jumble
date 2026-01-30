# Jumble

A Jackbox/Hitster-style multiplayer music guessing game powered by Deezer.

## How It Works

1. **Host** creates a room and enters a Deezer playlist URL
2. **Players** (up to 6) join the room using a 4-letter code on their phones
3. A random 30-second song preview from the playlist plays on the host's screen
4. Players guess facts about the song:
   - Song name (search from playlist)
   - Artist
   - Release year
   - Duration (over/under 3 minutes)
5. Player with the most correct answers wins a star (ties broken by submission time)
6. First to 10 stars wins!

## Requirements

- Node.js 18+
- **No API credentials needed!** Deezer API is public

## Setup

### 1. Configure Environment

```bash
cd server
cp .env.example .env
```

The `.env` file only needs the port:
```
PORT=3001
```

### 2. Install Dependencies

```bash
# Install server dependencies
cd server
npm install

# Install client dependencies
cd ../client
npm install
```

### 3. Run the Game

In two separate terminals:

```bash
# Terminal 1: Start the server
cd server
npm run dev

# Terminal 2: Start the client
cd client
npm run dev
```

### 4. Play!

1. Open `http://localhost:5173` in your browser
2. Click "Host a Game"
3. Paste a Deezer playlist URL (e.g., `https://www.deezer.com/playlist/908622995`)
   - You can use any public Deezer playlist
   - You don't need a Deezer account to create one - just browse public playlists
4. Share the room code with players
5. Players go to `http://localhost:5173/play` on their phones and enter the code

## Getting a Deezer Playlist

1. Go to [Deezer](https://www.deezer.com/)
2. Browse playlists or search for a genre
3. Copy the playlist URL from the browser address bar
4. Paste it into the game!

Example playlists to try:
- Top Charts: `https://www.deezer.com/playlist/1313621735`
- 80s Hits: Various public playlists available
- Rock Classics: Various public playlists available

## Tech Stack

- **Frontend**: React + Vite
- **Backend**: Node.js + Express + Socket.io
- **Music**: Deezer API (public, no authentication required!)

## Project Structure

```
jumble/
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

- Uses 30-second previews from Deezer (perfect for quick-fire rounds!)
- No authentication required - super easy setup
- Players don't need Deezer accounts
- Works best with host on a big screen and players on phones
- For local network play, replace `localhost` with your computer's local IP
- Choose playlists with recognizable songs (many songs have quiet intros)
