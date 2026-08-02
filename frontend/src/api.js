import { API_BASE } from './config'
import { getToken, clearUser } from './auth'

// Cliente único para hablar con NUESTRO backend.
//
// Recibe una RUTA RELATIVA ('/subscriptions/x'), nunca una URL completa. Es a propósito: hace
// estructuralmente imposible apuntar esta función a otro dominio y mandarle el token de sesión a
// un tercero. Los dos fetch de utils/geocoding.js pegan a nominatim.openstreetmap.org y por eso
// se quedan con fetch pelón — no deben pasar por aquí nunca.
//
// Adjunta Authorization: Bearer si hay token. Si no hay, la petición sale igual y el backend la
// atiende por el camino legacy (ALLOW_LEGACY_USERID), así que un usuario que todavía no reconecta
// sigue funcionando exactamente como hoy.
//
// DEVUELVE la Response tal cual; NO lanza cuando el status no es ok. Decisión deliberada: lanzar
// aplanaría los 404 que traen mensaje propio (p.ej. "Partido no encontrado" en MatchDetail se
// convertiría en "Error de conexión"). Cada llamador sigue decidiendo qué hacer, igual que hoy.
//
// opts.publica: solo para pantallas públicas (hoy únicamente el detalle de partido). Ver abajo.
export async function apiFetch(path, options = {}) {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new Error(`[api] apiFetch espera una ruta relativa que empiece con "/", recibió: ${path}`)
  }

  const { publica = false, ...init } = options
  const headers = { ...(init.headers || {}) }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers })

  if (res.status === 401) {
    await avisarFallo(res, init.method || 'GET', path)

    // Pantalla PÚBLICA con un token vencido: un token muerto NO debe convertir una página
    // pública en privada. Alguien que abre /match/123 desde el link de su calendario o desde un
    // link compartido tiene que ver el partido, no un muro de reconectar.
    // Se tira el token malo y se reintenta UNA sola vez sin él: el backend la atiende como
    // anónimo. Solo si HABÍA token — si no lo había y aun así respondió 401, reintentar sin él
    // daría exactamente el mismo 401 en un bucle.
    if (publica && token) {
      clearUser()
      const reintento = await fetch(`${API_BASE}${path}`, { ...init, headers: { ...(init.headers || {}) } })
      if (!reintento.ok) await avisarFallo(reintento, init.method || 'GET', `${path} (reintento anónimo)`)
      return reintento
    }

    manejarSesionInvalida()
    return res
  }

  if (!res.ok) await avisarFallo(res, init.method || 'GET', path)

  return res
}

// Llaves de sessionStorage. Sobreviven el viaje de ida y vuelta a Google porque es la misma
// pestaña y el mismo origen.
const DESTINO_KEY = 'fanschedule_destino'
const EXPIRADA_KEY = 'fanschedule_sesion_expirada'

// UNA sola redirección aunque varias llamadas den 401 a la vez. /auth/google/status corre en
// cuatro lugares (App, Sidebar, Dashboard, Profile): sin este candado se pelearían cuatro
// redirecciones simultáneas.
let redirigiendo = false

function manejarSesionInvalida() {
  clearUser() // borra userId Y token: la sesión está muerta, que la app no finja lo contrario

  if (redirigiendo) return
  redirigiendo = true

  try {
    sessionStorage.setItem(EXPIRADA_KEY, '1')
    // A dónde iba la persona. Si venía a /match/123 desde el link de su calendario, después de
    // reconectar debe volver AHÍ, no al dashboard.
    const destino = window.location.pathname + window.location.search
    if (destino && destino !== '/') sessionStorage.setItem(DESTINO_KEY, destino)
  } catch { /* sin sessionStorage: se pierde el destino, la redirección sigue igual */ }

  if (window.location.pathname === '/') {
    redirigiendo = false // ya estamos en el landing, no hay a dónde ir
    return
  }
  // replace y no href: no deja la pantalla rota en el historial, así el botón atrás no regresa a
  // ella. Recarga completa a propósito: descarta cualquier estado en memoria de la sesión muerta.
  window.location.replace('/')
}

// Lo consume el landing para avisar "tu sesión expiró" en vez de aparecer sin explicación.
// Se lee UNA vez: al leerlo se borra.
export function consumirSesionExpirada() {
  try {
    const expirada = sessionStorage.getItem(EXPIRADA_KEY) === '1'
    if (expirada) sessionStorage.removeItem(EXPIRADA_KEY)
    return expirada
  } catch { return false }
}

// Lo consume App tras volver del OAuth, para aterrizar donde la persona iba.
export function consumirDestino() {
  try {
    const destino = sessionStorage.getItem(DESTINO_KEY)
    if (destino) sessionStorage.removeItem(DESTINO_KEY)
    return destino
  } catch { return null }
}

// Ninguna respuesta fallida vuelve a ser del todo invisible. No cambia el flujo de nadie: solo
// deja rastro en la consola, con prefijo fijo [api] para poder filtrarlo.
// Incluye el campo "error" del cuerpo porque ver 404 a secas no dice nada, y ver
// 404 — "Match not found" resuelve la duda al instante. Esos cuerpos no traen datos sensibles
// (verificado en AUDITORIA-AUTORIZACION.md: no se filtran tokens ni claves).
// Se lee sobre res.clone() para NO consumir el cuerpo que el llamador va a leer después.
async function avisarFallo(res, method, path) {
  let detalle = ''
  try {
    const cuerpo = await res.clone().json()
    if (cuerpo && cuerpo.error) detalle = ` — "${cuerpo.error}"`
  } catch { /* respuesta sin JSON: solo se reporta el status */ }
  console.warn(`[api] ${res.status} ${method.toUpperCase()} ${path}${detalle}`)
}
