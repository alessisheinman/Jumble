import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Host from './pages/Host'
import Player from './pages/Player'

function App() {
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/host" element={<Host />} />
        <Route path="/play" element={<Player />} />
      </Routes>
    </div>
  )
}

export default App
