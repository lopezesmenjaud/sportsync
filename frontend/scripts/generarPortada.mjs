// Corre DESPUÉS de los dos `vite build` (ver "build" en package.json). Hace dos archivos a partir
// de la cáscara que deja Vite en dist/index.html:
//
//   dist/app.html   la cáscara de siempre, vacía, para TODAS las rutas de la app (/match/:id,
//                   /dashboard...). vercel.json manda ahí su regla final. Va SIN canonical y SIN
//                   og:url: los dos dicen "esta página es https://fanschedule.com/", y en
//                   /match/123 eso es falso. Sin ellos, Google y Facebook usan la URL real.
//
//   dist/index.html la portada YA PINTADA (LandingPage sin datos) más un script en el <head>
//                   que manda a /dashboard a quien ya tiene sesión, antes de pintar nada. Vercel
//                   sirve este archivo en "/" por estar en el disco, sin pasar por las reglas.
//
// No verifica el resultado: eso lo hace scripts/verificarBuild.mjs, que corre después y es lo
// que hace tronar el build si algo quedó mal.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(raiz, 'dist')
const { render, STORAGE_KEY } = await import(pathToFileURL(join(raiz, 'dist-ssr', 'portadaSSR.js')).href)

const RAIZ_VACIA = '<div id="root"></div>'
const CANONICAL = /[ \t]*<link rel="canonical"[^>]*>\r?\n?/g
const OG_URL = /[ \t]*<meta property="og:url"[^>]*>\r?\n?/g
const CHARSET = '<meta charset="UTF-8" />'

function unaVez(texto, buscado, que) {
  const veces = typeof buscado === 'string' ? texto.split(buscado).length - 1 : (texto.match(buscado) || []).length
  if (veces !== 1) {
    console.error(`[portada] la cáscara de dist/index.html trae ${veces} veces ${que}; se esperaba 1. No se escribió nada.`)
    process.exit(1)
  }
}

const cascara = readFileSync(join(dist, 'index.html'), 'utf8')
unaVez(cascara, RAIZ_VACIA, RAIZ_VACIA)
unaVez(cascara, CANONICAL, 'el <link rel="canonical">')
unaVez(cascara, OG_URL, 'el <meta property="og:url">')
unaVez(cascara, CHARSET, CHARSET)

// La misma condición que isLoggedIn() en src/auth.js: el JSON guardado tiene userId. La sesión
// VENCIDA no llega aquí con la llave puesta: api.js (manejarSesionInvalida) la borra con
// clearUser() antes de mandar a "/", así que no hay vuelta entre "/" y /dashboard.
// Se conservan ?query y #hash: los lee el arranque de la app (?g= de campaña, ?seguir=).
// Se oculta la página DESPUÉS de pedir la navegación, para que no se asome la portada mientras
// llega el dashboard; si location.replace lanzara, la página sigue visible.
// Red: si la navegación no ocurre (la cancelan, el navegador la ignora), a los 1500 ms la
// visibilidad se restaura sola y aparece la portada, en vez de una pantalla en blanco. Si el
// redirect sí pasa, esta página ya no existe para entonces y no se nota.
//
// POR QUÉ SIGUEN AQUÍ la ocultación y la red, aunque en Chrome no hagan nada:
//   - En Chrome está MEDIDO (24 oct 2026, Chrome 155 sin pantalla, por CDP) que al llamar
//     location.replace el navegador deja de leer la página: el <body> nunca llega a existir y
//     "/" nunca se pinta. Ahí la ocultación y la red no cambian nada, ni para bien ni para mal.
//   - En WebKit (Safari, TODOS los navegadores de iPhone y la PWA instalada en iPhone) y en Gecko
//     (Firefox) NO se midió. Si alguno sigue leyendo la página hasta que llega /dashboard, la
//     ocultación evita que se asome la portada y la red la muestra si el redirect se cuelga.
//   - Se conservan porque el costo es cero y el beneficio en el caso no medido es real.
// Antes de quitarlas hay que MEDIR en Safari (de preferencia en un iPhone, con la PWA): sin esa
// medición, quitarlas es apostar con la puerta principal del sitio.
const redirigir =
  `<script id="redirigir-con-sesion">try{var u=JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)}));` +
  `if(u&&u.userId){location.replace("/dashboard"+location.search+location.hash);` +
  `var d=document.documentElement;d.style.visibility="hidden";` +
  `setTimeout(function(){d.style.visibility=""},1500)}}catch(e){}</script>`

const app = cascara.replace(CANONICAL, '').replace(OG_URL, '')
// Con función y no con string: un "$&" o "$'" dentro del HTML se tomaría como patrón de reemplazo.
const portada = cascara
  .replace(CHARSET, () => `${CHARSET}\n    ${redirigir}`)
  .replace(RAIZ_VACIA, () => `<div id="root">${render()}</div>`)

writeFileSync(join(dist, 'app.html'), app)
writeFileSync(join(dist, 'index.html'), portada)
console.log('[portada] escritos dist/index.html (portada) y dist/app.html (cáscara de la app)')
