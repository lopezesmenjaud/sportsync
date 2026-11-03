// src/routes/formula1.js
//
// /formula-1: la página pública de la Fórmula 1. Existe porque la F1 era invisible en el sitio:
// /equipos se arma con EQUIPOS, y un Gran Premio no tiene local ni visitante, así que la F1 nunca
// generaba ninguno. Las páginas /partido/ de cada sesión existían, pero sueltas: nada las juntaba.
//
// Qué lista, y por qué:
//   - Un renglón por GRAN PREMIO, con la carrera y, debajo, la clasificación (y el sprint y su
//     clasificación cuando los hay). Las prácticas NO: sus páginas llevan noindex, y no mandamos
//     gente a páginas que le pedimos a Google que ignore.
//   - Una sesión se ENLAZA solo si seIndexaPartido la acepta (la misma regla del sitemap y del
//     noindex de /partido/). Lo que ya se corrió sale sin enlace: su página dice "ya se jugó".
//   - Los nombres salen de resolverF1, la misma función que usa /partido/. Un evento que la tabla
//     no reconoce NO sale aquí (no sabemos agruparlo ni nombrarlo): se avisa en el log.
//   - Sin resultados ni posiciones: el sync no vuelve a pasar por una sesión ya corrida, así que
//     no los tenemos y no se prometen.
//   - Sin "dónde verla": la única fuente para F1 es la caché de transmisión, que escribió un
//     modelo y nadie verificó. /partido/ tampoco la muestra por lo mismo.
//
// Qué temporada: la del año (en el centro de México) de la siguiente sesión publicable; si no
// queda ninguna, la de la última que hubo. Así en diciembre y en enero la página sigue mostrando
// la temporada que acaba de pasar, en vez de quedar vacía.
//
// La página dice con precisión qué tiene: "las carreras que tenemos registradas", no "el
// calendario completo", y nunca "la temporada terminó". Medido en producción el 2 nov 2026 (90
// sesiones de F1): la base EMPIEZA el 22 may 2026 (faltan Australia, China, Japón, Bahréin,
// Arabia, Miami y Emilia-Romaña) y TERMINA el 29 nov en Catar (falta Abu Dabi, que sí está en
// f1.json). Llamarlo calendario de la temporada sería prometer de más. Si algún día se rellena la
// temporada completa, esta redacción sigue siendo cierta.
//
// Este módulo NO llama a initializeDatabase(): solo lee la tabla matches.

const { db } = require("../db/database");
const F1 = require("../data/f1.json");
const {
  ESTILOS,
  barra,
  pie,
  esc,
  SITIO,
  resolverF1,
  vistaDelPartido,
  instante,
  fechaEnTexto,
  seIndexaPartido,
  momentoDelPartido,
  MOMENTO,
  cuadroDeRegistro,
  SCRIPT_CUADRO,
  paginaNoEncontrada,
} = require("./partidoPublico");

const RUTA = "/formula-1";
const ZONA = "America/Mexico_City";

// Las sesiones que van en la página. La carrera es la que no tiene sufijo (sesion: null).
const SESIONES_QUE_VAN = new Set([null, "clasificacion", "sprint", "clasificacion-sprint"]);

// Cómo se ordenan dentro de su Gran Premio: en el orden en que se corren.
const ORDEN_DE_SESION = { "clasificacion-sprint": 0, sprint: 1, clasificacion: 2 };

const ESTILOS_F1 = `
    .intro { margin: 0 0 12px; }
    .gp-lista { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
    .gp {
      border: 1px solid var(--borde);
      border-radius: 10px;
      padding: 12px 14px;
    }
    .gp h3 { margin: 0 0 4px; font-size: 17px; line-height: 1.3; }
    .gp h3 a { color: var(--azul); text-decoration: none; }
    .gp h3 a:hover, .gp h3 a:focus { color: var(--naranja); }
    .gp .dato { margin: 0; font-size: 14px; }
    .sesiones { list-style: none; margin: 6px 0 0; padding: 0; font-size: 14px; }
    .sesiones a { color: var(--naranja); text-decoration: none; }
    .sesiones a:hover, .sesiones a:focus { text-decoration: underline; }
    .corridas { list-style: none; margin: 0; padding: 0; font-size: 15px; }
    .corridas li { padding: 6px 0; border-bottom: 1px solid var(--borde); }
    .corridas li:last-child { border-bottom: none; }
`;

function leerSesionesF1() {
  return new Promise((resolve) => {
    db.all(
      `SELECT data FROM matches
        WHERE competitionKey = ?
        ORDER BY COALESCE(currentStartUtc, scheduledStartUtc) ASC`,
      [String(F1.clave)],
      (err, filas) => {
        if (err || !filas) {
          if (err) console.error("[formula-1] no se pudieron leer las sesiones:", err.message);
          return resolve([]);
        }
        const sesiones = [];
        for (const f of filas) {
          try {
            sesiones.push(JSON.parse(f.data));
          } catch {
            /* una fila corrupta no puede tumbar la página */
          }
        }
        resolve(sesiones);
      }
    );
  });
}

const anioEnMexico = (fecha) =>
  Number(new Intl.DateTimeFormat("en-US", { timeZone: ZONA, year: "numeric" }).format(fecha));

// Un aviso por nombre y por proceso, para no inundar el log cada vez que alguien abre la página.
const yaAvisados = new Set();

// Arma la temporada a partir de las filas de la base. `ahora` es inyectable para poder probar.
// Devuelve { temporada, proximos, corridos } con los Grandes Premios ya agrupados, o
// { temporada: null } si no hay ni una sesión de F1 que se pueda nombrar.
function armarTemporada(filas, ahora = Date.now()) {
  const sesiones = [];
  for (const match of filas) {
    const fecha = instante(match);
    if (!fecha) continue;
    const f1 = resolverF1(match.eventName);
    if (!f1) {
      const nombre = String(match.eventName || "");
      if (!yaAvisados.has(nombre)) {
        yaAvisados.add(nombre);
        console.warn(`[formula-1] evento sin entrada en f1.json, no se lista: "${nombre}"`);
      }
      continue;
    }
    if (!SESIONES_QUE_VAN.has(f1.sesion)) continue;
    sesiones.push({ match, fecha, f1 });
  }
  if (!sesiones.length) return { temporada: null, proximos: [], corridos: [] };

  // La temporada: la de la siguiente sesión que no ha terminado; si no hay, la de la última.
  const siguiente = sesiones.find((s) => momentoDelPartido(s.fecha, ahora) !== MOMENTO.YA_PASO);
  const temporada = anioEnMexico((siguiente || sesiones[sesiones.length - 1]).fecha);

  // Agrupar por Gran Premio dentro de la temporada. La clave es el slug del GP de la tabla, así
  // que "Sao Paulo" y "São Paulo" caen en el mismo renglón (los dos son gp-brasil).
  const porGp = new Map();
  for (const s of sesiones) {
    if (anioEnMexico(s.fecha) !== temporada) continue;
    if (!porGp.has(s.f1.gpSlug)) porGp.set(s.f1.gpSlug, { nombre: s.f1.gpNombre, carrera: null, otras: [] });
    const gp = porGp.get(s.f1.gpSlug);
    if (s.f1.sesion === null) gp.carrera = s;
    else gp.otras.push(s);
  }

  const proximos = [];
  const corridos = [];
  for (const gp of porGp.values()) {
    gp.otras.sort((a, b) => ORDEN_DE_SESION[a.f1.sesion] - ORDEN_DE_SESION[b.f1.sesion]);
    // La fecha que manda es la de la carrera; sin carrera registrada, la de su última sesión.
    const referencia = gp.carrera || gp.otras[gp.otras.length - 1];
    gp.fecha = referencia.fecha;
    // Un GP sigue en "próximos" mientras le quede alguna sesión por correr o en curso. Con
    // seIndexaPartido una carrera EN CURSO saldría como "ya se corrió" durante tres horas.
    const vigente = [gp.carrera, ...gp.otras].some(
      (s) => s && momentoDelPartido(s.fecha, ahora) !== MOMENTO.YA_PASO
    );
    (vigente ? proximos : corridos).push(gp);
  }
  proximos.sort((a, b) => a.fecha - b.fecha);
  corridos.sort((a, b) => a.fecha - b.fecha);
  return { temporada, proximos, corridos };
}

function urlDeSesion(s) {
  const vista = vistaDelPartido(s.match);
  const id = encodeURIComponent(s.match.providerMatchId);
  return vista.slug ? `/partido/${id}/${vista.slug}` : `/partido/${id}`;
}

// Enlace solo si su página se indexa (seIndexaPartido). Lo que está en curso o ya se corrió va
// como texto y lo dice.
function seEnlaza(s, ahora) {
  return seIndexaPartido(s.match, vistaDelPartido(s.match), s.fecha, ahora);
}
function estado(s, ahora) {
  const m = momentoDelPartido(s.fecha, ahora);
  return m === MOMENTO.EN_CURSO ? " (en curso)" : m === MOMENTO.YA_PASO ? " (ya se corrió)" : "";
}
const cuandoEs = (s) => `<time datetime="${esc(s.fecha.toISOString())}">${esc(fechaEnTexto(s.fecha))}</time>`;

function textoDeSesion(s, etiqueta, ahora) {
  const nombre = seEnlaza(s, ahora) ? `<a href="${esc(urlDeSesion(s))}">${esc(etiqueta)}</a>` : esc(etiqueta);
  return `${nombre}: ${cuandoEs(s)}${estado(s, ahora)}`;
}

const ETIQUETA = { clasificacion: "Clasificación", sprint: "Sprint", "clasificacion-sprint": "Clasificación del Sprint" };

// Las sesiones en el orden en que se corren, con la carrera al final. El nombre del Gran Premio
// enlaza a la página de la carrera mientras se publica.
function renglonProximo(gp, ahora) {
  const c = gp.carrera;
  const titulo = c && seEnlaza(c, ahora)
    ? `<a href="${esc(urlDeSesion(c))}">${esc(gp.nombre)}</a>`
    : esc(gp.nombre);
  const otras = gp.otras.map((s) => `            <li>${textoDeSesion(s, ETIQUETA[s.f1.sesion], ahora)}</li>`);
  const carrera = c
    ? `            <li>${textoDeSesion(c, "Carrera", ahora)}</li>`
    : `            <li>Carrera: todavía no tenemos registrada su hora.</li>`;
  return `        <li class="gp">
          <h3>${titulo}</h3>
          <ul class="sesiones">
${[...otras, carrera].join("\n")}
          </ul>
        </li>`;
}

const fechaSinHora = (fecha) =>
  fecha.toLocaleDateString("es-MX", { timeZone: ZONA, weekday: "long", day: "numeric", month: "long", year: "numeric" });

function paginaFormula1({ temporada, proximos, corridos }, ahora) {
  const hay = temporada !== null;
  const titulo = hay
    ? `Fórmula 1 ${temporada}: horarios de las carreras en hora de México`
    : "Fórmula 1: horarios de las carreras en hora de México";
  const descripcion = proximos.length
    ? `A qué hora son las próximas carreras y clasificaciones de Fórmula 1 de la temporada ${temporada}, en hora del centro de México. Siguiente: ${proximos[0].nombre}, ${fechaSinHora(proximos[0].fecha)}.`
    : `Horarios de la Fórmula 1 en hora del centro de México. Por ahora no tenemos próximas carreras registradas.`;
  const urlCanonica = `${SITIO}${RUTA}`;

  // Sin una sola sesión que nombrar, la página no aporta nada: fuera del índice. La MISMA
  // condición decide si entra al sitemap (formula1Publicable).
  const noindex = hay ? "" : `\n    <meta name="robots" content="noindex" />`;

  const ultimo = corridos[corridos.length - 1];
  const bloqueProximos = proximos.length
    ? `      <h2>Próximas carreras</h2>
      <ul class="gp-lista">
${proximos.map((gp) => renglonProximo(gp, ahora)).join("\n")}
      </ul>`
    : `      <section class="tarjeta">
        <p>No tenemos próximas carreras registradas.${
          ultimo
            ? ` La última que tenemos de la temporada ${temporada} es el ${esc(ultimo.nombre)}, del ${esc(fechaSinHora(ultimo.fecha))}.`
            : ""
        } En cuanto el calendario siguiente tenga fechas, aparecen aquí.</p>
      </section>`;

  const bloqueCorridos = corridos.length
    ? `
      <h2>Ya se corrieron, de las que tenemos registradas</h2>
      <ul class="corridas">
${corridos.map((gp) => `        <li>${esc(gp.nombre)} · ${esc(fechaSinHora(gp.fecha))}</li>`).join("\n")}
      </ul>`
    : "";

  const cuadro = cuadroDeRegistro({
    bases: [],
    sujetos: ["Fórmula 1"],
    claves: [String(F1.clave)],
    sustantivo: "carreras",
    seguir: `/dashboard/automovilismo/${F1.clave}`,
    origen: "seo-formula-1",
    contexto: null,
  });

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(titulo)} | FanSchedule</title>
    <meta name="description" content="${esc(descripcion)}" />
    <link rel="canonical" href="${esc(urlCanonica)}" />${noindex}

    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="FanSchedule" />
    <meta property="og:title" content="${esc(titulo)}" />
    <meta property="og:description" content="${esc(descripcion)}" />
    <meta property="og:url" content="${esc(urlCanonica)}" />
    <meta property="og:image" content="${SITIO}/og-image.png" />
    <meta property="og:locale" content="es_MX" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(titulo)}" />
    <meta name="twitter:description" content="${esc(descripcion)}" />
    <meta name="twitter:image" content="${SITIO}/og-image.png" />
    <style>${ESTILOS}${ESTILOS_F1}    </style>
  </head>
  <body>
${barra()}
    <main class="contenido">
      <h1>Fórmula 1${hay ? ` ${temporada}` : ""}</h1>
      <p class="intro">Aquí están las carreras de Fórmula 1${
        hay ? ` de la temporada ${temporada}` : ""
      } que tenemos registradas, con la hora del centro de México. De cada Gran Premio mostramos
      la carrera y la clasificación, y el sprint cuando hay. Cada sesión enlaza a su página, con
      la hora exacta y la opción de agregarla a tu calendario.</p>
      <p class="dato">Las fechas salen del calendario que publica nuestro proveedor de datos. Si
      una carrera todavía no aparece aquí, es que aún no la tenemos registrada.</p>
${bloqueProximos}${bloqueCorridos}
${cuadro}
    </main>
${pie()}
    <script>${SCRIPT_CUADRO}
    </script>
  </body>
</html>
`;
}

// ¿La página tiene algo que publicar? La usa el sitemap: es la misma condición que su noindex.
async function formula1Publicable(ahora = Date.now()) {
  return armarTemporada(await leerSesionesF1(), ahora).temporada !== null;
}

async function formula1Handler(req, res) {
  try {
    const ahora = Date.now();
    const temporada = armarTemporada(await leerSesionesF1(), ahora);
    res.set("Cache-Control", "public, max-age=300, s-maxage=900, stale-while-revalidate=3600");
    res.set("Content-Type", "text/html; charset=utf-8");
    return res.send(paginaFormula1(temporada, ahora));
  } catch (error) {
    console.error("[formula-1] Error:", error.message);
    res.status(500);
    res.set("Content-Type", "text/html; charset=utf-8");
    return res.send(paginaNoEncontrada());
  }
}

module.exports = { formula1Handler, formula1Publicable, armarTemporada, paginaFormula1, RUTA };
