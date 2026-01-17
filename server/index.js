require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// Spotify credentials
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3001/callback';

// Game state storage
const rooms = new Map();

// Generate random room code
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

// ============ SPOTIFY AUTH ROUTES ============

app.get('/login', (req, res) => {
  const scopes = [
    'streaming',
    'user-read-email',
    'user-read-private',
    'user-read-playback-state',
    'user-modify-playback-state',
    'playlist-read-private',
    'playlist-read-collaborative'
  ].join(' ');

  const authUrl = 'https://accounts.spotify.com/authorize?' +
    new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      scope: scopes,
      redirect_uri: REDIRECT_URI,
      show_dialog: true
    }).toString();

  res.redirect(authUrl);
});

app.get('/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.redirect('http://localhost:5173?error=' + error);
  }

  try {
    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64')
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: REDIRECT_URI
      })
    });

    const tokens = await tokenResponse.json();

    if (tokens.error) {
      return res.redirect('http://localhost:5173?error=' + tokens.error);
    }

    // Redirect to client with tokens
    res.redirect('http://localhost:5173/host?' +
      new URLSearchParams({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in
      }).toString()
    );
  } catch (err) {
    console.error('Token exchange error:', err);
    res.redirect('http://localhost:5173?error=token_exchange_failed');
  }
});

app.post('/refresh', async (req, res) => {
  const { refresh_token } = req.body;

  try {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64')
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refresh_token
      })
    });

    const tokens = await response.json();
    res.json(tokens);
  } catch (err) {
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

// ============ SPOTIFY API HELPERS ============

async function getPlaylistTracks(accessToken, playlistId) {
  const tracks = [];
  let url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`;

  while (url) {
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const data = await response.json();

    for (const item of data.items) {
      if (item.track && item.track.id) {
        tracks.push({
          id: item.track.id,
          uri: item.track.uri,
          name: item.track.name,
          artist: item.track.artists.map(a => a.name).join(', '),
          album: item.track.album.name,
          albumArt: item.track.album.images[0]?.url,
          releaseDate: item.track.album.release_date,
          durationMs: item.track.duration_ms
        });
      }
    }

    url = data.next;
  }

  return tracks;
}

function extractPlaylistId(input) {
  // Handle full URLs or just IDs
  const match = input.match(/playlist\/([a-zA-Z0-9]+)/);
  return match ? match[1] : input;
}

// ============ SOCKET.IO GAME LOGIC ============

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Host creates a room
  socket.on('create-room', async ({ accessToken, playlistUrl }) => {
    try {
      const roomCode = generateRoomCode();
      const playlistId = extractPlaylistId(playlistUrl);
      const tracks = await getPlaylistTracks(accessToken, playlistId);

      if (tracks.length === 0) {
        socket.emit('error', { message: 'No tracks found in playlist' });
        return;
      }

      const room = {
        code: roomCode,
        hostId: socket.id,
        accessToken: accessToken,
        tracks: tracks,
        players: [],
        currentRound: 0,
        currentTrack: null,
        guesses: new Map(),
        scores: new Map(),
        gameStarted: false,
        roundActive: false
      };

      rooms.set(roomCode, room);
      socket.join(roomCode);
      socket.roomCode = roomCode;

      socket.emit('room-created', {
        roomCode,
        trackCount: tracks.length
      });

      console.log(`Room ${roomCode} created with ${tracks.length} tracks`);
    } catch (err) {
      console.error('Error creating room:', err);
      socket.emit('error', { message: 'Failed to create room' });
    }
  });

  // Player joins a room
  socket.on('join-room', ({ roomCode, playerName }) => {
    const room = rooms.get(roomCode.toUpperCase());

    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    if (room.players.length >= 6) {
      socket.emit('error', { message: 'Room is full' });
      return;
    }

    if (room.gameStarted) {
      socket.emit('error', { message: 'Game already in progress' });
      return;
    }

    const player = {
      id: socket.id,
      name: playerName,
      stars: 0
    };

    room.players.push(player);
    room.scores.set(socket.id, 0);
    socket.join(roomCode.toUpperCase());
    socket.roomCode = roomCode.toUpperCase();
    socket.playerName = playerName;

    socket.emit('joined-room', {
      roomCode: roomCode.toUpperCase(),
      players: room.players
    });

    // Notify host and other players
    io.to(roomCode.toUpperCase()).emit('player-joined', {
      players: room.players
    });

    console.log(`${playerName} joined room ${roomCode.toUpperCase()}`);
  });

  // Host starts the game
  socket.on('start-game', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.hostId !== socket.id) return;

    if (room.players.length < 1) {
      socket.emit('error', { message: 'Need at least 1 player to start' });
      return;
    }

    room.gameStarted = true;
    room.usedTracks = new Set();

    io.to(socket.roomCode).emit('game-started');
    startNextRound(socket.roomCode);
  });

  // Start next round
  function startNextRound(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;

    // Check for winner
    const winner = room.players.find(p => p.stars >= 10);
    if (winner) {
      io.to(roomCode).emit('game-over', {
        winner: winner,
        players: room.players
      });
      return;
    }

    // Pick random unused track
    const availableTracks = room.tracks.filter(t => !room.usedTracks.has(t.id));
    if (availableTracks.length === 0) {
      io.to(roomCode).emit('game-over', {
        winner: room.players.reduce((a, b) => a.stars > b.stars ? a : b),
        players: room.players,
        reason: 'No more tracks'
      });
      return;
    }

    const track = availableTracks[Math.floor(Math.random() * availableTracks.length)];
    room.usedTracks.add(track.id);
    room.currentTrack = track;
    room.currentRound++;
    room.guesses.clear();
    room.roundActive = true;
    room.roundStartTime = Date.now();

    // Send track URI to host for playback
    io.to(room.hostId).emit('play-track', {
      uri: track.uri,
      round: room.currentRound
    });

    // Tell players to guess
    room.players.forEach(player => {
      io.to(player.id).emit('round-start', {
        round: room.currentRound,
        tracks: room.tracks.map(t => ({ id: t.id, name: t.name, artist: t.artist }))
      });
    });
  }

  // Player submits guess
  socket.on('submit-guess', ({ songId, artist, year, overThreeMin }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || !room.roundActive) return;

    const submissionTime = Date.now() - room.roundStartTime;

    room.guesses.set(socket.id, {
      playerId: socket.id,
      playerName: socket.playerName,
      songId,
      artist,
      year,
      overThreeMin,
      submissionTime
    });

    socket.emit('guess-received');

    // Notify host of submission
    io.to(room.hostId).emit('player-submitted', {
      playerId: socket.id,
      playerName: socket.playerName,
      totalSubmitted: room.guesses.size,
      totalPlayers: room.players.length
    });

    // Check if all players submitted
    if (room.guesses.size === room.players.length) {
      endRound(socket.roomCode);
    }
  });

  // Host ends round manually
  socket.on('end-round', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.hostId !== socket.id) return;
    endRound(socket.roomCode);
  });

  function endRound(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || !room.roundActive) return;

    room.roundActive = false;
    const track = room.currentTrack;
    const correctYear = parseInt(track.releaseDate.substring(0, 4));
    const isOverThreeMin = track.durationMs > 180000;

    const results = [];

    room.guesses.forEach((guess, playerId) => {
      let correctCount = 0;

      // Check song name (by ID)
      const songCorrect = guess.songId === track.id;
      if (songCorrect) correctCount++;

      // Check artist (fuzzy match)
      const artistCorrect = track.artist.toLowerCase().includes(guess.artist?.toLowerCase() || '');
      if (artistCorrect) correctCount++;

      // Check year (exact or within 1 year for partial credit)
      const yearCorrect = guess.year === correctYear;
      if (yearCorrect) correctCount++;

      // Check duration
      const durationCorrect = guess.overThreeMin === isOverThreeMin;
      if (durationCorrect) correctCount++;

      results.push({
        playerId,
        playerName: guess.playerName,
        guess,
        correctCount,
        submissionTime: guess.submissionTime,
        details: {
          songCorrect,
          artistCorrect,
          yearCorrect,
          durationCorrect
        }
      });
    });

    // Sort by correct count (desc), then by submission time (asc)
    results.sort((a, b) => {
      if (b.correctCount !== a.correctCount) {
        return b.correctCount - a.correctCount;
      }
      return a.submissionTime - b.submissionTime;
    });

    // Award star to winner (if they got at least 1 correct)
    let roundWinner = null;
    if (results.length > 0 && results[0].correctCount > 0) {
      roundWinner = results[0];
      const player = room.players.find(p => p.id === roundWinner.playerId);
      if (player) {
        player.stars++;
      }
    }

    // Send results to everyone
    io.to(roomCode).emit('round-results', {
      track: {
        name: track.name,
        artist: track.artist,
        year: correctYear,
        durationMs: track.durationMs,
        albumArt: track.albumArt,
        isOverThreeMin
      },
      results,
      roundWinner: roundWinner ? {
        playerId: roundWinner.playerId,
        playerName: roundWinner.playerName,
        correctCount: roundWinner.correctCount
      } : null,
      players: room.players
    });
  }

  // Host starts next round
  socket.on('next-round', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.hostId !== socket.id) return;
    startNextRound(socket.roomCode);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;

    if (socket.id === room.hostId) {
      // Host left - end game
      io.to(socket.roomCode).emit('host-disconnected');
      rooms.delete(socket.roomCode);
    } else {
      // Player left
      room.players = room.players.filter(p => p.id !== socket.id);
      io.to(socket.roomCode).emit('player-left', {
        players: room.players
      });
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
