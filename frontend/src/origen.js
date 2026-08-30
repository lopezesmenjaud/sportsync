import { apiFetch } from './api'
import { isLoggedIn } from './auth'

// De qué grupo de Facebook llegó la persona.
//
// El valor sale del parámetro ?g= de la URL de entrada y de NADA MÁS. Es un dato que NO se
// puede reconstruir después: si no se captura en el primer contacto, se pierde para siempre.
//
// El viaje completo es: la persona pica el link del post (fanschedule.com/?g=nfl13) → se guarda
// en localStorage → se va a Google a conectar su cuenta → vuelve autenticada → recién ahí se
// manda al backend, porque hasta ese momento no hay a qué cuenta pegarlo.
//
// Por eso localStorage y no sessionStorage: el viaje a Google puede tardar, la persona puede
// cerrar la pestaña y volver mañana, y el origen tiene que seguir ahí cuando por fin se registre.

const CLAVE_ORIGEN = 'fs_origen'
// Marca de "ya lo mandamos". Evita una petición por cada carga de página el resto de la vida
// de esa cuenta. No es un candado de correctitud —el backend nunca sobrescribe— sino de ruido.
const CLAVE_ENVIADO = 'fs_origen_enviado'

const MAX = 40

// MISMAS reglas y MISMO ORDEN que sanearOrigen en server.js.
//
// El orden no es un detalle: minúsculas ANTES de filtrar. Si se filtrara primero, un "?g=NFL13"
// escrito en mayúsculas —que es como la gente copia y pega de un post— perdería todas las
// letras y quedaría en "13". Bajar primero y filtrar después lo deja en "nfl13".
export function sanearOrigen(valor) {
  if (typeof valor !== 'string') return null
  const limpio = valor
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, '')
    .slice(0, MAX)
  return limpio.length > 0 ? limpio : null
}

/**
 * Captura ?g= de la URL. Se llama en CADA carga, antes de renderizar.
 *
 * GANA EL PRIMER CONTACTO: si ya hay algo guardado, no se pisa. Alguien que llegó por el grupo
 * de NFL y semanas después abre un link del grupo de MLB sigue contando como NFL, que es de
 * donde de verdad salió. La misma regla vive en el WHERE del UPDATE del backend, así que se
 * cumple aunque este código falle.
 *
 * Si el parámetro no viene, no hace nada. Si viene pero queda vacío tras limpiarlo, tampoco.
 */
export function capturarOrigenDeUrl() {
  try {
    const crudo = new URL(window.location.href).searchParams.get('g')
    if (crudo === null) return          // sin ?g= no hay nada que hacer
    if (localStorage.getItem(CLAVE_ORIGEN)) return  // ya hay uno: gana el primero

    const limpio = sanearOrigen(crudo)
    if (!limpio) return                 // quedó vacío tras limpiar: no se guarda basura

    localStorage.setItem(CLAVE_ORIGEN, limpio)
  } catch {
    // Modo privado sin storage, o una URL que el navegador no sabe parsear. Se pierde el
    // origen de esa visita y ya: esto NUNCA puede impedir que la app cargue.
  }
}

/**
 * Manda el origen guardado al backend. Solo tiene sentido con sesión ya iniciada, porque hasta
 * ese momento no hay cuenta a la cual pegárselo.
 *
 * Se marca como enviado solo si el backend respondió bien. Si falla la red, se reintenta en la
 * siguiente carga — el dato sigue en localStorage.
 */
export async function enviarOrigenSiHace() {
  try {
    if (!isLoggedIn()) return
    if (localStorage.getItem(CLAVE_ENVIADO) === '1') return

    const origen = localStorage.getItem(CLAVE_ORIGEN)
    if (!origen) return

    const res = await apiFetch('/api/origen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origen }),
    })
    const data = await res.json()
    if (data?.ok) localStorage.setItem(CLAVE_ENVIADO, '1')
  } catch {
    // Sin storage o sin red: se reintenta en la siguiente carga. Nunca rompe la pantalla.
  }
}
