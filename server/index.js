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
        roundActive: false,
        roundTimer: null
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

    if (room.players.length >= 10) {
      socket.emit('error', { message: 'Room is full' });
      return;
    }

    // Check if player name already exists in room (case-insensitive)
    const existingPlayer = room.players.find(
      p => p.name.toLowerCase() === playerName.toLowerCase()
    );

    if (existingPlayer) {
      if (existingPlayer.isConnected) {
        // Kick the old connected player
        io.to(existingPlayer.id).emit('kicked-by-rejoin', {
          message: 'Someone joined with your name'
        });
      }

      // Update existing player with new socket (works for both connected and disconnected)
      existingPlayer.id = socket.id;
      existingPlayer.isConnected = true;

      socket.join(roomCode.toUpperCase());
      socket.roomCode = roomCode.toUpperCase();
      socket.playerName = existingPlayer.name;

      // Send rejoined state
      socket.emit('rejoined-room', {
        roomCode: roomCode.toUpperCase(),
        players: room.players,
        gameState: room.gameStarted ? 'playing' : 'lobby',
        currentRound: room.currentRound || 0,
        myPlayerData: {
          name: existingPlayer.name,
          stars: existingPlayer.stars,
          skipsRemaining: existingPlayer.skipsRemaining
        }
      });

      // If game in progress, send current round info
      if (room.gameStarted && room.roundActive) {
        const currentPlayer = room.players[room.currentPlayerIndex];
        const isMyTurn = currentPlayer.name.toLowerCase() === existingPlayer.name.toLowerCase();

        socket.emit('round-start', {
          round: room.currentRound,
          tracks: room.tracks.map(t => ({ id: t.id, name: t.name, artist: t.artist })),
          isYourTurn: isMyTurn,
          currentPlayerName: currentPlayer.name,
          previewUrl: room.currentTrack?.previewUrl
        });
      }

      // Notify everyone
      io.to(roomCode.toUpperCase()).emit('player-reconnected', {
        playerName: existingPlayer.name,
        players: room.players
      });

      console.log(`${existingPlayer.name} rejoined room ${roomCode.toUpperCase()}`);
      return; // Don't create new player
    }

    if (room.gameStarted) {
      socket.emit('error', { message: 'Game already in progress' });
      return;
    }

    const player = {
      id: socket.id,
      name: playerName,
      stars: 0,
      skipsRemaining: 3,
      isConnected: true
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

    // Clear any existing timer
    if (room.roundTimer) {
      clearTimeout(room.roundTimer);
    }

    // Start 60 second auto-end timer
    room.roundTimer = setTimeout(() => {
      if (room.roundActive) {
        console.log(`Round ${room.currentRound} auto-ended after 60 seconds`);
        endRound(roomCode);
      }
    }, 60000); // 60 seconds

    // Skip disconnected players - find next connected player
    let attempts = 0;
    let currentPlayer = room.players[room.currentPlayerIndex];

    while (!currentPlayer.isConnected && attempts < room.players.length) {
      console.log(`Skipping ${currentPlayer.name} - disconnected`);
      room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
      currentPlayer = room.players[room.currentPlayerIndex];
      attempts++;
    }

    // If all players disconnected, pause game
    if (!currentPlayer.isConnected) {
      console.log('All players disconnected - pausing game');
      room.roundActive = false;
      if (room.roundTimer) {
        clearTimeout(room.roundTimer);
      }
      io.to(roomCode).emit('game-paused', {
        reason: 'All players disconnected'
      });
      return;
    }

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
      isYourTurn: true,
      previewUrl: track.previewUrl
    });

    // Tell other players to wait
    room.players.forEach((player, idx) => {
      if (idx !== room.currentPlayerIndex) {
        io.to(player.id).emit('round-start', {
          round: room.currentRound,
          isYourTurn: false,
          currentPlayerName: currentPlayer.name,
          previewUrl: track.previewUrl
        });
      }
    });
  }

  // Player submits guess
  socket.on('submit-guess', ({ songId, artist, year }) => {
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
      submissionTime
    });

    socket.emit('guess-received');

    // Get correct answers
    const track = room.currentTrack;
    const correctYear = parseInt(track.releaseDate.substring(0, 4));

    // Check answers
    const songCorrect = songId === track.id;
    const artistCorrect = track.artist.toLowerCase().includes(artist?.toLowerCase() || '');
    const yearDiff = Math.abs(year - correctYear);
    const exactYear = yearDiff === 0;
    const yearWithin5 = yearDiff <= 5;

    // Broadcast guess to all players with correct info
    io.to(socket.roomCode).emit('player-submitted-guess', {
      playerName: socket.playerName,
      guess: {
        songName: room.tracks.find(t => t.id === songId)?.name || 'Unknown',
        artist,
        year
      },
      correctInfo: {
        songName: track.name,
        artist: track.artist,
        year: correctYear
      },
      results: {
        songCorrect,
        artistCorrect,
        exactYear,
        yearWithin5,
        yearDiff
      }
    });

    // Clear the round timer
    if (room.roundTimer) {
      clearTimeout(room.roundTimer);
      room.roundTimer = null;
    }

    // Automatically end the round after current player submits
    endRound(socket.roomCode);
  });

  // Player uses a skip
  socket.on('use-skip', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || !room.roundActive) return;

    // Only accept skip from current player
    const currentPlayer = room.players[room.currentPlayerIndex];
    if (socket.id !== currentPlayer.id) {
      socket.emit('error', { message: 'Not your turn!' });
      return;
    }

    // Check if player has skips remaining
    if (currentPlayer.skipsRemaining <= 0) {
      socket.emit('error', { message: 'No skips remaining!' });
      return;
    }

    // Deduct skip
    currentPlayer.skipsRemaining--;

    // Clear the round timer
    if (room.roundTimer) {
      clearTimeout(room.roundTimer);
      room.roundTimer = null;
    }

    // Get current track info before canceling
    const skippedTrack = room.currentTrack;
    const correctYear = skippedTrack ? parseInt(skippedTrack.releaseDate.substring(0, 4)) : null;

    // Cancel current round without ending it
    room.roundActive = false;
    room.guesses.clear();

    // Notify everyone that a skip was used
    io.to(socket.roomCode).emit('skip-used', {
      playerName: currentPlayer.name,
      skipsRemaining: currentPlayer.skipsRemaining,
      players: room.players,
      skippedTrack: skippedTrack ? {
        name: skippedTrack.name,
        artist: skippedTrack.artist,
        year: correctYear,
        albumArt: skippedTrack.albumArt
      } : null
    });

    // Start a new round immediately (same player)
    setTimeout(() => startNextRound(socket.roomCode), 2000);
  });

  // Host skips song (backdoor)
  socket.on('skip-song', async () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.hostId !== socket.id) return;
    if (!room.roundActive) return;

    // Clear the round timer
    if (room.roundTimer) {
      clearTimeout(room.roundTimer);
      room.roundTimer = null;
    }

    // Get current track info before canceling
    const skippedTrack = room.currentTrack;
    const correctYear = skippedTrack ? parseInt(skippedTrack.releaseDate.substring(0, 4)) : null;

    // Cancel current round without ending it
    room.roundActive = false;
    room.guesses.clear();

    // Notify everyone that host skipped
    io.to(socket.roomCode).emit('host-skipped-song', {
      skippedTrack: skippedTrack ? {
        name: skippedTrack.name,
        artist: skippedTrack.artist,
        year: correctYear,
        albumArt: skippedTrack.albumArt
      } : null
    });

    // Start a new round immediately (same player)
    setTimeout(() => startNextRound(socket.roomCode), 2000);
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

    // Clear the round timer
    if (room.roundTimer) {
      clearTimeout(room.roundTimer);
      room.roundTimer = null;
    }

    room.roundActive = false;
    const track = room.currentTrack;
    const correctYear = parseInt(track.releaseDate.substring(0, 4));

    const results = [];

    room.guesses.forEach((guess, playerId) => {
      // Check song name (by ID)
      const songCorrect = guess.songId === track.id;

      // Check artist (fuzzy match)
      const artistCorrect = track.artist.toLowerCase().includes(guess.artist?.toLowerCase() || '');

      // Check year
      const yearDiff = Math.abs(guess.year - correctYear);
      const exactYear = yearDiff === 0;
      const yearWithin5 = yearDiff <= 5;

      results.push({
        playerId,
        playerName: guess.playerName,
        guess,
        submissionTime: guess.submissionTime,
        details: {
          songCorrect,
          artistCorrect,
          exactYear,
          yearWithin5,
          yearDiff
        }
      });
    });

    // Award points based on new rules
    let roundWinner = null;
    let pointsEarned = 0;

    if (results.length > 0) {
      const result = results[0];
      const player = room.players.find(p => p.id === result.playerId);

      // Must have song name AND artist correct to earn any points
      if (result.details.songCorrect && result.details.artistCorrect) {
        if (result.details.exactYear) {
          // Exact year: 2 points
          pointsEarned = 2;
          if (player) {
            player.stars += 2;
          }
        } else if (result.details.yearWithin5) {
          // Within 5 years: 1 point
          pointsEarned = 1;
          if (player) {
            player.stars += 1;
          }
        }

        if (pointsEarned > 0) {
          roundWinner = result;
        }
      }
    }

    // Move to next player (no skip mechanic)
    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;

    // Send results to everyone
    io.to(roomCode).emit('round-results', {
      track: {
        name: track.name,
        artist: track.artist,
        year: correctYear,
        albumArt: track.albumArt
      },
      results,
      roundWinner: roundWinner ? {
        playerId: roundWinner.playerId,
        playerName: roundWinner.playerName,
        pointsEarned: pointsEarned,
        exactYear: roundWinner.details.exactYear
      } : null,
      pointsEarned,
      players: room.players
    });
  }

  // Host starts next round
  socket.on('next-round', async () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.hostId !== socket.id) return;
    await startNextRound(socket.roomCode);
  });

  // Host removes a disconnected player
  socket.on('host-remove-player', ({ playerName }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || socket.id !== room.hostId) {
      socket.emit('error', { message: 'Only host can remove players' });
      return;
    }

    const playerIndex = room.players.findIndex(
      p => p.name.toLowerCase() === playerName.toLowerCase()
    );

    if (playerIndex === -1) {
      socket.emit('error', { message: 'Player not found' });
      return;
    }

    const player = room.players[playerIndex];

    if (player.isConnected) {
      socket.emit('error', { message: 'Cannot remove connected player' });
      return;
    }

    // Remove from array
    room.players.splice(playerIndex, 1);

    // Adjust currentPlayerIndex if needed
    if (room.currentPlayerIndex >= playerIndex && room.currentPlayerIndex > 0) {
      room.currentPlayerIndex--;
    }

    // Notify everyone
    io.to(socket.roomCode).emit('player-removed', {
      playerName: player.name,
      players: room.players
    });

    console.log(`Host removed disconnected player: ${player.name}`);
  });

  // Host adjusts player stars
  socket.on('host-adjust-stars', ({ playerName, adjustment }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || socket.id !== room.hostId) {
      socket.emit('error', { message: 'Only host can adjust stars' });
      return;
    }

    const player = room.players.find(
      p => p.name.toLowerCase() === playerName.toLowerCase()
    );

    if (!player) {
      socket.emit('error', { message: 'Player not found' });
      return;
    }

    // Adjust stars (don't allow negative)
    player.stars = Math.max(0, player.stars + adjustment);

    // Notify everyone
    io.to(socket.roomCode).emit('player-stars-adjusted', {
      playerName: player.name,
      newStars: player.stars,
      players: room.players
    });

    console.log(`Host adjusted ${player.name}'s stars by ${adjustment} to ${player.stars}`);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;

    if (socket.id === room.hostId) {
      // Host left - end game
      // Clear timer
      if (room.roundTimer) {
        clearTimeout(room.roundTimer);
      }
      io.to(socket.roomCode).emit('host-disconnected');
      rooms.delete(socket.roomCode);
    } else {
      // Player disconnected - mark as disconnected, DON'T remove
      const player = room.players.find(p => p.id === socket.id);
      if (player) {
        player.isConnected = false;

        // Check if it's their turn - if so, skip
        const currentPlayer = room.players[room.currentPlayerIndex];
        if (currentPlayer && currentPlayer.id === socket.id && room.roundActive) {
          console.log(`${player.name} disconnected during their turn - auto-skipping`);

          // Clear timer
          if (room.roundTimer) {
            clearTimeout(room.roundTimer);
            room.roundTimer = null;
          }

          // Cancel round
          room.roundActive = false;
          room.guesses.clear();

          // Move to next player
          room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;

          // Notify everyone
          io.to(socket.roomCode).emit('player-disconnected-during-turn', {
            playerName: player.name,
            players: room.players
          });

          // Start next round after brief delay
          setTimeout(() => {
            if (rooms.has(socket.roomCode)) {
              startNextRound(socket.roomCode);
            }
          }, 2000);
        } else {
          // Regular disconnect - just notify
          io.to(socket.roomCode).emit('player-disconnected', {
            playerName: player.name,
            players: room.players
          });
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
