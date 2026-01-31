require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const app = express();
const server = http.createServer(app);

// Allow CORS for both local and production
const allowedOrigins = [
  'http://localhost:5173',
  'https://localhost:5173',
  'https://alessisheinman.github.io',
  process.env.CLIENT_URL
].filter(Boolean);

console.log('Allowed CORS origins:', allowedOrigins);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'Server is running', rooms: rooms.size });
});

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

// ============ SONG DATA HELPERS ============

// Load all songs from CSV immediately (no API calls)
function loadTracksFromCSV() {
  try {
    const csvPath = path.join(__dirname, 'songs_data.csv');
    const csvData = fs.readFileSync(csvPath, 'utf-8');
    const records = parse(csvData, {
      columns: true,
      skip_empty_lines: true
    });

    console.log(`✅ Loaded ${records.length} songs from CSV`);

    // Return track metadata immediately (no API calls yet)
    return records.map(record => {
      const trackId = record.deezer_url.split('/track/')[1];
      return {
        id: trackId,
        name: record.song_name,
        artist: record.artist,
        releaseDate: record.year, // Verified year from CSV!
        deezerUrl: record.deezer_url,
        // These will be fetched on-demand when song is selected
        previewUrl: null,
        album: null,
        albumArt: null,
        durationMs: null
      };
    });
  } catch (err) {
    console.error('Error loading tracks from CSV:', err);
    throw err;
  }
}

// Fetch preview URL and metadata from Deezer when a song is selected
async function fetchTrackPreview(trackId) {
  try {
    const response = await fetch(`https://api.deezer.com/track/${trackId}`);
    const trackData = await response.json();

    if (trackData.error) {
      console.warn(`Could not fetch preview for track ${trackId}`);
      return null;
    }

    return {
      previewUrl: trackData.preview,
      album: trackData.album?.title || 'Unknown Album',
      albumArt: trackData.album?.cover_medium || trackData.album?.cover_small || '',
      durationMs: trackData.duration * 1000
    };
  } catch (err) {
    console.error(`Error fetching track ${trackId}:`, err);
    return null;
  }
}

async function getPlaylistTracks(playlistId) {
  // Load from CSV instantly (no API calls)
  return loadTracksFromCSV();
}

function extractPlaylistId(input) {
  // Handle full URLs or just IDs
  // Deezer URLs: https://www.deezer.com/playlist/908622995
  const match = input.match(/playlist\/(\d+)/);
  return match ? match[1] : input;
}

// ============ SOCKET.IO GAME LOGIC ============

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Host creates a room
  socket.on('create-room', async ({ playlistUrl }) => {
    try {
      const roomCode = generateRoomCode();
      const playlistId = extractPlaylistId(playlistUrl);
      const tracks = await getPlaylistTracks(playlistId);

      if (tracks.length === 0) {
        socket.emit('error', { message: 'No tracks found in playlist' });
        return;
      }

      const room = {
        code: roomCode,
        hostId: socket.id,
        tracks: tracks,
        players: [],
        currentRound: 0,
        currentTrack: null,
        currentPlayerIndex: 0,
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
  socket.on('start-game', async () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.hostId !== socket.id) return;

    if (room.players.length < 1) {
      socket.emit('error', { message: 'Need at least 1 player to start' });
      return;
    }

    room.gameStarted = true;
    room.usedTracks = new Set();

    io.to(socket.roomCode).emit('game-started');
    await startNextRound(socket.roomCode);
  });

  // Start next round
  async function startNextRound(roomCode) {
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

    // Fetch preview URL and metadata on-demand
    const trackPreview = await fetchTrackPreview(track.id);
    if (trackPreview) {
      track.previewUrl = trackPreview.previewUrl;
      track.album = trackPreview.album;
      track.albumArt = trackPreview.albumArt;
      track.durationMs = trackPreview.durationMs;
    }

    room.currentTrack = track;
    room.currentRound++;
    room.guesses.clear();
    room.roundActive = true;
    room.roundStartTime = Date.now();

    // Get current player
    const currentPlayer = room.players[room.currentPlayerIndex];

    // Send track preview URL to host for playback
    io.to(room.hostId).emit('play-track', {
      previewUrl: track.previewUrl,
      round: room.currentRound,
      currentPlayer: {
        id: currentPlayer.id,
        name: currentPlayer.name
      }
    });

    // Tell only the current player to guess
    io.to(currentPlayer.id).emit('round-start', {
      round: room.currentRound,
      tracks: room.tracks.map(t => ({ id: t.id, name: t.name, artist: t.artist })),
      isYourTurn: true
    });

    // Tell other players to wait
    room.players.forEach((player, idx) => {
      if (idx !== room.currentPlayerIndex) {
        io.to(player.id).emit('round-start', {
          round: room.currentRound,
          isYourTurn: false,
          currentPlayerName: currentPlayer.name
        });
      }
    });
  }

  // Player submits guess
  socket.on('submit-guess', ({ songId, artist, year, overThreeMin }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || !room.roundActive) return;

    // Only accept guess from current player
    const currentPlayer = room.players[room.currentPlayerIndex];
    if (socket.id !== currentPlayer.id) {
      socket.emit('error', { message: 'Not your turn!' });
      return;
    }

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

    // Automatically end the round after current player submits
    endRound(socket.roomCode);
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
    const isOverThreeMin = track.durationMs > 180000; // 3 minutes

    const results = [];
    let skipNextPlayer = false;

    room.guesses.forEach((guess, playerId) => {
      let correctCount = 0;

      // Check song name (by ID)
      const songCorrect = guess.songId === track.id;
      if (songCorrect) correctCount++;

      // Check artist (fuzzy match)
      const artistCorrect = track.artist.toLowerCase().includes(guess.artist?.toLowerCase() || '');
      if (artistCorrect) correctCount++;

      // Check year (within ±3 years)
      const yearDiff = Math.abs(guess.year - correctYear);
      const yearCorrect = yearDiff <= 3;
      if (yearCorrect) correctCount++;

      // Check duration (over/under 3 minutes)
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

    // Award point based on new rules
    let roundWinner = null;
    let earnedPoint = false;

    if (results.length > 0) {
      const result = results[0];
      const player = room.players.find(p => p.id === result.playerId);

      // Need 3/4 correct to get a point
      if (result.correctCount >= 3) {
        earnedPoint = true;
        if (player) {
          player.stars++;
        }
        roundWinner = result;

        // If 4/4 correct, skip next player
        if (result.correctCount === 4) {
          skipNextPlayer = true;
        }
      }
    }

    // Move to next player (with skip logic)
    if (skipNextPlayer) {
      // Skip next player: move 2 positions
      room.currentPlayerIndex = (room.currentPlayerIndex + 2) % room.players.length;
    } else {
      // Normal: move 1 position
      room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
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
        correctCount: roundWinner.correctCount,
        earnedPoint: earnedPoint,
        skippedNext: skipNextPlayer
      } : null,
      earnedPoint,
      skippedNext: skipNextPlayer,
      players: room.players
    });
  }

  // Host starts next round
  socket.on('next-round', async () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.hostId !== socket.id) return;
    await startNextRound(socket.roomCode);
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
