import { useSearchParams } from 'react-router-dom'

function Home() {
  const [searchParams] = useSearchParams()
  const error = searchParams.get('error')

  const handleHostGame = () => {
    window.location.href = 'http://localhost:3001/login'
  }

  const handleJoinGame = () => {
    window.location.href = '/play'
  }

  return (
    <div className="container" style={{ textAlign: 'center', marginTop: '10vh' }}>
      <h1>Spotify Guessing Game</h1>
      <h2>A Hitster-style music trivia game</h2>

      {error && (
        <div style={{ color: '#ff6b6b', marginBottom: 20 }}>
          Error: {error}
        </div>
      )}

      <div className="home-buttons">
        <button onClick={handleHostGame}>
          Host a Game
        </button>
        <button className="secondary" onClick={handleJoinGame}>
          Join a Game
        </button>
      </div>

      <div style={{ marginTop: 50, color: '#888', fontSize: '0.9rem' }}>
        <p>Host needs a Spotify Premium account</p>
        <p style={{ marginTop: 10 }}>Players join with a room code on their phones</p>
      </div>
    </div>
  )
}

export default Home
