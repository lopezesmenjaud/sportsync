import { BrowserRouter, Routes, Route, useSearchParams, useNavigate, useLocation, Navigate } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { useState, useEffect } from 'react'
import { setUser, setToken, isLoggedIn, getUserId } from './auth'
import { API_BASE } from './config'
import { consumirDestino, apiFetch } from './api'
import { useEstadoGoogle, invalidarEstadoGoogle } from './googleStatus'
import { PUBLIC_PATHS, isPublicPath } from './publicRoutes'
import { capturarOrigenDeUrl, enviarOrigenSiHace } from './origen'
import { capturarSeguirDeUrl } from './seguir'
import { useMarcarModal } from './modalesEnCurso'
import EmailConsentModal from './components/EmailConsentModal'
import SeguirEquiposGate from './components/SeguirEquiposGate'
import CalendarConnectModal from './components/CalendarConnectModal'
import LandingPage from './pages/LandingPage'
import Dashboard from './pages/Dashboard'
import LeaguePicker from './pages/LeaguePicker'
import TeamPicker from './pages/TeamPicker'
import SeleccionesPage from './pages/SeleccionesPage'
import UpcomingMatches from './pages/UpcomingMatches'
import NearbyMatches from './pages/NearbyMatches'
import TravelPlanner from './pages/TravelPlanner'
import MatchDetail from './pages/MatchDetail'
import Profile from './pages/Profile'
import Admin from './pages/Admin'

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

// El ?g= de la campaña se captura AQUÍ, en el mismo bloque síncrono y antes de cualquier
// render, por la misma razón que saveUserFromUrl: es la única forma de garantizar que corre
// pase lo que pase después. Se ejecuta en TODA carga, incluidas las rutas públicas — el link
// del post de Facebook cae en el landing, que es una de ellas.
capturarOrigenDeUrl()

// Qué equipos ofrecerle al volver del registro (?seguir= del botón de la página pública). Va
// DESPUÉS del origen: los dos leen la misma URL y éste le quita su parámetro.
capturarSeguirDeUrl()

// Manda el origen al backend cuando ya hay sesión. Va en un componente y no en el bloque de
// arriba porque el orden importa: al volver de Google, saveUserFromUrl guarda el token en el
// mismo tick, así que para cuando esto monta ya hay con qué autenticarse.
function RegistrarOrigen() {
  useEffect(() => { enviarOrigenSiHace() }, [])
  return null
}

// Limpia los query params del OAuth después del render
function CleanOAuthParams() {
  const [params] = useSearchParams()
  const navigate = useNavigate()

  useEffect(() => {
    if (params.get('user') || params.get('google')) {
      // Si la sesión se venció mientras alguien iba a una pantalla concreta, después de
      // reconectar vuelve AHÍ y no al dashboard. El caso típico: abrió /match/123 desde el link
      // del evento en su Google Calendar.
      const destino = consumirDestino()
      navigate(destino || '/dashboard', { replace: true })
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

// Marcas del modal de correos VIEJO en localStorage. Ya no deciden nada: quién contestó lo dice el
// servidor (GET /api/consent). Se borran una vez al cargar la app para que no confundan a nadie.
// try/catch porque el navegador puede bloquear el almacenamiento.
const MARCAS_VIEJAS_DE_CORREOS = ['fanschedule_email_consent_shown', 'fanschedule_email_notif', 'fanschedule_partner_notif']
function borrarMarcasViejasDeCorreos() {
  for (const clave of MARCAS_VIEJAS_DE_CORREOS) {
    try { localStorage.removeItem(clave) } catch { /* almacenamiento bloqueado: no hay nada que borrar */ }
  }
}

// "Ahora no" pospone el modal 7 días, POR CUENTA. Esto NO es consentimiento, es cortesía para no
// insistir: el estado de verdad sigue en el servidor, y quien pospone sigue en "nunca contestó".
// Si se pierde (otro navegador, datos borrados, almacenamiento bloqueado), lo peor que pasa es que
// se le pregunte una vez más.
const DIAS_PARA_VOLVER_A_PREGUNTAR = 7
const clavePospuesto = (userId) => `fanschedule_correos_pospuesto_${userId}`
function pospusoHacePoco(userId) {
  try {
    const fecha = Date.parse(localStorage.getItem(clavePospuesto(userId)) || '')
    return Number.isFinite(fecha) && Date.now() - fecha < DIAS_PARA_VOLVER_A_PREGUNTAR * 24 * 60 * 60 * 1000
  } catch {
    return false
  }
}
function recordarQuePospuso(userId) {
  try { localStorage.setItem(clavePospuesto(userId), new Date().toISOString()) } catch { /* sin almacenamiento: se le volverá a preguntar */ }
}

// Gate del consentimiento de correos. A quién se le muestra lo decide el SERVIDOR, no localStorage:
//   - a quien no tiene fila (nunca contestó), y
//   - a quien tiene las dos versiones en NULL (solo contestó el modal viejo amarrado).
//   Si ya tocó al menos un permiso en el perfil, ya vio las opciones separadas: no se le muestra.
// Mientras el GET carga, el modal cuenta como "por decidirse" (modalesEnCurso): así la pantalla de
// seguir equipos no se adelanta y luego queda debajo. Si el GET falla, no se muestra en esta visita
// y se deja de marcar: no se adivina. En ruta pública no se pregunta (el GET exige sesión).
function EmailConsentGate() {
  const { pathname } = useLocation()
  const userId = getUserId()
  const activo = !isPublicPath(pathname) && isLoggedIn() && Boolean(userId)
  const pospuesto = activo && pospusoHacePoco(userId)
  // null mientras no hay respuesta; luego { mostrar, textos } o { mostrar: false } si falló.
  const [respuesta, setRespuesta] = useState(null)
  const [cerrado, setCerrado] = useState(false)

  useEffect(() => { borrarMarcasViejasDeCorreos() }, [])

  useEffect(() => {
    if (!activo || pospuesto || respuesta !== null) return
    let vigente = true
    apiFetch('/api/consent')
      .then(res => res.json())
      .then(data => {
        if (!vigente) return
        if (!data || !data.ok || !data.textos) return setRespuesta({ mostrar: false })
        const nuncaEligioPorSeparado = !data.respondio || (data.versionNovedades === null && data.versionSocios === null)
        setRespuesta({ mostrar: nuncaEligioPorSeparado, textos: data.textos })
      })
      .catch(() => { if (vigente) setRespuesta({ mostrar: false }) })
    return () => { vigente = false }
  }, [activo, pospuesto, respuesta])

  const porDecidirse = activo && !pospuesto && !cerrado && respuesta === null
  const abierto = activo && !pospuesto && !cerrado && Boolean(respuesta && respuesta.mostrar)
  // Abierto o todavía por decidirse: la pantalla de seguir equipos espera.
  useMarcarModal('correos', porDecidirse || abierto)

  if (!abierto) return null

  return (
    <EmailConsentModal
      textos={respuesta.textos}
      onGuardado={() => setCerrado(true)}
      onPosponer={() => { recordarQuePospuso(userId); setCerrado(true) }}
    />
  )
}

// Gate de conexión de calendario: bloquea a un usuario logueado y conectado que NO otorgó
// el scope de Calendar (sin él la app no agenda nada). Decisión ASÍNCRONA (status endpoint).
function CalendarConnectGate() {
  const { pathname } = useLocation()
  const enRutaPublica = isPublicPath(pathname)
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem('fanschedule_calendar_gate_dismissed') === 'true')

  // En ruta pública NI SE PREGUNTA — el hook no dispara petición con activo=false. Este componente
  // vive fuera de <Routes>, así que corre en todas las pantallas, incluida /match/:matchId;
  // y /auth/google/status exige sesión, así que preguntar ahí con un token
  // vencido daba 401 y disparaba la redirección global.
  const { estado, cargando } = useEstadoGoogle(!enRutaPublica && isLoggedIn())

  // Abierto, o todavía por decidirse (cargando): la pantalla de seguir equipos espera a que este
  // gate se resuelva. Es la MISMA condición de abajo; no cambia cuándo sale este modal.
  useMarcarModal(
    'calendario',
    !enRutaPublica && isLoggedIn() && !dismissed &&
      (cargando || Boolean(estado && estado.connected && !estado.hasCalendarScope))
  )

  // No bloquear en rutas públicas: el usuario debe poder leer el partido, la política o los
  // términos sin que se le encime un modal de conectar calendario.
  if (enRutaPublica) return null

  // No mostrar: sin sesión, mientras carga (evita parpadeo), si no sabemos (estado null), si ya
  // lo descartó esta sesión, o si ya tiene el scope. Solo bloquea si está conectado SIN scope.
  if (!isLoggedIn() || cargando || !estado || dismissed) return null
  // A PROPÓSITO no usa faltaPermisoCalendario(): ese helper excluye needsReauth y aquí NO se
  // quiere excluir. Alguien con el token vencido que reconecta y otra vez no marca la casilla
  // conserva needsReauth=1 y sigue sin scope (server.js solo limpia needsReauth si lo otorgó).
  // Su problema real es la casilla, y el aviso de "tu conexión expiró" no la nombra. Este gate
  // es el único que se lo dice, así que se queda cubriéndolo.
  if (!(estado.connected && !estado.hasCalendarScope)) return null

  const handleConnect = () => { invalidarEstadoGoogle(); window.location.href = `${API_BASE}/auth/google` }
  const handleExplore = () => {
    sessionStorage.setItem('fanschedule_calendar_gate_dismissed', 'true')
    setDismissed(true)
  }

  // Los textos por default del modal ("Conecta tu calendario" / "Conectar Google Calendar") son
  // los de quien NO ha conectado nada. Aquí la persona YA conectó: decírselo así la manda a picar
  // otra vez lo que cree que ya hizo. Lo que falta es la casilla, y eso es lo que tiene que leer.
  return (
    <CalendarConnectModal
      titulo="Falta el permiso del calendario"
      lineaDeEntrada="Tu cuenta de Google ya está conectada. Lo que falta es la casilla del calendario."
      etiquetaPrincipal="Dar permiso del calendario"
      onConnect={handleConnect}
      onExplore={handleExplore}
    />
  )
}

// QUÉ renderiza cada ruta pública. CUÁLES son las rutas públicas se decide en publicRoutes.js,
// que es la lista que también consulta api.js — aquí no se puede agregar una ruta pública nueva.
const ELEMENTOS_PUBLICOS = {
  '/': <RootRoute />,
  '/match/:matchId': <MatchDetail />,
}

// Si alguien agrega una ruta a PUBLIC_PATHS y olvida su elemento aquí, que se grite en la
// consola en vez de renderizar una pantalla en blanco sin explicación.
const PUBLICAS_SIN_ELEMENTO = PUBLIC_PATHS.filter(p => !ELEMENTOS_PUBLICOS[p])
if (PUBLICAS_SIN_ELEMENTO.length) {
  console.error(`[rutas] Rutas públicas sin elemento en App.jsx: ${PUBLICAS_SIN_ELEMENTO.join(', ')}`)
}

function App() {
  return (
    <BrowserRouter>
      <Analytics />
      <CleanOAuthParams />
      <RegistrarOrigen />
      <CalendarConnectGate />
      <EmailConsentGate />
      {/* Al final a propósito: sale después de los dos de arriba, nunca encima. */}
      <SeguirEquiposGate />
      <Routes>
        {/* Las rutas PÚBLICAS se generan recorriendo PUBLIC_PATHS: es la misma lista que usa
            api.js para decidir qué hacer ante un 401. Si una página pública no está en el
            arreglo, no existe — no hay forma de agregarla y olvidarse de la lista. */}
        {PUBLIC_PATHS.map(path => (
          <Route key={path} path={path} element={ELEMENTOS_PUBLICOS[path]} />
        ))}
        <Route path="/dashboard"                   element={<Protected><Dashboard /></Protected>} />
        <Route path="/dashboard/:sport"            element={<Protected><LeaguePicker /></Protected>} />
        {/* Ruta fija: react-router le da prioridad sobre /dashboard/:sport/:leagueId, así que
            "selecciones" nunca se confunde con el id de una liga. */}
        <Route path="/dashboard/futbol/selecciones" element={<Protected><SeleccionesPage /></Protected>} />
        <Route path="/dashboard/:sport/:leagueId"  element={<Protected><TeamPicker /></Protected>} />
        <Route path="/upcoming"                    element={<Protected><UpcomingMatches /></Protected>} />
        <Route path="/nearby"                      element={<Protected><NearbyMatches /></Protected>} />
        <Route path="/travel"                      element={<Protected><TravelPlanner /></Protected>} />
        <Route path="/profile"                     element={<Protected><Profile /></Protected>} />
        <Route path="/admin"                       element={<Protected><Admin /></Protected>} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
