import { useState, useEffect } from 'react'
import { io } from 'socket.io-client'

const SOCKET_URL = 'http://localhost:3001'

function Player() {
  const [socket, setSocket] = useState(null)
  const [roomCode, setRoomCode] = useState('')
  const [playerName, setPlayerName] = useState('')
  const [gameState, setGameState] = useState('join') // join, lobby, guessing, waiting, results, gameover
  const [players, setPlayers] = useState([])
  const [error, setError] = useState(null)
  const [tracks, setTracks] = useState([])
  const [currentRound, setCurrentRound] = useState(0)

  // Guess form state
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSong, setSelectedSong] = useState(null)
  const [artistGuess, setArtistGuess] = useState('')
  const [yearGuess, setYearGuess] = useState('')
  const [overThreeMin, setOverThreeMin] = useState(null)
  const [hasSubmitted, setHasSubmitted] = useState(false)

  // Results
  const [roundResults, setRoundResults] = useState(null)
  const [winner, setWinner] = useState(null)

  // Initialize socket
  useEffect(() => {
    const newSocket = io(SOCKET_URL)
    setSocket(newSocket)

    newSocket.on('joined-room', ({ roomCode, players }) => {
      setGameState('lobby')
      setPlayers(players)
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

    newSocket.on('round-start', ({ round, tracks }) => {
      setCurrentRound(round)
      setTracks(tracks)
      setGameState('guessing')
      setHasSubmitted(false)
      // Reset form
      setSearchQuery('')
      setSelectedSong(null)
      setArtistGuess('')
      setYearGuess('')
      setOverThreeMin(null)
    })

    newSocket.on('guess-received', () => {
      setHasSubmitted(true)
      setGameState('waiting')
    })

    newSocket.on('round-results', ({ track, results, roundWinner, players }) => {
      setGameState('results')
      setRoundResults({ track, results, roundWinner })
      setPlayers(players)
    })

    newSocket.on('game-over', ({ winner, players }) => {
      setGameState('gameover')
      setWinner(winner)
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
    if (!selectedSong || !yearGuess || overThreeMin === null) {
      setError('Please fill in all fields')
      return
    }
    setError(null)
    socket.emit('submit-guess', {
      songId: selectedSong.id,
      artist: artistGuess,
      year: parseInt(yearGuess),
      overThreeMin
    })
  }

  // Filter songs based on search
  const filteredTracks = tracks.filter(track =>
    track.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    track.artist.toLowerCase().includes(searchQuery.toLowerCase())
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
        </div>
      )}

      {/* LOBBY: Waiting for game to start */}
      {gameState === 'lobby' && (
        <div style={{ textAlign: 'center' }}>
          <h2>You're In!</h2>
          <p style={{ color: '#888', marginBottom: 20 }}>Waiting for host to start the game...</p>

          <div className="players-list" style={{ justifyContent: 'center' }}>
            {players.map(player => (
              <div key={player.id} className="player-tag">
                {player.name}
                {player.name === playerName && ' (you)'}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* GUESSING: Player makes their guess */}
      {gameState === 'guessing' && (
        <div className="guess-form">
          <h2 style={{ textAlign: 'center' }}>Round {currentRound}</h2>
          <p style={{ textAlign: 'center', color: '#888', marginBottom: 20 }}>Listen and guess!</p>

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
                    setArtistGuess(track.artist)
                  }}
                >
                  <div><strong>{track.name}</strong></div>
                  <div style={{ color: '#888', fontSize: '0.9rem' }}>{track.artist}</div>
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
            placeholder="Artist name..."
            value={artistGuess}
            onChange={(e) => setArtistGuess(e.target.value)}
          />

          {/* Year */}
          <label>Release Year</label>
          <input
            type="number"
            placeholder="e.g. 1985"
            value={yearGuess}
            onChange={(e) => setYearGuess(e.target.value)}
            min="1900"
            max="2030"
          />

          {/* Duration */}
          <label>Song Duration</label>
          <div className="toggle-group">
            <button
              type="button"
              className={`toggle-btn ${overThreeMin === false ? 'active' : ''}`}
              onClick={() => setOverThreeMin(false)}
            >
              Under 3 min
            </button>
            <button
              type="button"
              className={`toggle-btn ${overThreeMin === true ? 'active' : ''}`}
              onClick={() => setOverThreeMin(true)}
            >
              Over 3 min
            </button>
          </div>

          <button onClick={handleSubmitGuess} style={{ marginTop: 20 }}>
            Submit Guess
          </button>
        </div>
      )}

      {/* WAITING: Submitted, waiting for others */}
      {gameState === 'waiting' && !hasSubmitted && (
        <div className="waiting">
          <h2>Get Ready...</h2>
          <p>Round starting soon!</p>
        </div>
      )}

      {gameState === 'waiting' && hasSubmitted && (
        <div className="waiting">
          <div className="submitted-badge" style={{ fontSize: '1.2rem', padding: '15px 30px' }}>
            ✓ Submitted!
          </div>
          <p style={{ marginTop: 20 }}>Waiting for other players...</p>
        </div>
      )}

      {/* RESULTS */}
      {gameState === 'results' && roundResults && (
        <div style={{ textAlign: 'center' }}>
          <h2>Round {currentRound}</h2>

          {roundResults.track.albumArt && (
            <img src={roundResults.track.albumArt} alt="Album" className="album-art" style={{ width: 150, height: 150 }} />
          )}

          <h3 style={{ marginTop: 15 }}>{roundResults.track.name}</h3>
          <p style={{ color: '#888' }}>{roundResults.track.artist}</p>
          <p style={{ color: '#666', fontSize: '0.9rem' }}>
            {roundResults.track.year} • {roundResults.track.isOverThreeMin ? 'Over' : 'Under'} 3 min
          </p>

          {roundResults.roundWinner && (
            <div className="winner-banner" style={{ fontSize: '1rem', padding: 15, marginTop: 20 }}>
              ★ {roundResults.roundWinner.playerName} wins!
            </div>
          )}

          <div className="scoreboard" style={{ marginTop: 20 }}>
            {players.map(player => (
              <div key={player.id} className="score-card">
                <div className="name">{player.name}</div>
                <div className="stars" style={{ fontSize: '1rem' }}>
                  {player.stars} ★
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
          <h2>Game Over!</h2>
          <div className="winner-banner">
            🏆 {winner.name} Wins! 🏆
          </div>

          <div className="scoreboard" style={{ marginTop: 20 }}>
            {players.sort((a, b) => b.stars - a.stars).map((player, idx) => (
              <div key={player.id} className="score-card">
                <div className="name">{idx + 1}. {player.name}</div>
                <div className="stars">{player.stars} ★</div>
              </div>
            ))}
          </div>

          <button onClick={() => window.location.reload()} style={{ marginTop: 30 }}>
            Play Again
          </button>
        </div>
      )}
    </div>
  )
}

export default Player
