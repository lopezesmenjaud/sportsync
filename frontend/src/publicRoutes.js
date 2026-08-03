// ÚNICA fuente de verdad de qué rutas son públicas.
//
// App.jsx GENERA sus <Route> recorriendo este arreglo: una página pública que no esté aquí
// sencillamente no existe. No es una lista que haya que acordarse de actualizar en paralelo —
// es de donde salen las rutas. Misma idea que apiFetch recibiendo ruta relativa: quitar la
// posibilidad de equivocarse en vez de confiar en la memoria.
//
// api.js la usa para decidir qué hacer ante un 401. En ruta pública NUNCA se redirige: se tira
// el token muerto y se reintenta como anónimo. Un token vencido no debe convertir una página
// pública en privada.
//
// Este módulo NO importa componentes a propósito. Si guardara los `element` tendría que importar
// MatchDetail, que importa api.js, que importa este módulo: un ciclo que según el orden de
// evaluación deja bindings en undefined. Solo strings.
export const PUBLIC_PATHS = [
  '/',                  // landing (o rebote al dashboard si hay sesión)
  '/privacy',
  '/terms',
  '/match/:matchId',    // se abre desde links compartidos y desde el evento de Google Calendar
]

// Convierte '/match/:matchId' en /^\/match\/[^/]+\/?$/. Los segmentos con ':' son comodines de
// UN solo tramo, igual que los interpreta react-router.
function toRegExp(path) {
  const pattern = path
    .split('/')
    .map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/')
  return new RegExp(`^${pattern}/?$`)
}

const PUBLIC_MATCHERS = PUBLIC_PATHS.map(toRegExp)

export function isPublicPath(pathname) {
  return PUBLIC_MATCHERS.some((re) => re.test(pathname))
}
