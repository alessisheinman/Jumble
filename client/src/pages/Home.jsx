import { useNavigate } from 'react-router-dom'

function Home() {
  const navigate = useNavigate()

  const handleHostGame = () => {
    navigate('/host')
  }

  const handleJoinGame = () => {
    navigate('/play')
  }

  return (
    <div className="container" style={{ textAlign: 'center', marginTop: '10vh' }}>
      <h1>Music Guessing Game</h1>
      <h2>A Hitster-style music trivia game</h2>
      <p style={{ color: '#888', marginTop: 20 }}>Powered by Deezer - 30 second song previews!</p>

      <div className="home-buttons">
        <button onClick={handleHostGame}>
          Host a Game
        </button>
        <button className="secondary" onClick={handleJoinGame}>
          Join a Game
        </button>
      </div>

      <div style={{ marginTop: 50, color: '#888', fontSize: '0.9rem' }}>
        <p>No authentication required - just paste a Deezer playlist URL</p>
        <p style={{ marginTop: 10 }}>Players join with a room code on their phones</p>
      </div>
    </div>
  )
}

export default Home
