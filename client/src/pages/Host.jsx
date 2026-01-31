import { useState, useEffect, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { io } from 'socket.io-client'

// Server URL - change this when deploying backend
const SOCKET_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001'
// Client URL for players to join
const CLIENT_URL = import.meta.env.VITE_CLIENT_URL || 'localhost:5173/#/play'

// Hardcoded playlist ID
const PLAYLIST_ID = '14883960123'

function Host() {
  const [socket, setSocket] = useState(null)
  const [roomCode, setRoomCode] = useState(null)
  const [players, setPlayers] = useState([])
  const [gameState, setGameState] = useState('setup') // setup, lobby, playing, results, gameover
  const [currentRound, setCurrentRound] = useState(0)
  const [currentPlayer, setCurrentPlayer] = useState(null)
  const [submissions, setSubmissions] = useState({ total: 0, submitted: 0 })
  const [roundResults, setRoundResults] = useState(null)
  const [winner, setWinner] = useState(null)
  const [error, setError] = useState(null)
  const [trackCount, setTrackCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [volume, setVolume] = useState(50)
  const [skipMessage, setSkipMessage] = useState(null)
  const [skippedTrackInfo, setSkippedTrackInfo] = useState(null)
  const [timeRemaining, setTimeRemaining] = useState(90)
  const timerIntervalRef = useRef(null)
  const audioRef = useRef(null)

  // Initialize Socket connection
  useEffect(() => {
    const newSocket = io(SOCKET_URL)
    setSocket(newSocket)

    // Initialize HTML5 audio element
    audioRef.current = new Audio()
    audioRef.current.volume = 0.5

    newSocket.on('room-created', ({ roomCode, trackCount }) => {
      setRoomCode(roomCode)
      setTrackCount(trackCount)
      setGameState('lobby')
      setLoading(false)
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

    newSocket.on('play-track', ({ previewUrl, round, currentPlayer }) => {
      setCurrentRound(round)
      setCurrentPlayer(currentPlayer)
      setSubmissions({ total: 1, submitted: 0 })
      setRoundResults(null)

      // Start countdown timer
      setTimeRemaining(90)
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
      }
      timerIntervalRef.current = setInterval(() => {
        setTimeRemaining(prev => {
          if (prev <= 1) {
            clearInterval(timerIntervalRef.current)
            return 0
          }
          return prev - 1
        })
      }, 1000)

      // Play track preview via HTML5 audio
      if (audioRef.current && previewUrl) {
        audioRef.current.src = previewUrl
        audioRef.current.play().catch(err => {
          console.error('Failed to play track:', err)
          setError('Failed to play preview. Make sure audio is enabled.')
        })
      }
    })

    newSocket.on('player-submitted', ({ totalSubmitted, totalPlayers }) => {
      setSubmissions({ total: totalPlayers, submitted: totalSubmitted })
    })

    newSocket.on('round-results', ({ track, results, roundWinner, players, pointsEarned }) => {
      setGameState('results')
      setRoundResults({ track, results, roundWinner, pointsEarned })
      setPlayers(players)

      // Stop timer
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
      }

      // Pause playback
      if (audioRef.current) {
        audioRef.current.pause()
      }
    })

    newSocket.on('game-over', ({ winner, players }) => {
      setGameState('gameover')
      setWinner(winner)
      setPlayers(players)

      if (audioRef.current) {
        audioRef.current.pause()
      }
    })

    newSocket.on('skip-used', ({ playerName, players, skippedTrack }) => {
      setPlayers(players)
      setSkipMessage(`${playerName} used a skip! Loading new song...`)
      setTimeout(() => setSkipMessage(null), 3000)

      // Show skipped track info briefly
      if (skippedTrack) {
        setSkippedTrackInfo(skippedTrack)
        setTimeout(() => setSkippedTrackInfo(null), 5000)
      }

      // Stop timer
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
      }

      // Pause audio
      if (audioRef.current) {
        audioRef.current.pause()
      }
    })

    newSocket.on('host-skipped-song', ({ skippedTrack }) => {
      setSkipMessage('Song skipped. Loading new song...')
      setTimeout(() => setSkipMessage(null), 3000)

      // Show skipped track info briefly
      if (skippedTrack) {
        setSkippedTrackInfo(skippedTrack)
        setTimeout(() => setSkippedTrackInfo(null), 5000)
      }

      // Stop timer
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
      }

      // Pause audio
      if (audioRef.current) {
        audioRef.current.pause()
      }
    })

    newSocket.on('error', ({ message }) => {
      setError(message)
      setLoading(false)
    })

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
      }
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      newSocket.close()
    }
  }, [])

  // Update player count for submissions when players change
  useEffect(() => {
    setSubmissions(prev => ({ ...prev, total: players.length }))
  }, [players])

  const handleCreateRoom = () => {
    setError(null)
    setLoading(true)
    socket.emit('create-room', { playlistUrl: PLAYLIST_ID })
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

  const handleVolumeChange = (e) => {
    const newVolume = parseInt(e.target.value)
    setVolume(newVolume)
    if (audioRef.current) {
      audioRef.current.volume = newVolume / 100
    }
  }

  const handleSkipSong = () => {
    socket.emit('skip-song')
  }

  return (
    <div className="container">
      <h1>Music Guessing Game</h1>

      {error && (
        <div style={{ color: '#ff6b6b', padding: 15, background: 'rgba(255,107,107,0.1)', borderRadius: 10, marginBottom: 20 }}>
          {error}
        </div>
      )}

      {/* SETUP: Create room */}
      {gameState === 'setup' && (
        <div style={{ textAlign: 'center' }}>
          <h2>Ready to Play?</h2>
          <p style={{ color: '#888', marginBottom: 30 }}>
            1,675 songs loaded and ready to go!
          </p>
          <button
            onClick={handleCreateRoom}
            disabled={loading}
            style={{
              width: '100%',
              fontSize: '1.2rem',
              padding: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px'
            }}
          >
            {loading ? (
              <>
                <span style={{
                  border: '3px solid rgba(255,255,255,0.3)',
                  borderTop: '3px solid white',
                  borderRadius: '50%',
                  width: '20px',
                  height: '20px',
                  animation: 'spin 1s linear infinite'
                }}></span>
                Loading...
              </>
            ) : (
              'Create Room'
            )}
          </button>
          {loading && (
            <style>{`
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
            `}</style>
          )}
        </div>
      )}

      {/* LOBBY: Waiting for players */}
      {gameState === 'lobby' && (
        <div style={{ textAlign: 'center' }}>
          <h2>Room Code</h2>
          <div className="room-code">{roomCode}</div>
          <p style={{ color: '#888', marginBottom: 20 }}>
            Players join at <strong>{CLIENT_URL}</strong>
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

      {/* Skip Message */}
      {skipMessage && (
        <div style={{
          color: '#1DB954',
          padding: 15,
          background: 'rgba(29, 185, 84, 0.1)',
          borderRadius: 10,
          marginBottom: 20,
          textAlign: 'center'
        }}>
          {skipMessage}
        </div>
      )}

      {/* Skipped Track Info */}
      {skippedTrackInfo && (
        <div className="results-card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginBottom: 15, color: '#ff6b6b' }}>Skipped Song</h3>
          {skippedTrackInfo.albumArt && (
            <img src={skippedTrackInfo.albumArt} alt="Album art" className="album-art" style={{ width: 200, height: 200 }} />
          )}
          <h3 style={{ marginTop: 15 }}>{skippedTrackInfo.name}</h3>
          <p style={{ color: '#b3b3b3' }}>{skippedTrackInfo.artist}</p>
          <p style={{ color: '#888', marginTop: 10 }}>
            Released in {skippedTrackInfo.year}
          </p>
        </div>
      )}

      {/* PLAYING: Song is playing */}
      {gameState === 'playing' && (
        <div className="game-screen">
          <h2>Round {currentRound}</h2>

          {/* Player List - Always Visible */}
          <div className="scoreboard" style={{ marginBottom: 30 }}>
            {players.map(player => (
              <div
                key={player.id}
                className="score-card"
                style={{
                  background: currentPlayer && player.id === currentPlayer.id
                    ? 'rgba(29, 185, 84, 0.3)'
                    : 'rgba(255, 255, 255, 0.05)',
                  border: currentPlayer && player.id === currentPlayer.id
                    ? '2px solid #1DB954'
                    : '2px solid transparent',
                  transform: currentPlayer && player.id === currentPlayer.id
                    ? 'scale(1.05)'
                    : 'scale(1)',
                  transition: 'all 0.3s ease'
                }}
              >
                <div className="name">
                  {player.name}
                  {currentPlayer && player.id === currentPlayer.id && (
                    <span style={{ marginLeft: '8px', color: '#1DB954', fontSize: '0.9rem' }}>◀ Current</span>
                  )}
                </div>
                <div className="stars">
                  {player.stars} pts
                  <div style={{ fontSize: '0.8rem', color: '#888', marginTop: '5px' }}>
                    {player.skipsRemaining || 0} skips
                  </div>
                </div>
              </div>
            ))}
          </div>

          {currentPlayer && (
            <div style={{ background: 'rgba(29, 185, 84, 0.2)', padding: '20px', borderRadius: '12px', marginBottom: '20px' }}>
              <p style={{ fontSize: '1.5rem', color: '#1DB954', fontWeight: 'bold' }}>
                {currentPlayer.name}'s Turn
              </p>
              <p style={{ fontSize: '2rem', color: timeRemaining <= 10 ? '#ff6b6b' : '#fff', fontWeight: 'bold', marginTop: '10px' }}>
                {Math.floor(timeRemaining / 60)}:{(timeRemaining % 60).toString().padStart(2, '0')}
              </p>
            </div>
          )}

          <div className="now-playing">
            <p style={{ fontSize: '1.2rem' }}>Song is playing...</p>
            <p style={{ color: '#888' }}>Waiting for {currentPlayer?.name} to guess...</p>

            {/* Volume Control */}
            <div style={{ marginTop: '20px', width: '100%', maxWidth: '300px' }}>
              <label style={{ display: 'block', marginBottom: '10px', color: '#b3b3b3', fontSize: '0.9rem' }}>
                Volume: {volume}%
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={handleVolumeChange}
                style={{
                  width: '100%',
                  accentColor: '#1DB954'
                }}
              />
            </div>
          </div>

          <div style={{ margin: '30px 0' }}>
            <p style={{ fontSize: '1.5rem' }}>
              {submissions.submitted === 1 ? 'Answer submitted!' : 'Listening...'}
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px', flexDirection: 'column' }}>
            <button onClick={handleEndRound}>
              End Round
            </button>
            <button onClick={handleSkipSong} className="secondary">
              Skip Song
            </button>
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
              Released in {roundResults.track.year}
            </p>
          </div>

          {roundResults.pointsEarned > 0 && roundResults.roundWinner && (
            <div className="winner-banner">
              ★ {roundResults.roundWinner.playerName} earned {roundResults.pointsEarned} point{roundResults.pointsEarned > 1 ? 's' : ''}!
              {roundResults.roundWinner.exactYear && <div style={{ marginTop: '10px', fontSize: '0.9rem' }}>Exact year! Double points!</div>}
            </div>
          )}
          {roundResults.pointsEarned === 0 && (
            <div style={{ background: 'rgba(255,107,107,0.2)', color: '#ff6b6b', padding: '20px', borderRadius: '16px', margin: '20px 0', textAlign: 'center' }}>
              No points earned. Need both song name and artist correct!
            </div>
          )}

          <div className="results-card">
            {roundResults.results.map((result, idx) => (
              <div key={result.playerId} style={{ padding: '15px', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{idx + 1}. {result.playerName}</span>
                </div>
                <div style={{ fontSize: '0.9rem', color: '#b3b3b3', lineHeight: '1.6' }}>
                  <div className={result.details.songCorrect ? 'correct' : 'incorrect'}>
                    Song: {result.guess.songId ? roundResults.track.name : 'Not selected'} {result.details.songCorrect ? '✓' : '✗'}
                  </div>
                  <div className={result.details.artistCorrect ? 'correct' : 'incorrect'}>
                    Artist: {result.guess.artist || 'Not answered'} {result.details.artistCorrect ? '✓' : '✗'}
                  </div>
                  <div className={result.details.exactYear ? 'correct' : result.details.yearWithin5 ? 'partial' : 'incorrect'}>
                    Year: {result.guess.year || 'Not answered'} (off by {result.details.yearDiff} {result.details.yearDiff === 1 ? 'year' : 'years'})
                    {result.details.exactYear && ' ✓ Exact!'}
                    {!result.details.exactYear && result.details.yearWithin5 && ' ± Close!'}
                    {!result.details.yearWithin5 && ' ✗'}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="scoreboard">
            {players.map(player => (
              <div key={player.id} className="score-card">
                <div className="name">{player.name}</div>
                <div className="stars">{player.stars} pts</div>
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
                <div className="stars">{player.stars} pts</div>
              </div>
            ))}
          </div>

          <button onClick={() => window.location.href = '#/'} style={{ marginTop: 30 }}>
            Play Again
          </button>
        </div>
      )}
    </div>
  )
}

export default Host
