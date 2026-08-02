import { API_BASE } from './config'
import { getToken } from './auth'

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
export async function apiFetch(path, options = {}) {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new Error(`[api] apiFetch espera una ruta relativa que empiece con "/", recibió: ${path}`)
  }

  const headers = { ...(options.headers || {}) }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers })

  if (!res.ok) await avisarFallo(res, options.method || 'GET', path)

  return res
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
