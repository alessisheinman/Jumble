import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { io } from 'socket.io-client'

const SOCKET_URL = 'http://localhost:3001'

function Host() {
  const [searchParams] = useSearchParams()
  const [accessToken, setAccessToken] = useState(null)
  const [socket, setSocket] = useState(null)
  const [playlistUrl, setPlaylistUrl] = useState('')
  const [roomCode, setRoomCode] = useState(null)
  const [players, setPlayers] = useState([])
  const [gameState, setGameState] = useState('setup') // setup, lobby, playing, results, gameover
  const [currentRound, setCurrentRound] = useState(0)
  const [submissions, setSubmissions] = useState({ total: 0, submitted: 0 })
  const [roundResults, setRoundResults] = useState(null)
  const [winner, setWinner] = useState(null)
  const [error, setError] = useState(null)
  const [trackCount, setTrackCount] = useState(0)
  const playerRef = useRef(null)
  const deviceIdRef = useRef(null)

  // Get tokens from URL on mount
  useEffect(() => {
    const token = searchParams.get('access_token')
    if (token) {
      setAccessToken(token)
      // Clean up URL
      window.history.replaceState({}, document.title, '/host')
    }
  }, [searchParams])

  // Initialize Spotify Web Playback SDK
  useEffect(() => {
    if (!accessToken) return

    window.onSpotifyWebPlaybackSDKReady = () => {
      const player = new window.Spotify.Player({
        name: 'Song Guessing Game',
        getOAuthToken: cb => cb(accessToken),
        volume: 0.5
      })

      player.addListener('ready', ({ device_id }) => {
        console.log('Spotify Player Ready, device ID:', device_id)
        deviceIdRef.current = device_id
      })

      player.addListener('not_ready', ({ device_id }) => {
        console.log('Device has gone offline', device_id)
      })

      player.addListener('initialization_error', ({ message }) => {
        console.error('Init error:', message)
        setError('Failed to initialize Spotify player')
      })

      player.addListener('authentication_error', ({ message }) => {
        console.error('Auth error:', message)
        setError('Spotify authentication failed')
      })

      player.connect()
      playerRef.current = player
    }

    // If SDK already loaded
    if (window.Spotify) {
      window.onSpotifyWebPlaybackSDKReady()
    }

    return () => {
      if (playerRef.current) {
        playerRef.current.disconnect()
      }
    }
  }, [accessToken])

  // Initialize Socket connection
  useEffect(() => {
    if (!accessToken) return

    const newSocket = io(SOCKET_URL)
    setSocket(newSocket)

    newSocket.on('room-created', ({ roomCode, trackCount }) => {
      setRoomCode(roomCode)
      setTrackCount(trackCount)
      setGameState('lobby')
    })

    newSocket.on('player-joined', ({ players }) => {
      setPlayers(players)
    })

    newSocket.on('player-left', ({ players }) => {
      setPlayers(players)
    })

    newSocket.on('game-started', () => {
      setGameState('playing')
    })

    newSocket.on('play-track', async ({ uri, round }) => {
      setCurrentRound(round)
      setSubmissions({ total: players.length, submitted: 0 })
      setRoundResults(null)

      // Play track via Spotify API
      if (deviceIdRef.current) {
        try {
          await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceIdRef.current}`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ uris: [uri] })
          })
        } catch (err) {
          console.error('Failed to play track:', err)
        }
      }
    })

    newSocket.on('player-submitted', ({ totalSubmitted, totalPlayers }) => {
      setSubmissions({ total: totalPlayers, submitted: totalSubmitted })
    })

    newSocket.on('round-results', ({ track, results, roundWinner, players }) => {
      setGameState('results')
      setRoundResults({ track, results, roundWinner })
      setPlayers(players)

      // Pause playback
      if (playerRef.current) {
        playerRef.current.pause()
      }
    })

    newSocket.on('game-over', ({ winner, players }) => {
      setGameState('gameover')
      setWinner(winner)
      setPlayers(players)

      if (playerRef.current) {
        playerRef.current.pause()
      }
    })

    newSocket.on('error', ({ message }) => {
      setError(message)
    })

    return () => {
      newSocket.close()
    }
  }, [accessToken])

  // Update player count for submissions when players change
  useEffect(() => {
    setSubmissions(prev => ({ ...prev, total: players.length }))
  }, [players])

  const handleCreateRoom = () => {
    if (!playlistUrl.trim()) {
      setError('Please enter a playlist URL')
      return
    }
    setError(null)
    socket.emit('create-room', { accessToken, playlistUrl })
  }

  const handleStartGame = () => {
    socket.emit('start-game')
  }

  const handleEndRound = () => {
    socket.emit('end-round')
  }

  const handleNextRound = () => {
    setGameState('playing')
    socket.emit('next-round')
  }

  if (!accessToken) {
    return (
      <div className="container" style={{ textAlign: 'center', marginTop: '20vh' }}>
        <h2>Connecting to Spotify...</h2>
        <p>If this takes too long, <a href="/" style={{ color: '#1DB954' }}>go back</a> and try again.</p>
      </div>
    )
  }

  return (
    <div className="container">
      <h1>Spotify Guessing Game</h1>

      {error && (
        <div style={{ color: '#ff6b6b', padding: 15, background: 'rgba(255,107,107,0.1)', borderRadius: 10, marginBottom: 20 }}>
          {error}
        </div>
      )}

      {/* SETUP: Enter playlist */}
      {gameState === 'setup' && (
        <div>
          <h2>Create a Game</h2>
          <input
            type="text"
            placeholder="Paste Spotify playlist URL or ID..."
            value={playlistUrl}
            onChange={(e) => setPlaylistUrl(e.target.value)}
          />
          <button onClick={handleCreateRoom} style={{ width: '100%' }}>
            Create Room
          </button>
        </div>
      )}

      {/* LOBBY: Waiting for players */}
      {gameState === 'lobby' && (
        <div style={{ textAlign: 'center' }}>
          <h2>Room Code</h2>
          <div className="room-code">{roomCode}</div>
          <p style={{ color: '#888', marginBottom: 20 }}>
            Players join at <strong>localhost:5173/play</strong>
          </p>
          <p style={{ color: '#888', marginBottom: 20 }}>
            {trackCount} songs loaded
          </p>

          <h3 style={{ marginTop: 30, marginBottom: 15 }}>Players ({players.length}/6)</h3>
          <div className="players-list" style={{ justifyContent: 'center' }}>
            {players.map(player => (
              <div key={player.id} className="player-tag">
                {player.name}
              </div>
            ))}
            {players.length === 0 && (
              <p style={{ color: '#888' }}>Waiting for players to join...</p>
            )}
          </div>

          <button
            onClick={handleStartGame}
            disabled={players.length < 1}
            style={{ marginTop: 30 }}
          >
            Start Game
          </button>
        </div>
      )}

      {/* PLAYING: Song is playing */}
      {gameState === 'playing' && (
        <div className="game-screen">
          <h2>Round {currentRound}</h2>
          <div className="now-playing">
            <p style={{ fontSize: '1.2rem' }}>Song is playing...</p>
            <p style={{ color: '#888' }}>Players are guessing on their devices</p>
          </div>

          <div style={{ margin: '30px 0' }}>
            <p style={{ fontSize: '1.5rem' }}>
              {submissions.submitted} / {submissions.total} submitted
            </p>
          </div>

          <button onClick={handleEndRound}>
            End Round
          </button>

          <div className="scoreboard" style={{ marginTop: 30 }}>
            {players.map(player => (
              <div key={player.id} className="score-card">
                <div className="name">{player.name}</div>
                <div className="stars">{'★'.repeat(player.stars)}{'☆'.repeat(10 - player.stars)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RESULTS: Show round results */}
      {gameState === 'results' && roundResults && (
        <div className="game-screen">
          <h2>Round {currentRound} Results</h2>

          <div className="results-card">
            {roundResults.track.albumArt && (
              <img src={roundResults.track.albumArt} alt="Album art" className="album-art" />
            )}
            <h3 style={{ marginTop: 15 }}>{roundResults.track.name}</h3>
            <p style={{ color: '#b3b3b3' }}>{roundResults.track.artist}</p>
            <p style={{ color: '#888', marginTop: 10 }}>
              {roundResults.track.year} • {roundResults.track.isOverThreeMin ? 'Over' : 'Under'} 3 minutes
            </p>
          </div>

          {roundResults.roundWinner && (
            <div className="winner-banner">
              ★ {roundResults.roundWinner.playerName} wins the round! ({roundResults.roundWinner.correctCount}/4 correct)
            </div>
          )}

          <div className="results-card">
            {roundResults.results.map((result, idx) => (
              <div key={result.playerId} className="result-row">
                <span>{idx + 1}. {result.playerName}</span>
                <span>
                  <span className={result.details.songCorrect ? 'correct' : 'incorrect'}>Song </span>
                  <span className={result.details.artistCorrect ? 'correct' : 'incorrect'}>Artist </span>
                  <span className={result.details.yearCorrect ? 'correct' : 'incorrect'}>Year </span>
                  <span className={result.details.durationCorrect ? 'correct' : 'incorrect'}>Duration</span>
                </span>
                <span>{result.correctCount}/4</span>
              </div>
            ))}
          </div>

          <div className="scoreboard">
            {players.map(player => (
              <div key={player.id} className="score-card">
                <div className="name">{player.name}</div>
                <div className="stars">{'★'.repeat(player.stars)}{'☆'.repeat(10 - player.stars)}</div>
              </div>
            ))}
          </div>

          <button onClick={handleNextRound} style={{ marginTop: 20 }}>
            Next Round
          </button>
        </div>
      )}

      {/* GAME OVER */}
      {gameState === 'gameover' && winner && (
        <div className="game-screen">
          <h2>Game Over!</h2>
          <div className="winner-banner" style={{ fontSize: '2rem' }}>
            🏆 {winner.name} Wins! 🏆
          </div>

          <div className="scoreboard">
            {players.sort((a, b) => b.stars - a.stars).map((player, idx) => (
              <div key={player.id} className="score-card">
                <div className="name">{idx + 1}. {player.name}</div>
                <div className="stars">{player.stars} ★</div>
              </div>
            ))}
          </div>

          <button onClick={() => window.location.href = '/'} style={{ marginTop: 30 }}>
            Play Again
          </button>
        </div>
      )}
    </div>
  )
}

export default Host
