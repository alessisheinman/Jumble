import { useState, useEffect, useRef } from 'react'
import { io } from 'socket.io-client'
import { useSearchParams } from 'react-router-dom'

// Server URL - change this when deploying backend
const SOCKET_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001'

function Player() {
  const [searchParams] = useSearchParams()
  const [socket, setSocket] = useState(null)
  const [roomCode, setRoomCode] = useState(searchParams.get('room') || '')
  const [playerName, setPlayerName] = useState('')
  const [gameState, setGameState] = useState('join') // join, lobby, guessing, waiting, results, gameover
  const [players, setPlayers] = useState([])
  const [error, setError] = useState(null)
  const [tracks, setTracks] = useState([])
  const [currentRound, setCurrentRound] = useState(0)
  const [isMyTurn, setIsMyTurn] = useState(false)
  const [currentPlayerName, setCurrentPlayerName] = useState('')
  const [mySkipsRemaining, setMySkipsRemaining] = useState(3)
  const [skipMessage, setSkipMessage] = useState(null)
  const [isMuted, setIsMuted] = useState(true)
  const [isPlaying, setIsPlaying] = useState(false)
  const [volume, setVolume] = useState(50)
  const [timeRemaining, setTimeRemaining] = useState(90)
  const [submittedGuessInfo, setSubmittedGuessInfo] = useState(null)
  const [skippedSongs, setSkippedSongs] = useState([])
  const timerIntervalRef = useRef(null)
  const audioRef = useRef(null)

  // Guess form state
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSong, setSelectedSong] = useState(null)
  const [artistGuess, setArtistGuess] = useState('')
  const [artistSearchQuery, setArtistSearchQuery] = useState('')
  const [selectedArtist, setSelectedArtist] = useState(null)
  const [yearGuess, setYearGuess] = useState('')
  const [hasSubmitted, setHasSubmitted] = useState(false)

  // Results
  const [roundResults, setRoundResults] = useState(null)
  const [winner, setWinner] = useState(null)

  // Initialize socket
  useEffect(() => {
    const newSocket = io(SOCKET_URL)
    setSocket(newSocket)

    // Initialize audio element
    audioRef.current = new Audio()
    audioRef.current.volume = 0.5
    audioRef.current.muted = true

    newSocket.on('joined-room', ({ roomCode, players }) => {
      setGameState('lobby')
      setPlayers(players)
      // Find my skips
      const me = players.find(p => p.id === newSocket.id)
      if (me) setMySkipsRemaining(me.skipsRemaining)
    })

    newSocket.on('player-joined', ({ players }) => {
      setPlayers(players)
    })

    newSocket.on('player-left', ({ players }) => {
      setPlayers(players)
    })

    newSocket.on('game-started', () => {
      setGameState('waiting')
    })

    newSocket.on('skip-used', ({ playerName, players, skippedTrack }) => {
      setPlayers(players)
      setSkipMessage(`${playerName} used a skip! New song loading...`)
      setTimeout(() => setSkipMessage(null), 3000)

      // Add to skipped songs list
      if (skippedTrack) {
        setSkippedSongs(prev => [...prev, { ...skippedTrack, skippedBy: playerName, type: 'player' }])
      }

      // Stop timer
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
      }

      // Pause audio
      if (audioRef.current) {
        audioRef.current.pause()
        setIsPlaying(false)
      }

      // Update my skips if it was me
      const me = players.find(p => p.name === playerName)
      if (me) {
        setMySkipsRemaining(me.skipsRemaining)
      }
    })

    newSocket.on('host-skipped-song', ({ skippedTrack }) => {
      setSkipMessage('Host skipped song. New song loading...')
      setTimeout(() => setSkipMessage(null), 3000)

      // Add to skipped songs list
      if (skippedTrack) {
        setSkippedSongs(prev => [...prev, { ...skippedTrack, skippedBy: 'Host', type: 'host' }])
      }

      // Stop timer
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
      }

      // Pause audio
      if (audioRef.current) {
        audioRef.current.pause()
        setIsPlaying(false)
      }
    })

    newSocket.on('round-start', ({ round, tracks, isYourTurn, currentPlayerName, previewUrl }) => {
      setCurrentRound(round)
      setIsMyTurn(isYourTurn)
      setCurrentPlayerName(currentPlayerName)
      setHasSubmitted(false)

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

      // Play audio if preview URL is provided
      if (audioRef.current && previewUrl) {
        audioRef.current.src = previewUrl
        audioRef.current.muted = isMuted
        audioRef.current.play().then(() => {
          setIsPlaying(true)
        }).catch(err => {
          console.error('Failed to play audio:', err)
        })
      }

      if (isYourTurn) {
        setTracks(tracks)
        setGameState('guessing')
        // Reset form
        setSearchQuery('')
        setSelectedSong(null)
        setArtistGuess('')
        setArtistSearchQuery('')
        setSelectedArtist(null)
        setYearGuess('')
      } else {
        setGameState('waiting')
      }
    })

    newSocket.on('guess-received', () => {
      setHasSubmitted(true)
      setGameState('waiting')

      // Stop timer
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
      }

      // Pause audio
      if (audioRef.current) {
        audioRef.current.pause()
        setIsPlaying(false)
      }
    })

    newSocket.on('player-submitted-guess', ({ playerName, guess, correctInfo, results }) => {
      setSubmittedGuessInfo({ playerName, guess, correctInfo, results })
      // Clear after round results come in
    })

    newSocket.on('round-results', ({ track, results, roundWinner, players, pointsEarned }) => {
      setGameState('results')
      setRoundResults({ track, results, roundWinner, pointsEarned })
      setPlayers(players)

      // Clear guess info
      setSubmittedGuessInfo(null)

      // Stop timer
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
      }

      // Pause audio
      if (audioRef.current) {
        audioRef.current.pause()
        setIsPlaying(false)
      }
    })

    newSocket.on('game-over', ({ winner, players }) => {
      setGameState('gameover')
      setWinner(winner)
      setPlayers(players)
    })

    newSocket.on('rejoined-room', ({ roomCode, players, gameState, currentRound, myPlayerData }) => {
      console.log('Successfully rejoined!')
      setGameState(gameState === 'playing' ? 'waiting' : 'lobby')
      setPlayers(players)
      setCurrentRound(currentRound)
      setMySkipsRemaining(myPlayerData.skipsRemaining)
    })

    newSocket.on('player-disconnected', ({ playerName, players }) => {
      setPlayers(players)
    })

    newSocket.on('player-reconnected', ({ playerName, players }) => {
      setPlayers(players)
    })

    newSocket.on('player-disconnected-during-turn', ({ playerName, players }) => {
      setPlayers(players)
      setSkipMessage(`${playerName} disconnected - skipping to next player`)
      setTimeout(() => setSkipMessage(null), 3000)
    })

    newSocket.on('kicked-by-rejoin', ({ message }) => {
      setError(message)
      setGameState('join')
    })

    newSocket.on('player-removed', ({ playerName, players }) => {
      setPlayers(players)
    })

    newSocket.on('host-disconnected', () => {
      setError('Host disconnected. Game ended.')
      setGameState('join')
    })

    newSocket.on('error', ({ message }) => {
      setError(message)
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

  const handleJoin = () => {
    if (!roomCode.trim() || !playerName.trim()) {
      setError('Please enter both room code and name')
      return
    }
    setError(null)
    socket.emit('join-room', { roomCode: roomCode.toUpperCase(), playerName })
  }

  const handleSubmitGuess = () => {
    if (!selectedSong || !artistGuess || !yearGuess) {
      setError('Please fill in all fields')
      return
    }
    setError(null)
    socket.emit('submit-guess', {
      songId: selectedSong.id,
      artist: artistGuess,
      year: parseInt(yearGuess)
    })
  }

  const handleUseSkip = () => {
    if (mySkipsRemaining <= 0) {
      setError('No skips remaining!')
      return
    }
    setError(null)
    socket.emit('use-skip')
  }

  const toggleMute = () => {
    const newMutedState = !isMuted
    setIsMuted(newMutedState)
    if (audioRef.current) {
      audioRef.current.muted = newMutedState
    }
  }

  const togglePlayPause = () => {
    if (!audioRef.current) return

    if (isPlaying) {
      audioRef.current.pause()
      setIsPlaying(false)
    } else {
      audioRef.current.play().then(() => {
        setIsPlaying(true)
      }).catch(err => {
        console.error('Failed to play audio:', err)
      })
    }
  }

  const handleVolumeChange = (e) => {
    const newVolume = parseInt(e.target.value)
    setVolume(newVolume)
    if (audioRef.current) {
      audioRef.current.volume = newVolume / 100
    }
  }

  // Update my skips when players array changes
  useEffect(() => {
    if (socket && players.length > 0) {
      const me = players.find(p => p.id === socket.id)
      if (me) setMySkipsRemaining(me.skipsRemaining)
    }
  }, [players, socket])

  // Normalize text for search by removing special characters
  const normalizeForSearch = (text) => {
    return text.replace(/[^a-zA-Z0-9\s]/g, '').toLowerCase().trim()
  }

  // Filter songs based on search (song name only)
  const filteredTracks = tracks.filter(track =>
    normalizeForSearch(track.name).includes(normalizeForSearch(searchQuery))
  ).slice(0, 10)

  // Get unique artists and filter based on search
  const uniqueArtists = [...new Set(tracks.map(t => t.artist))].sort()
  const filteredArtists = uniqueArtists.filter(artist =>
    normalizeForSearch(artist).includes(normalizeForSearch(artistSearchQuery))
  ).slice(0, 10)

  return (
    <div className="container" style={{ maxWidth: 500 }}>
      <h1 style={{ fontSize: '1.8rem' }}>Song Guess</h1>

      {error && (
        <div style={{ color: '#ff6b6b', padding: 15, background: 'rgba(255,107,107,0.1)', borderRadius: 10, marginBottom: 20 }}>
          {error}
        </div>
      )}

      {/* JOIN SCREEN */}
      {gameState === 'join' && (
        <div>
          <h2>Join Game</h2>
          <input
            type="text"
            placeholder="Room Code"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            maxLength={4}
            style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: 5 }}
          />
          <input
            type="text"
            placeholder="Your Name"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            maxLength={20}
          />
          <button onClick={handleJoin} style={{ width: '100%' }}>
            Join
          </button>
          <a href="#/" style={{ color: '#888', display: 'block', marginTop: 20, textDecoration: 'none' }}>
            ← Back to Home
          </a>
        </div>
      )}

      {/* LOBBY: Waiting for game to start */}
      {gameState === 'lobby' && (
        <div style={{ textAlign: 'center' }}>
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
            <span style={{ color: '#888', fontSize: '0.9rem' }}>Room:</span>
            <span style={{ fontSize: '1.5rem', fontWeight: 'bold', letterSpacing: '3px', color: '#1DB954' }}>{roomCode}</span>
          </div>

          <h2>You're In!</h2>
          <p style={{ color: '#888', marginBottom: 20 }}>Waiting for host to start the game...</p>

          <div className="players-list" style={{ justifyContent: 'center' }}>
            {players.map(player => (
              <div
                key={player.name}
                className="player-tag"
                style={{ opacity: player.isConnected ? 1 : 0.5 }}
              >
                {player.name}
                {player.name === playerName && ' (you)'}
                {!player.isConnected && (
                  <span style={{
                    marginLeft: '8px',
                    fontSize: '0.75rem',
                    color: '#ff6b6b',
                    background: 'rgba(255,107,107,0.2)',
                    padding: '2px 6px',
                    borderRadius: '4px'
                  }}>
                    disconnected
                  </span>
                )}
              </div>
            ))}
          </div>
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

      {/* GUESSING: Player makes their guess */}
      {gameState === 'guessing' && (
        <div className="guess-form">
          {/* Room Code Header */}
          <div style={{
            background: 'rgba(29, 185, 84, 0.1)',
            border: '1px solid rgba(29, 185, 84, 0.3)',
            borderRadius: '8px',
            padding: '10px 15px',
            marginBottom: '15px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span style={{ color: '#888', fontSize: '0.9rem' }}>Room:</span>
            <span style={{ fontSize: '1.2rem', fontWeight: 'bold', letterSpacing: '3px', color: '#1DB954' }}>{roomCode}</span>
          </div>

          {/* Player Status Header */}
          <div style={{
            background: 'rgba(255, 255, 255, 0.05)',
            borderRadius: '8px',
            padding: '12px',
            marginBottom: '15px'
          }}>
            <div style={{ fontSize: '0.85rem', color: '#888', marginBottom: '8px' }}>Players:</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {players.map(player => (
                <div key={player.name} style={{
                  background: player.name === playerName ? 'rgba(29, 185, 84, 0.3)' : 'rgba(255, 255, 255, 0.1)',
                  border: player.name === playerName ? '1px solid #1DB954' : '1px solid transparent',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  fontSize: '0.75rem',
                  opacity: player.isConnected ? 1 : 0.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}>
                  <span>{player.name}</span>
                  <span style={{ color: '#888' }}>({player.stars}⭐)</span>
                  {!player.isConnected && <span style={{ color: '#ff6b6b' }}>🔴</span>}
                </div>
              ))}
            </div>
            <div style={{ fontSize: '0.85rem', color: '#1DB954', marginTop: '8px', fontWeight: 'bold' }}>
              Your Turn!
            </div>
          </div>

          <h2 style={{ textAlign: 'center' }}>Round {currentRound}</h2>
          <p style={{ textAlign: 'center', fontSize: '2rem', color: timeRemaining <= 10 ? '#ff6b6b' : '#fff', fontWeight: 'bold', marginBottom: 10 }}>
            {Math.floor(timeRemaining / 60)}:{(timeRemaining % 60).toString().padStart(2, '0')}
          </p>
          <p style={{ textAlign: 'center', color: '#888', marginBottom: 10 }}>Listen and guess!</p>
          <p style={{ textAlign: 'center', color: '#1DB954', fontSize: '0.9rem', marginBottom: 10 }}>
            Skips remaining: {mySkipsRemaining}
          </p>

          {/* Audio Controls */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', gap: '10px', marginBottom: !isMuted ? '15px' : '0' }}>
              <button
                onClick={togglePlayPause}
                className="secondary"
                style={{ flex: 1 }}
              >
                {isPlaying ? '⏸ Pause' : '▶ Play'}
              </button>
              <button
                onClick={toggleMute}
                className="secondary"
                style={{ flex: 1 }}
              >
                {isMuted ? '🔇 Unmute' : '🔊 Mute'}
              </button>
            </div>

            {/* Volume Slider - Only shown when unmuted */}
            {!isMuted && (
              <div style={{ marginTop: '10px' }}>
                <label style={{ display: 'block', marginBottom: '5px', color: '#b3b3b3', fontSize: '0.9rem' }}>
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
            )}
          </div>

          {/* Song search */}
          <label>Song Name</label>
          <input
            type="text"
            placeholder="Search for the song..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setSelectedSong(null)
            }}
          />
          {searchQuery && !selectedSong && (
            <div className="search-results">
              {filteredTracks.map(track => (
                <div
                  key={track.id}
                  className="search-result"
                  onClick={() => {
                    setSelectedSong(track)
                    setSearchQuery(track.name)
                  }}
                >
                  <div><strong>{track.name}</strong></div>
                </div>
              ))}
              {filteredTracks.length === 0 && (
                <div style={{ padding: 15, color: '#888' }}>No matches found</div>
              )}
            </div>
          )}
          {selectedSong && (
            <div style={{ color: '#1DB954', marginBottom: 10, marginTop: -10 }}>
              Selected: {selectedSong.name}
            </div>
          )}

          {/* Artist */}
          <label>Artist</label>
          <input
            type="text"
            placeholder="Search for artist..."
            value={artistSearchQuery}
            onChange={(e) => {
              setArtistSearchQuery(e.target.value)
              setArtistGuess(e.target.value)
              setSelectedArtist(null)
            }}
          />
          {artistSearchQuery && !selectedArtist && (
            <div className="search-results">
              {filteredArtists.map((artist, idx) => (
                <div
                  key={idx}
                  className="search-result"
                  onClick={() => {
                    setSelectedArtist(artist)
                    setArtistSearchQuery(artist)
                    setArtistGuess(artist)
                  }}
                >
                  <div><strong>{artist}</strong></div>
                </div>
              ))}
              {filteredArtists.length === 0 && (
                <div style={{ padding: 15, color: '#888' }}>No matches found</div>
              )}
            </div>
          )}
          {selectedArtist && (
            <div style={{ color: '#1DB954', marginBottom: 10, marginTop: -10 }}>
              Selected: {selectedArtist}
            </div>
          )}

          {/* Year */}
          <label>Release Year</label>
          <select
            value={yearGuess}
            onChange={(e) => setYearGuess(e.target.value)}
            style={{
              width: '100%',
              padding: '12px',
              fontSize: '1rem',
              borderRadius: '8px',
              border: '2px solid rgba(255, 255, 255, 0.1)',
              background: 'rgba(255, 255, 255, 0.05)',
              color: 'white',
              cursor: 'pointer'
            }}
          >
            <option value="">Select a year...</option>
            {Array.from({ length: 2025 - 1950 + 1 }, (_, i) => 2025 - i).map(year => (
              <option key={year} value={year} style={{ background: '#1a1a1a', color: 'white' }}>
                {year}
              </option>
            ))}
          </select>

          <button onClick={handleSubmitGuess} style={{ marginTop: 20 }}>
            Submit Guess
          </button>

          {mySkipsRemaining > 0 && (
            <button
              onClick={handleUseSkip}
              className="secondary"
              style={{ marginTop: 10, width: '100%' }}
            >
              Use Skip ({mySkipsRemaining} remaining)
            </button>
          )}
        </div>
      )}

      {/* WAITING: Not your turn or submitted */}
      {gameState === 'waiting' && !hasSubmitted && !isMyTurn && currentPlayerName && (
        <div className="waiting">
          {/* Room Code Header */}
          <div style={{
            background: 'rgba(29, 185, 84, 0.1)',
            border: '1px solid rgba(29, 185, 84, 0.3)',
            borderRadius: '8px',
            padding: '10px 15px',
            marginBottom: '15px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span style={{ color: '#888', fontSize: '0.9rem' }}>Room:</span>
            <span style={{ fontSize: '1.2rem', fontWeight: 'bold', letterSpacing: '3px', color: '#1DB954' }}>{roomCode}</span>
          </div>

          {/* Player Status Header */}
          <div style={{
            background: 'rgba(255, 255, 255, 0.05)',
            borderRadius: '8px',
            padding: '12px',
            marginBottom: '15px'
          }}>
            <div style={{ fontSize: '0.85rem', color: '#888', marginBottom: '8px' }}>Players:</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {players.map(player => (
                <div key={player.name} style={{
                  background: player.name === currentPlayerName ? 'rgba(255, 165, 0, 0.3)' : player.name === playerName ? 'rgba(29, 185, 84, 0.3)' : 'rgba(255, 255, 255, 0.1)',
                  border: player.name === currentPlayerName ? '1px solid #ffa500' : player.name === playerName ? '1px solid #1DB954' : '1px solid transparent',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  fontSize: '0.75rem',
                  opacity: player.isConnected ? 1 : 0.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}>
                  <span>{player.name}</span>
                  <span style={{ color: '#888' }}>({player.stars}⭐)</span>
                  {player.name === currentPlayerName && <span>🎯</span>}
                  {!player.isConnected && <span style={{ color: '#ff6b6b' }}>🔴</span>}
                </div>
              ))}
            </div>
            <div style={{ fontSize: '0.85rem', color: '#ffa500', marginTop: '8px', fontWeight: 'bold' }}>
              {currentPlayerName}'s Turn
            </div>
          </div>

          <h2>Round {currentRound}</h2>
          <p style={{ fontSize: '2rem', color: timeRemaining <= 10 ? '#ff6b6b' : '#fff', fontWeight: 'bold', marginTop: 20 }}>
            {Math.floor(timeRemaining / 60)}:{(timeRemaining % 60).toString().padStart(2, '0')}
          </p>
          <p style={{ fontSize: '1.2rem', marginTop: 20 }}>It's {currentPlayerName}'s turn</p>
          <p style={{ color: '#888', marginTop: 10 }}>Listen to the song and get ready!</p>

          {/* Show submitted guess info */}
          {submittedGuessInfo && (
            <div style={{ marginTop: 30, textAlign: 'left', maxWidth: '400px', marginLeft: 'auto', marginRight: 'auto' }}>
              <h3 style={{ textAlign: 'center', marginBottom: 15 }}>{submittedGuessInfo.playerName}'s Guess</h3>
              <div style={{ background: 'rgba(255, 255, 255, 0.05)', padding: 15, borderRadius: 10 }}>
                <div style={{ marginBottom: 10 }}>
                  <span style={{ color: '#888' }}>Song: </span>
                  <span className={submittedGuessInfo.results.songCorrect ? 'correct' : 'incorrect'}>
                    {submittedGuessInfo.guess.songName}
                  </span>
                  {!submittedGuessInfo.results.songCorrect && (
                    <span style={{ color: '#888' }}> (Correct: {submittedGuessInfo.correctInfo.songName})</span>
                  )}
                </div>
                <div style={{ marginBottom: 10 }}>
                  <span style={{ color: '#888' }}>Artist: </span>
                  <span className={submittedGuessInfo.results.artistCorrect ? 'correct' : 'incorrect'}>
                    {submittedGuessInfo.guess.artist}
                  </span>
                  {!submittedGuessInfo.results.artistCorrect && (
                    <span style={{ color: '#888' }}> (Correct: {submittedGuessInfo.correctInfo.artist})</span>
                  )}
                </div>
                <div>
                  <span style={{ color: '#888' }}>Year: </span>
                  <span className={submittedGuessInfo.results.exactYear ? 'correct' : submittedGuessInfo.results.yearWithin5 ? 'partial' : 'incorrect'}>
                    {submittedGuessInfo.guess.year}
                  </span>
                  <span style={{ color: '#888' }}> (Off by {submittedGuessInfo.results.yearDiff}, Correct: {submittedGuessInfo.correctInfo.year})</span>
                </div>
              </div>
            </div>
          )}

          {/* Audio Controls */}
          <div style={{ marginTop: '20px', maxWidth: '400px', marginLeft: 'auto', marginRight: 'auto' }}>
            <div style={{ display: 'flex', gap: '10px', marginBottom: !isMuted ? '15px' : '0' }}>
              <button
                onClick={togglePlayPause}
                className="secondary"
                style={{ flex: 1 }}
              >
                {isPlaying ? '⏸ Pause' : '▶ Play'}
              </button>
              <button
                onClick={toggleMute}
                className="secondary"
                style={{ flex: 1 }}
              >
                {isMuted ? '🔇 Unmute' : '🔊 Mute'}
              </button>
            </div>

            {/* Volume Slider - Only shown when unmuted */}
            {!isMuted && (
              <div style={{ marginTop: '10px' }}>
                <label style={{ display: 'block', marginBottom: '5px', color: '#b3b3b3', fontSize: '0.9rem' }}>
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
            )}
          </div>
        </div>
      )}

      {gameState === 'waiting' && !hasSubmitted && !currentPlayerName && (
        <div className="waiting">
          <h2>Get Ready...</h2>
          <p>Round starting soon!</p>
        </div>
      )}

      {gameState === 'waiting' && hasSubmitted && (
        <div className="waiting">
          {/* Room Code Header */}
          <div style={{
            background: 'rgba(29, 185, 84, 0.1)',
            border: '1px solid rgba(29, 185, 84, 0.3)',
            borderRadius: '8px',
            padding: '10px 15px',
            marginBottom: '15px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span style={{ color: '#888', fontSize: '0.9rem' }}>Room:</span>
            <span style={{ fontSize: '1.2rem', fontWeight: 'bold', letterSpacing: '3px', color: '#1DB954' }}>{roomCode}</span>
          </div>

          <div className="submitted-badge" style={{ fontSize: '1.2rem', padding: '15px 30px' }}>
            ✓ Submitted!
          </div>
          <p style={{ marginTop: 20 }}>Waiting for results...</p>

          {/* Show submitted guess info */}
          {submittedGuessInfo && (
            <div style={{ marginTop: 30, textAlign: 'left', maxWidth: '400px', marginLeft: 'auto', marginRight: 'auto' }}>
              <h3 style={{ textAlign: 'center', marginBottom: 15 }}>{submittedGuessInfo.playerName}'s Guess</h3>
              <div style={{ background: 'rgba(255, 255, 255, 0.05)', padding: 15, borderRadius: 10 }}>
                <div style={{ marginBottom: 10 }}>
                  <span style={{ color: '#888' }}>Song: </span>
                  <span className={submittedGuessInfo.results.songCorrect ? 'correct' : 'incorrect'}>
                    {submittedGuessInfo.guess.songName}
                  </span>
                  {!submittedGuessInfo.results.songCorrect && (
                    <span style={{ color: '#888' }}> (Correct: {submittedGuessInfo.correctInfo.songName})</span>
                  )}
                </div>
                <div style={{ marginBottom: 10 }}>
                  <span style={{ color: '#888' }}>Artist: </span>
                  <span className={submittedGuessInfo.results.artistCorrect ? 'correct' : 'incorrect'}>
                    {submittedGuessInfo.guess.artist}
                  </span>
                  {!submittedGuessInfo.results.artistCorrect && (
                    <span style={{ color: '#888' }}> (Correct: {submittedGuessInfo.correctInfo.artist})</span>
                  )}
                </div>
                <div>
                  <span style={{ color: '#888' }}>Year: </span>
                  <span className={submittedGuessInfo.results.exactYear ? 'correct' : submittedGuessInfo.results.yearWithin5 ? 'partial' : 'incorrect'}>
                    {submittedGuessInfo.guess.year}
                  </span>
                  <span style={{ color: '#888' }}> (Off by {submittedGuessInfo.results.yearDiff}, Correct: {submittedGuessInfo.correctInfo.year})</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* RESULTS */}
      {gameState === 'results' && roundResults && (
        <div style={{ textAlign: 'center' }}>
          {/* Room Code Header */}
          <div style={{
            background: 'rgba(29, 185, 84, 0.1)',
            border: '1px solid rgba(29, 185, 84, 0.3)',
            borderRadius: '8px',
            padding: '10px 15px',
            marginBottom: '15px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span style={{ color: '#888', fontSize: '0.9rem' }}>Room:</span>
            <span style={{ fontSize: '1.2rem', fontWeight: 'bold', letterSpacing: '3px', color: '#1DB954' }}>{roomCode}</span>
          </div>

          <h2>Round {currentRound}</h2>

          {roundResults.track.albumArt && (
            <img src={roundResults.track.albumArt} alt="Album" className="album-art" style={{ width: 150, height: 150 }} />
          )}

          <h3 style={{ marginTop: 15 }}>{roundResults.track.name}</h3>
          <p style={{ color: '#888' }}>{roundResults.track.artist}</p>
          <p style={{ color: '#666', fontSize: '0.9rem' }}>
            Released in {roundResults.track.year}
          </p>

          {roundResults.pointsEarned > 0 && roundResults.roundWinner && (
            <div className="winner-banner" style={{ fontSize: '1rem', padding: 15, marginTop: 20 }}>
              ★ {roundResults.roundWinner.playerName} earned {roundResults.pointsEarned} point{roundResults.pointsEarned > 1 ? 's' : ''}!
              {roundResults.roundWinner.exactYear && <div style={{ marginTop: '8px', fontSize: '0.85rem' }}>Exact year! Double points!</div>}
            </div>
          )}
          {roundResults.pointsEarned === 0 && (
            <div style={{ background: 'rgba(255,107,107,0.2)', color: '#ff6b6b', padding: '15px', borderRadius: '12px', margin: '20px 0' }}>
              No points earned. Need both song name and artist correct!
            </div>
          )}

          <div className="scoreboard" style={{ marginTop: 20 }}>
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
                <div className="stars" style={{ fontSize: '1rem' }}>
                  {player.stars} pts
                </div>
              </div>
            ))}
          </div>

          <p style={{ color: '#888', marginTop: 20 }}>Waiting for host to start next round...</p>
        </div>
      )}

      {/* GAME OVER */}
      {gameState === 'gameover' && winner && (
        <div style={{ textAlign: 'center' }}>
          {/* Room Code Header */}
          <div style={{
            background: 'rgba(29, 185, 84, 0.1)',
            border: '1px solid rgba(29, 185, 84, 0.3)',
            borderRadius: '8px',
            padding: '10px 15px',
            marginBottom: '15px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span style={{ color: '#888', fontSize: '0.9rem' }}>Room:</span>
            <span style={{ fontSize: '1.2rem', fontWeight: 'bold', letterSpacing: '3px', color: '#1DB954' }}>{roomCode}</span>
          </div>

          <h2>Game Over!</h2>
          <div className="winner-banner">
            🏆 {winner.name} Wins! 🏆
          </div>

          <div className="scoreboard" style={{ marginTop: 20 }}>
            {players.sort((a, b) => b.stars - a.stars).map((player, idx) => (
              <div key={player.id} className="score-card">
                <div className="name">{idx + 1}. {player.name}</div>
                <div className="stars">{player.stars} pts</div>
              </div>
            ))}
          </div>

          <button onClick={() => window.location.reload()} style={{ marginTop: 30 }}>
            Play Again
          </button>
        </div>
      )}

      {/* SKIPPED SONGS SECTION - Show in guessing, waiting, results, and gameover states */}
      {(gameState === 'guessing' || gameState === 'waiting' || gameState === 'results' || gameState === 'gameover') && skippedSongs.length > 0 && (
        <div style={{
          marginTop: '20px',
          background: 'rgba(255, 107, 107, 0.1)',
          border: '1px solid rgba(255, 107, 107, 0.3)',
          borderRadius: '12px',
          padding: '15px'
        }}>
          <h3 style={{ marginBottom: '12px', color: '#ff6b6b', fontSize: '1rem' }}>Skipped Songs ({skippedSongs.length})</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '250px', overflowY: 'auto' }}>
            {skippedSongs.map((song, idx) => (
              <div key={idx} style={{
                background: 'rgba(255, 255, 255, 0.05)',
                borderRadius: '6px',
                padding: '10px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}>
                {song.albumArt && (
                  <img src={song.albumArt} alt={song.name} style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '4px',
                    objectFit: 'cover'
                  }} />
                )}
                <div style={{ flex: 1, fontSize: '0.85rem' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '2px' }}>{song.name}</div>
                  <div style={{ fontSize: '0.75rem', color: '#b3b3b3' }}>{song.artist} • {song.year}</div>
                  <div style={{ fontSize: '0.7rem', color: song.type === 'host' ? '#ffa500' : '#ff6b6b', marginTop: '2px' }}>
                    {song.type === 'host' ? '🎮 Host skip' : `⏭️ ${song.skippedBy}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default Player
