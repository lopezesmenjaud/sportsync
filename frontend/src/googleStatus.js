import { useEffect, useState } from 'react'
import { apiFetch } from './api'
import { getUserId } from './auth'

// Estado de la conexión con Google, compartido por toda la app.
//
// Antes cada consumidor (el gate de App, Sidebar, Dashboard, Profile) hacía su propia petición a
// /auth/google/status: 3 llamadas por carga en /dashboard y /profile. Ahora es UNA, y los pickers
// obtienen el dato sin ninguna llamada nueva.
//
// EN MEMORIA, NUNCA EN STORAGE. localStorage/sessionStorage sobreviven el viaje a Google, así que
// guardarlo ahí dejaría el dato viejo justo después de conceder el permiso: alguien que ACABA de
// darlo volvería y vería "no conectado". Es el bug que arreglamos en el sidebar, reintroducido por
// la puerta de atrás.
let cache = null              // { userId, promesa }
let intentoDeConexion = false // ¿esta persona salió a /auth/google y todavía no volvemos a mirar?
const oyentes = new Set()

function notificar(estado) {
  for (const cb of oyentes) cb(estado)
}

const ESPERA_REINTENTO_MS = 1200

function unaLlamada(userId) {
  return apiFetch(`/auth/google/status/${userId}`)
    .then((r) => r.json())
    // ok:false (un 500 del backend) cuenta como fallo: llega por el camino feliz de la promesa,
    // así que sin tratarlo así un solo error se quedaría cacheado como "no sabemos" para siempre.
    .then((d) => (d && d.ok ? d : null))
    .catch(() => null)
}

// UN reintento, uno solo, y dentro de la promesa compartida: así el reintento es UNO en total y
// no uno por consumidor. Máximo dos intentos, sin bucle.
//
// Por qué hace falta: al compartir una sola petición también compartimos su fallo. Con la regla
// de "no pintamos lo que no sabemos", un único error apaga a la vez el sidebar, el banner del
// dashboard, los botones del perfil y el gate — y nadie reintenta, porque los componentes ya
// montaron. La persona se quedaría sin NINGÚN camino para conectar Google.
function pedir(userId) {
  const promesa = unaLlamada(userId)
    .then(async (d) => {
      if (d) return d
      await new Promise((r) => setTimeout(r, ESPERA_REINTENTO_MS))
      return unaLlamada(userId)
    })
    .then((d) => {
      // Si ni el reintento sirvió, se suelta el cache. No es un bucle: solo vuelve a intentarse
      // cuando algún componente monte de nuevo (navegar a otra pantalla y volver), y eso es
      // justamente la salida del estado "no sabemos" sin obligar a recargar.
      if (!d) cache = null
      return d
    })
  cache = { userId, promesa }
  return promesa
}

// null = NO SABEMOS. Nunca significa "no tiene permiso": quien lo consuma no debe pintar nada,
// igual que mientras carga. Afirmar lo que no sabemos es peor que callarse.
export function obtenerEstadoGoogle() {
  const userId = getUserId()
  if (!userId) return Promise.resolve(null)
  // Amarrado al userId: si cambió de cuenta, el cache anterior no vale.
  if (cache && cache.userId === userId) return cache.promesa
  return pedir(userId)
}

// Se llama JUSTO ANTES de mandar a /auth/google, en TODOS los caminos que llevan ahí.
//
// No es redundante con la carga de documento: FanSchedule es una PWA instalable
// (public/manifest.json, display: standalone). En modo standalone la ida a Google sale de la app
// y el documento puede seguir vivo al volver — con el cache viejo. Por eso además se levanta la
// bandera: al regresar visible, se vuelve a preguntar UNA vez.
export function invalidarEstadoGoogle() {
  cache = null
  intentoDeConexion = true
}

// La bandera vive en memoria, no en storage, por la misma razón que el cache: si el documento
// sobrevive, la variable sobrevive con él; si no sobrevive, el documento nuevo ya trae cache
// limpio y la bandera no hace falta.
//
// El costo de esta petición extra lo paga SOLO quien intentó conectar. Un cambio de pestaña
// cualquiera no dispara nada porque la bandera está abajo.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    if (!intentoDeConexion) return
    intentoDeConexion = false
    cache = null
    const userId = getUserId()
    if (!userId) return notificar(null)
    pedir(userId).then(notificar)
  })
}

/**
 * activo=false → no se pide nada y el estado queda en null (no se pinta). Lo usa el gate de App
 * para no consultar en rutas públicas: ahí la petición sobra y además exige sesión.
 *
 * Devuelve { estado, cargando }:
 *   cargando true  → no pintar (evita el parpadeo de "no conectado" que arreglamos hoy)
 *   estado null    → no pintar (no sabemos)
 *   estado objeto  → { connected, email, needsReauth, hasCalendarScope }
 */
export function useEstadoGoogle(activo = true) {
  const [estado, setEstado] = useState(undefined) // undefined = todavía cargando

  useEffect(() => {
    if (!activo) {
      setEstado(null)
      return
    }
    let vivo = true
    obtenerEstadoGoogle().then((e) => { if (vivo) setEstado(e) })

    // Suscripción: sin esto, el refresco tras volver de Google actualizaría el cache y la
    // pantalla seguiría vieja — un arreglo que no arregla.
    const cb = (e) => { if (vivo) setEstado(e) }
    oyentes.add(cb)
    return () => { vivo = false; oyentes.delete(cb) }
  }, [activo])

  return { estado, cargando: estado === undefined }
}
