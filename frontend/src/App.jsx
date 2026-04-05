import { BrowserRouter, Routes, Route, useSearchParams, useNavigate, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { setUser, isLoggedIn } from './auth'
import LandingPage from './pages/LandingPage'
import Dashboard from './pages/Dashboard'
import LeaguePicker from './pages/LeaguePicker'
import TeamPicker from './pages/TeamPicker'
import UpcomingMatches from './pages/UpcomingMatches'
import NearbyMatches from './pages/NearbyMatches'
import TravelPlanner from './pages/TravelPlanner'
import MatchDetail from './pages/MatchDetail'

// Guarda el user del OAuth callback ANTES del primer render de rutas protegidas
function saveUserFromUrl() {
  const url = new URL(window.location.href)
  const userParam = url.searchParams.get('user')
  if (userParam) {
    try {
      const user = JSON.parse(decodeURIComponent(userParam))
      setUser(user)
    } catch { /* ignore */ }
  }
}

// Ejecutar sincrónicamente antes de que React renderice
saveUserFromUrl()

// Limpia los query params del OAuth después del render
function CleanOAuthParams() {
  const [params] = useSearchParams()
  const navigate = useNavigate()

  useEffect(() => {
    if (params.get('user') || params.get('google')) {
      navigate('/dashboard', { replace: true })
    }
  }, [params, navigate])

  return null
}

function Protected({ children }) {
  if (!isLoggedIn()) return <Navigate to="/" replace />
  return children
}

function App() {
  return (
    <BrowserRouter>
      <CleanOAuthParams />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/dashboard"                   element={<Protected><Dashboard /></Protected>} />
        <Route path="/dashboard/:sport"            element={<Protected><LeaguePicker /></Protected>} />
        <Route path="/dashboard/:sport/:leagueId"  element={<Protected><TeamPicker /></Protected>} />
        <Route path="/upcoming"                    element={<Protected><UpcomingMatches /></Protected>} />
        <Route path="/nearby"                      element={<Protected><NearbyMatches /></Protected>} />
        <Route path="/travel"                      element={<Protected><TravelPlanner /></Protected>} />
        <Route path="/match/:matchId"              element={<MatchDetail />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
