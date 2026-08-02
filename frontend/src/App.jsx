import { BrowserRouter, Routes, Route, useSearchParams, useNavigate, useLocation, Navigate } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { useState, useEffect } from 'react'
import { setUser, setToken, isLoggedIn, getUserId } from './auth'
import { API_BASE } from './config'
import { apiFetch } from './api'
import EmailConsentModal from './components/EmailConsentModal'
import CalendarConnectModal from './components/CalendarConnectModal'
import LandingPage from './pages/LandingPage'
import Dashboard from './pages/Dashboard'
import LeaguePicker from './pages/LeaguePicker'
import TeamPicker from './pages/TeamPicker'
import UpcomingMatches from './pages/UpcomingMatches'
import NearbyMatches from './pages/NearbyMatches'
import TravelPlanner from './pages/TravelPlanner'
import MatchDetail from './pages/MatchDetail'
import Profile from './pages/Profile'
import Admin from './pages/Admin'
import PrivacyPolicy from './pages/PrivacyPolicy'
import TermsOfService from './pages/TermsOfService'

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

  // El token de sesión viaja en el FRAGMENTO (#token=), no en el query. El navegador nunca manda
  // el fragmento al servidor, así que no aparece en los logs de Render ni de Vercel ni en el
  // Referer — por eso el backend lo pone ahí (server.js, callback de OAuth).
  //
  // Se lee y se BORRA aquí mismo, en el bloque síncrono que corre al importar este módulo. Eso
  // ocurre antes de que main.jsx llame a render(), o sea antes de que <Analytics /> se monte e
  // inyecte el script de Vercel. Ninguna librería alcanza a ver el token, sin importar qué
  // capture: la garantía es el ORDEN, no confiar en lo que haga el script de terceros.
  // También lo saca de la barra de direcciones y del historial de esta entrada.
  if (url.hash) {
    const token = new URLSearchParams(url.hash.slice(1)).get('token')
    if (token) setToken(token)
    // replaceState y no location.hash = '': no recarga, no deja un '#' colgando y no agrega una
    // entrada nueva al historial.
    window.history.replaceState(null, '', url.pathname + url.search)
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

// Inversa de Protected: si ya hay sesión, salta el landing y va al dashboard
function RootRoute() {
  if (isLoggedIn()) return <Navigate to="/dashboard" replace />
  return <LandingPage />
}

function EmailConsentGate() {
  const [show, setShow] = useState(() => {
    return isLoggedIn() && !localStorage.getItem('fanschedule_email_consent_shown')
  })

  if (!show) return null

  const handleAccept = () => {
    localStorage.setItem('fanschedule_email_consent_shown', 'true')
    localStorage.setItem('fanschedule_email_notif', 'true')
    localStorage.setItem('fanschedule_partner_notif', 'true')
    setShow(false)
  }

  const handleDecline = () => {
    localStorage.setItem('fanschedule_email_consent_shown', 'true')
    localStorage.setItem('fanschedule_email_notif', 'false')
    localStorage.setItem('fanschedule_partner_notif', 'false')
    setShow(false)
  }

  return <EmailConsentModal onAccept={handleAccept} onDecline={handleDecline} />
}

// Gate de conexión de calendario: bloquea a un usuario logueado y conectado que NO otorgó
// el scope de Calendar (sin él la app no agenda nada). Decisión ASÍNCRONA (status endpoint).
function CalendarConnectGate() {
  const { pathname } = useLocation()
  const [status, setStatus] = useState({ loading: true, connected: false, hasCalendarScope: false })
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem('fanschedule_calendar_gate_dismissed') === 'true')

  useEffect(() => {
    if (!isLoggedIn()) { setStatus(s => ({ ...s, loading: false })); return }
    apiFetch(`/auth/google/status/${getUserId()}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) setStatus({ loading: false, connected: d.connected, hasCalendarScope: d.hasCalendarScope })
        else setStatus(s => ({ ...s, loading: false }))
      })
      .catch(() => setStatus(s => ({ ...s, loading: false })))
  }, [])

  // No bloquear en rutas públicas: el usuario debe poder leer la política/términos antes de dar permiso.
  const PUBLIC_PATHS = ['/privacy', '/terms']
  if (PUBLIC_PATHS.includes(pathname)) return null

  // No mostrar: sin sesión, mientras carga (evita parpadeo), si ya lo descartó esta sesión,
  // o si ya tiene el scope. Solo bloquea si está conectado SIN scope de Calendar.
  if (!isLoggedIn() || status.loading || dismissed) return null
  if (!(status.connected && !status.hasCalendarScope)) return null

  const handleConnect = () => { window.location.href = `${API_BASE}/auth/google` }
  const handleExplore = () => {
    sessionStorage.setItem('fanschedule_calendar_gate_dismissed', 'true')
    setDismissed(true)
  }

  return <CalendarConnectModal onConnect={handleConnect} onExplore={handleExplore} />
}

function App() {
  return (
    <BrowserRouter>
      <Analytics />
      <CleanOAuthParams />
      <CalendarConnectGate />
      <EmailConsentGate />
      <Routes>
        <Route path="/" element={<RootRoute />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<TermsOfService />} />
        <Route path="/dashboard"                   element={<Protected><Dashboard /></Protected>} />
        <Route path="/dashboard/:sport"            element={<Protected><LeaguePicker /></Protected>} />
        <Route path="/dashboard/:sport/:leagueId"  element={<Protected><TeamPicker /></Protected>} />
        <Route path="/upcoming"                    element={<Protected><UpcomingMatches /></Protected>} />
        <Route path="/nearby"                      element={<Protected><NearbyMatches /></Protected>} />
        <Route path="/travel"                      element={<Protected><TravelPlanner /></Protected>} />
        <Route path="/profile"                     element={<Protected><Profile /></Protected>} />
        <Route path="/admin"                       element={<Protected><Admin /></Protected>} />
        <Route path="/match/:matchId"              element={<MatchDetail />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
