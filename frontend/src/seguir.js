// Qué equipos ofrecerle a alguien que llegó por una página pública.
//
// La página pública (/equipo/... o /partido/...) manda "?seguir=equipo:<slug>" o
// "?seguir=partido:<id>" en el botón de conectar. Aquí se guarda en localStorage y, al volver de
// Google y después de los modales que ya existen, SeguirEquiposGate lo usa UNA vez.
//
// Es un dato distinto del origen (origen.js): aquel dice de qué grupo de Facebook vino la
// persona; éste, qué ofrecerle. Llave separada a propósito, y regla distinta: aquí gana el
// ÚLTIMO contacto, porque es la intención más reciente de la persona.
//
// localStorage y no sessionStorage por la misma razón que el origen: el viaje a Google puede
// cerrar la pestaña. Pero caduca en 24 horas: quien se registró por los Cowboys y vuelve la
// semana que entra no tiene por qué volver a ver esa pantalla.

const CLAVE = 'fs_seguir'
const CADUCIDAD_MS = 24 * 60 * 60 * 1000

// El mismo formato que acepta GET /api/seguir (partidoPublico.js). Lo que no case no se guarda.
const FORMATO = /^(equipo|partido):[A-Za-z0-9._~:-]{1,120}$/

/**
 * Captura ?seguir= de la URL. Se llama en CADA carga, antes de renderizar, junto al origen.
 * Quita el parámetro de la barra de direcciones para que volver con "atrás" o recargar no lo
 * reviva después de que la pantalla ya se mostró.
 */
export function capturarSeguirDeUrl() {
  try {
    const url = new URL(window.location.href)
    const valor = url.searchParams.get('seguir')
    if (valor === null) return
    url.searchParams.delete('seguir')
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
    if (!FORMATO.test(valor)) return
    localStorage.setItem(CLAVE, JSON.stringify({ contexto: valor, guardado: Date.now() }))
  } catch {
    // Sin storage o URL rara: se pierde el ofrecimiento y ya. Nunca impide que la app cargue.
  }
}

/** El contexto vigente, o null. Si caducó o viene roto, lo borra. */
export function leerContextoSeguir() {
  try {
    const crudo = localStorage.getItem(CLAVE)
    if (!crudo) return null
    const dato = JSON.parse(crudo)
    const edad = Date.now() - Number(dato?.guardado)
    if (!dato || !FORMATO.test(dato.contexto) || !(edad >= 0 && edad < CADUCIDAD_MS)) {
      localStorage.removeItem(CLAVE)
      return null
    }
    return dato.contexto
  } catch {
    return null
  }
}

/** Se llama cuando la pantalla YA se mostró, o cuando no hay nada que ofrecer. */
export function borrarContextoSeguir() {
  try { localStorage.removeItem(CLAVE) } catch { /* nada */ }
}
