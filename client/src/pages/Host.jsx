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
  const [timeRemaining, setTimeRemaining] = useState(60)
  const [skippedSongs, setSkippedSongs] = useState([])
  const [playedSongs, setPlayedSongs] = useState([])
  const [showHistory, setShowHistory] = useState(false)
  const [currentGuessInfo, setCurrentGuessInfo] = useState(null)
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

    newSocket.on('player-stars-adjusted', ({ players }) => {
      setPlayers(players)
    })

    newSocket.on('game-started', () => {
      setGameState('playing')
    })

    newSocket.on('play-track', ({ previewUrl, round, currentPlayer, trackInfo }) => {
      setCurrentRound(round)
      setCurrentPlayer(currentPlayer)
      setSubmissions({ total: 1, submitted: 0 })
      setRoundResults(null)
      setCurrentGuessInfo(null)

      // Start countdown timer
      setTimeRemaining(60)
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

    newSocket.on('player-submitted-guess', ({ playerName, guess, correctInfo, results }) => {
      setCurrentGuessInfo({ playerName, guess, correctInfo, results })
    })

    newSocket.on('round-results', ({ track, results, roundWinner, players, pointsEarned }) => {
      setGameState('results')
      setRoundResults({ track, results, roundWinner, pointsEarned })
      setPlayers(players)

      // Add track to played songs history
      setPlayedSongs(prev => [...prev, {
        ...track,
        round: currentRound,
        results: results,
        winner: roundWinner
      }])

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

      // Add to skipped songs list
      if (skippedTrack) {
        setSkippedSongs(prev => [...prev, { ...skippedTrack, skippedBy: playerName, type: 'player' }])
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

      // Add to skipped songs list
      if (skippedTrack) {
        setSkippedSongs(prev => [...prev, { ...skippedTrack, skippedBy: 'Host', type: 'host' }])
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

    newSocket.on('player-disconnected', ({ playerName, players }) => {
      setPlayers(players)
      console.log(`${playerName} disconnected`)
    })

    newSocket.on('player-reconnected', ({ playerName, players }) => {
      setPlayers(players)
      console.log(`${playerName} reconnected`)
    })

    newSocket.on('player-disconnected-during-turn', ({ playerName, players }) => {
      setPlayers(players)
      setSkipMessage(`${playerName} disconnected during turn - skipping`)
      setTimeout(() => setSkipMessage(null), 3000)

      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
      }
      if (audioRef.current) {
        audioRef.current.pause()
      }
    })

    newSocket.on('player-removed', ({ playerName, players }) => {
      setPlayers(players)
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

  const handleRemovePlayer = (playerName) => {
    if (window.confirm(`Remove ${playerName} from the game?`)) {
      socket.emit('host-remove-player', { playerName })
    }
  }

  const handleReplaySong = () => {
    if (audioRef.current && audioRef.current.src) {
      audioRef.current.currentTime = 0
      audioRef.current.play().catch(err => {
        console.error('Failed to replay track:', err)
      })
    }
  }

  const handleAdjustStars = (playerName, adjustment) => {
    socket.emit('host-adjust-stars', { playerName, adjustment })
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
            {trackCount} songs loaded
          </p>

          {/* Shareable Link Section */}
          <div style={{
            background: 'rgba(29, 185, 84, 0.1)',
            border: '2px solid rgba(29, 185, 84, 0.3)',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '30px'
          }}>
            <h3 style={{ marginBottom: '15px', color: '#1DB954' }}>Share with Players</h3>
            <div style={{
              background: 'rgba(255, 255, 255, 0.05)',
              padding: '12px',
              borderRadius: '8px',
              marginBottom: '15px',
              wordBreak: 'break-all',
              fontSize: '0.9rem',
              color: '#b3b3b3'
            }}>
              {window.location.protocol}//{window.location.host}/#/play?room={roomCode}
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                onClick={() => {
                  const url = `${window.location.protocol}//${window.location.host}/#/play?room=${roomCode}`
                  navigator.clipboard.writeText(url).then(() => {
                    alert('Link copied to clipboard!')
                  })
                }}
                style={{ flex: 1, maxWidth: '200px' }}
              >
                📋 Copy Link
              </button>
              <button
                onClick={() => {
                  const url = `${window.location.protocol}//${window.location.host}/#/play?room=${roomCode}`
                  const text = `Join my music guessing game! Room code: ${roomCode}\n${url}`
                  if (navigator.share) {
                    navigator.share({ title: 'Join My Game', text })
                  } else {
                    navigator.clipboard.writeText(text).then(() => {
                      alert('Share text copied to clipboard!')
                    })
                  }
                }}
                className="secondary"
                style={{ flex: 1, maxWidth: '200px' }}
              >
                📤 Share
              </button>
            </div>
          </div>

          <h3 style={{ marginTop: 30, marginBottom: 15 }}>Players ({players.length}/10)</h3>
          <div className="players-list" style={{ justifyContent: 'center' }}>
            {players.map(player => (
              <div
                key={player.name}
                className="player-tag"
                style={{
                  opacity: player.isConnected ? 1 : 0.5,
                  background: player.isConnected
                    ? 'rgba(29, 185, 84, 0.2)'
                    : 'rgba(255, 107, 107, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}
              >
                <span>
                  {player.name}
                  {!player.isConnected && ' 🔴'}
                </span>
                {!player.isConnected && (
                  <button
                    onClick={() => handleRemovePlayer(player.name)}
                    style={{
                      padding: '2px 8px',
                      fontSize: '0.75rem',
                      background: '#ff6b6b',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      color: 'white'
                    }}
                  >
                    Remove
                  </button>
                )}
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
          {/* Room Code Header */}
          <div style={{
            background: 'rgba(29, 185, 84, 0.1)',
            border: '1px solid rgba(29, 185, 84, 0.3)',
            borderRadius: '8px',
            padding: '10px 15px',
            marginBottom: '20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span style={{ color: '#888', fontSize: '0.9rem' }}>Room Code:</span>
            <span style={{ fontSize: '1.5rem', fontWeight: 'bold', letterSpacing: '3px', color: '#1DB954' }}>{roomCode}</span>
          </div>

          <h2>Round {currentRound}</h2>

          {/* Player List - Always Visible */}
          <div className="scoreboard" style={{ marginBottom: 30 }}>
            {players.map(player => (
              <div
                key={player.name}
                className="score-card"
                style={{
                  background: currentPlayer && player.name === currentPlayer.name
                    ? 'rgba(29, 185, 84, 0.3)'
                    : 'rgba(255, 255, 255, 0.05)',
                  border: currentPlayer && player.name === currentPlayer.name
                    ? '2px solid #1DB954'
                    : '2px solid transparent',
                  opacity: player.isConnected ? 1 : 0.6,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  transition: 'all 0.3s ease'
                }}
              >
                <div style={{ flex: 1 }}>
                  <div className="name">
                    {player.name}
                    {currentPlayer && player.name === currentPlayer.name && ' ◀'}
                    {!player.isConnected && (
                      <span style={{
                        marginLeft: '8px',
                        fontSize: '0.75rem',
                        color: '#ff6b6b'
                      }}>
                        disconnected
                      </span>
                    )}
                  </div>
                  <div className="stars">
                    {player.stars} pts • {player.skipsRemaining || 0} skips
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                  {/* Star adjustment buttons */}
                  <button
                    onClick={() => handleAdjustStars(player.name, 1)}
                    style={{
                      padding: '4px 8px',
                      fontSize: '0.8rem',
                      background: '#1DB954',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      color: 'white'
                    }}
                    title="Add 1 star"
                  >
                    +
                  </button>
                  <button
                    onClick={() => handleAdjustStars(player.name, -1)}
                    style={{
                      padding: '4px 8px',
                      fontSize: '0.8rem',
                      background: '#ff6b6b',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      color: 'white'
                    }}
                    title="Remove 1 star"
                  >
                    -
                  </button>
                  {!player.isConnected && (
                    <button
                      onClick={() => handleRemovePlayer(player.name)}
                      style={{
                        padding: '4px 10px',
                        fontSize: '0.8rem',
                        background: '#888',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        color: 'white'
                      }}
                    >
                      Remove
                    </button>
                  )}
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

          {/* Show current guess info */}
          {currentGuessInfo && (
            <div style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: '2px solid rgba(29, 185, 84, 0.3)',
              borderRadius: '12px',
              padding: '20px',
              marginBottom: '20px'
            }}>
              <h3 style={{ marginBottom: '15px', color: '#1DB954' }}>{currentGuessInfo.playerName}'s Answer</h3>
              <div style={{ display: 'grid', gap: '12px' }}>
                <div>
                  <span style={{ color: '#888', fontSize: '0.9rem' }}>Song: </span>
                  <span className={currentGuessInfo.results.songCorrect ? 'correct' : 'incorrect'} style={{ fontWeight: 'bold' }}>
                    {currentGuessInfo.guess.songName}
                  </span>
                  {!currentGuessInfo.results.songCorrect && (
                    <span style={{ color: '#888', marginLeft: '8px' }}>
                      (Correct: {currentGuessInfo.correctInfo.songName})
                    </span>
                  )}
                </div>
                <div>
                  <span style={{ color: '#888', fontSize: '0.9rem' }}>Artist: </span>
                  <span className={currentGuessInfo.results.artistCorrect ? 'correct' : 'incorrect'} style={{ fontWeight: 'bold' }}>
                    {currentGuessInfo.guess.artist}
                  </span>
                  {!currentGuessInfo.results.artistCorrect && (
                    <span style={{ color: '#888', marginLeft: '8px' }}>
                      (Correct: {currentGuessInfo.correctInfo.artist})
                    </span>
                  )}
                </div>
                <div>
                  <span style={{ color: '#888', fontSize: '0.9rem' }}>Year: </span>
                  <span className={currentGuessInfo.results.exactYear ? 'correct' : currentGuessInfo.results.yearWithin5 ? 'partial' : 'incorrect'} style={{ fontWeight: 'bold' }}>
                    {currentGuessInfo.guess.year}
                  </span>
                  <span style={{ color: '#888', marginLeft: '8px' }}>
                    (Off by {currentGuessInfo.results.yearDiff}, Correct: {currentGuessInfo.correctInfo.year})
                  </span>
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', flexDirection: 'column' }}>
            <button onClick={handleReplaySong} className="secondary">
              🔄 Replay Song
            </button>
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
          {/* Room Code Header */}
          <div style={{
            background: 'rgba(29, 185, 84, 0.1)',
            border: '1px solid rgba(29, 185, 84, 0.3)',
            borderRadius: '8px',
            padding: '10px 15px',
            marginBottom: '20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span style={{ color: '#888', fontSize: '0.9rem' }}>Room Code:</span>
            <span style={{ fontSize: '1.5rem', fontWeight: 'bold', letterSpacing: '3px', color: '#1DB954' }}>{roomCode}</span>
          </div>

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
              <div
                key={player.name}
                className="score-card"
                style={{ opacity: player.isConnected ? 1 : 0.6 }}
              >
                <div className="name">
                  {player.name}
                  {!player.isConnected && ' (disconnected)'}
                </div>
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
          {/* Room Code Header */}
          <div style={{
            background: 'rgba(29, 185, 84, 0.1)',
            border: '1px solid rgba(29, 185, 84, 0.3)',
            borderRadius: '8px',
            padding: '10px 15px',
            marginBottom: '20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span style={{ color: '#888', fontSize: '0.9rem' }}>Room Code:</span>
            <span style={{ fontSize: '1.5rem', fontWeight: 'bold', letterSpacing: '3px', color: '#1DB954' }}>{roomCode}</span>
          </div>

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

      {/* SONG HISTORY SECTION - Show in playing, results, and gameover states */}
      {(gameState === 'playing' || gameState === 'results' || gameState === 'gameover') && (playedSongs.length > 0 || skippedSongs.length > 0) && (
        <div style={{
          marginTop: '30px',
          background: 'rgba(29, 185, 84, 0.05)',
          border: '1px solid rgba(29, 185, 84, 0.3)',
          borderRadius: '12px',
          padding: '20px'
        }}>
          <button
            onClick={() => setShowHistory(!showHistory)}
            style={{
              width: '100%',
              background: 'rgba(29, 185, 84, 0.2)',
              border: '1px solid rgba(29, 185, 84, 0.5)',
              borderRadius: '8px',
              padding: '12px',
              cursor: 'pointer',
              color: '#1DB954',
              fontWeight: 'bold',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '1rem'
            }}
          >
            <span>
              📜 Song History ({playedSongs.length} played, {skippedSongs.length} skipped)
            </span>
            <span>{showHistory ? '▼' : '▶'}</span>
          </button>

          {showHistory && (
            <div style={{ marginTop: '15px' }}>
              {/* Played Songs */}
              {playedSongs.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <h4 style={{ marginBottom: '12px', color: '#1DB954' }}>✅ Played Songs ({playedSongs.length})</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto' }}>
                    {playedSongs.map((song, idx) => (
                      <div key={idx} style={{
                        background: 'rgba(255, 255, 255, 0.05)',
                        borderRadius: '8px',
                        padding: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px'
                      }}>
                        {song.albumArt && (
                          <img src={song.albumArt} alt={song.name} style={{
                            width: '50px',
                            height: '50px',
                            borderRadius: '4px',
                            objectFit: 'cover'
                          }} />
                        )}
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>{song.name}</div>
                          <div style={{ fontSize: '0.85rem', color: '#b3b3b3' }}>{song.artist} • {song.year}</div>
                          <div style={{ fontSize: '0.8rem', color: '#1DB954', marginTop: '4px' }}>
                            Round {song.round} • {song.winner ? `⭐ ${song.winner.playerName} (+${song.winner.pointsEarned})` : 'No points awarded'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Skipped Songs */}
              {skippedSongs.length > 0 && (
                <div>
                  <h4 style={{ marginBottom: '12px', color: '#ff6b6b' }}>⏭️ Skipped Songs ({skippedSongs.length})</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto' }}>
                    {skippedSongs.map((song, idx) => (
                      <div key={idx} style={{
                        background: 'rgba(255, 255, 255, 0.05)',
                        borderRadius: '8px',
                        padding: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px'
                      }}>
                        {song.albumArt && (
                          <img src={song.albumArt} alt={song.name} style={{
                            width: '50px',
                            height: '50px',
                            borderRadius: '4px',
                            objectFit: 'cover'
                          }} />
                        )}
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>{song.name}</div>
                          <div style={{ fontSize: '0.85rem', color: '#b3b3b3' }}>{song.artist} • {song.year}</div>
                          <div style={{ fontSize: '0.8rem', color: song.type === 'host' ? '#ffa500' : '#ff6b6b', marginTop: '4px' }}>
                            {song.type === 'host' ? '🎮 Host skip' : `Skipped by ${song.skippedBy}`}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default Host
