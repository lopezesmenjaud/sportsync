// Último paso del build. Si algo de esto falla, el build TRUENA y Vercel deja vivo el deploy
// anterior. Es a propósito: un build sin dist/app.html, o con la portada metida en app.html,
// tiraría /match/:id (el enlace de cada evento en Google Calendar) y el dashboard completo, y
// eso es mucho peor que un deploy que no sale.
//
// Lo que comprueba:
//   - dist/app.html existe, con la raíz VACÍA, sin canonical ni og:url, sin portada y sin el
//     script que redirige con sesión;
//   - dist/index.html trae la portada (data-pagina="portada"), el enlace a /equipos, su canonical,
//     su og:url y el script que redirige con sesión;
//   - los dos cargan el MISMO bundle de la app, y ese archivo existe;
//   - quitando la portada, el canonical, el og:url y el script, index.html y app.html son idénticos: nada
//     más se separó entre los dos;
//   - la regla final de vercel.json manda a /app.html.
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(raiz, 'dist')
const fallas = []
const exigir = (condicion, mensaje) => { if (!condicion) fallas.push(mensaje) }
const veces = (texto, buscado) => texto.split(buscado).length - 1

const rutaApp = join(dist, 'app.html')
const rutaPortada = join(dist, 'index.html')

if (!existsSync(rutaApp)) fallas.push('NO EXISTE dist/app.html: /match/:id y el dashboard se quedarían sin página.')
if (!existsSync(rutaPortada)) fallas.push('NO EXISTE dist/index.html.')

if (fallas.length === 0) {
  const app = readFileSync(rutaApp, 'utf8')
  const portada = readFileSync(rutaPortada, 'utf8')

  exigir(veces(app, '<div id="root"></div>') === 1, 'dist/app.html no trae la raíz vacía <div id="root"></div>.')
  exigir(!app.includes('rel="canonical"'), 'dist/app.html trae canonical.')
  exigir(!app.includes('property="og:url"'), 'dist/app.html trae og:url.')
  exigir(!app.includes('data-pagina="portada"'), 'dist/app.html trae la portada.')
  exigir(!app.includes('redirigir-con-sesion'), 'dist/app.html trae el script que redirige con sesión.')

  exigir(veces(portada, 'data-pagina="portada"') === 1, 'dist/index.html no trae la portada (data-pagina="portada").')
  exigir(portada.includes('href="/equipos"'), 'dist/index.html no trae el enlace a /equipos.')
  exigir(veces(portada, 'rel="canonical"') === 1, 'dist/index.html no trae su canonical.')
  exigir(veces(portada, 'property="og:url"') === 1, 'dist/index.html no trae su og:url.')
  exigir(veces(portada, '<script id="redirigir-con-sesion">') === 1, 'dist/index.html no trae el script que redirige con sesión.')

  const bundle = (html) => [...html.matchAll(/<script type="module"[^>]*src="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1])
  const delApp = bundle(app)
  const deLaPortada = bundle(portada)
  exigir(delApp.length === 1, `dist/app.html carga ${delApp.length} bundles de la app; se esperaba 1.`)
  exigir(delApp.join() === deLaPortada.join(), 'dist/index.html y dist/app.html no cargan el mismo bundle.')
  for (const src of delApp) exigir(existsSync(join(dist, src)), `el bundle ${src} no existe en dist/.`)

  // Lo que queda de la portada sin sus tres diferencias tiene que ser la cáscara, letra por letra.
  const inicio = portada.indexOf('<div id="root">') + '<div id="root">'.length
  const fin = portada.lastIndexOf('</div>')
  const sinPortada = (portada.slice(0, inicio) + portada.slice(fin))
    .replace(/\r?\n[ \t]*<script id="redirigir-con-sesion">[^<]*<\/script>/, '')
    .replace(/[ \t]*<link rel="canonical"[^>]*>\r?\n?/, '')
    .replace(/[ \t]*<meta property="og:url"[^>]*>\r?\n?/, '')
  exigir(sinPortada === app, 'dist/index.html y dist/app.html difieren en algo más que la portada, el canonical, el og:url y el script.')
}

try {
  const { rewrites = [] } = JSON.parse(readFileSync(join(raiz, 'vercel.json'), 'utf8'))
  const ultima = rewrites[rewrites.length - 1] || {}
  exigir(ultima.source === '/(.*)' && ultima.destination === '/app.html',
    `la regla final de vercel.json manda a "${ultima.destination}" y no a "/app.html": todas las rutas de la app recibirían la portada.`)
} catch (err) {
  fallas.push(`no se pudo leer vercel.json: ${err.message}`)
}

if (fallas.length > 0) {
  console.error('\n[verificar-build] EL BUILD NO SIRVE. No se despliega:')
  for (const f of fallas) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('[verificar-build] ok: portada en dist/index.html, cáscara vacía en dist/app.html, vercel.json apunta a /app.html')
