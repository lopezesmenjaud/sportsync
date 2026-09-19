// Página PÚBLICA de partido, renderizada en el servidor.
//
// Por qué existe: AdSense rechazó el sitio por "contenido de bajo valor". La causa está
// confirmada — el frontend es un SPA de Vite sin renderizado en servidor, así que TODA ruta
// devuelve el mismo index.html cuyo body entero es <div id="root"></div>. El robot de Google
// recibe una página en blanco sin importar la dirección. Esta ruta entrega HTML ya armado.
//
// NO sustituye a /match/:id del frontend: esa la usan los enlaces dentro de los eventos de
// Google Calendar y no se puede romper. Son dos páginas distintas sobre el mismo dato.
//
// Este módulo NO llama a initializeDatabase(). Requerir ../db/database abre la conexión (el
// `new Database(dbPath)` corre al importarse) pero no crea ni migra nada.
const { matchRepository } = require("../repositories/matchRepositorySqlite");
const { db } = require("../db/database");

const SITIO = process.env.SITE_URL || "https://fanschedule.com";
const ZONA = "America/Mexico_City";

// Competencias que SÍ se indexan, por competitionKey de TheSportsDB.
//
// Va por clave y no por nombre a propósito: el proveedor guarda los nombres con prefijo de país
// ("Spanish La Liga", "Mexican Primera League"), así que buscar "Liga MX" por texto no encuentra
// nada, y buscar "la liga" por subcadena se comería también "Spanish La Liga 2". La clave es
// exacta y estable. Las claves salen de la lista de ligas del frontend (LeaguePicker.jsx) y del
// mapeo de src/db/database.js.
const COMPETENCIAS_INDEXABLES = new Map([
  ["4350", "Liga MX"],
  ["4346", "NFL"],
  ["4480", "Champions League"],
  ["4335", "La Liga"],
  ["4328", "Premier League"],
  ["4443", "Fórmula 1"],
  ["4424", "MLB"],
]);

function esIndexable(competitionKey) {
  return COMPETENCIAS_INDEXABLES.has(String(competitionKey || ""));
}

// Escapa lo que va DENTRO de texto o de un atributo con comillas dobles. Todo valor que venga de
// la base pasa por aquí: los nombres los manda un proveedor externo, no son nuestros.
function esc(valor) {
  if (valor === null || valor === undefined) return "";
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// JSON-LD va dentro de <script>, donde el escape de HTML NO aplica: el navegador busca la cadena
// "</script" en crudo. Escapar "<" como < es lo que impide cortar el bloque desde un dato.
function escJsonLd(objeto) {
  return JSON.stringify(objeto).replace(/</g, "\\u003c");
}

// "Atlético Madrid" -> "atletico-madrid". Minúsculas, sin acentos, y cualquier cosa que no sea
// letra o número se vuelve guion (no solo los espacios: los puntos de "CE Europa F.C." también).
function aSlug(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// El slug canónico sale de los nombres de los equipos. Para lo que no es equipo contra equipo
// (una carrera de F1, por ejemplo) no hay "vs": se usa el nombre del evento, y si tampoco está,
// el de la competencia.
function slugCanonico(match) {
  const local = aSlug(match.homeParticipantName);
  const visita = aSlug(match.awayParticipantName);
  if (local && visita) return `${local}-vs-${visita}`;
  return local || visita || aSlug(match.eventName) || aSlug(match.competitionName);
}

// Título legible, con la misma regla que el slug.
function titulo(match) {
  const local = (match.homeParticipantName || "").trim();
  const visita = (match.awayParticipantName || "").trim();
  if (local && visita) return `${local} vs ${visita}`;
  return (
    local ||
    visita ||
    (match.eventName || "").trim() ||
    (match.competitionName || "").trim() ||
    "Partido"
  );
}

// Instante real del partido. currentStartUtc manda (es el que refleja reprogramaciones) y
// scheduledStartUtc es el respaldo. Si faltan los dos devuelve null en vez de un Date en 1970:
// esta página prefiere no decir la hora a decir una falsa.
function instante(match) {
  const iso = match.currentStartUtc || match.scheduledStartUtc;
  if (!iso) return null;
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

function fechaEnTexto(fecha) {
  return fecha.toLocaleString("es-MX", {
    timeZone: ZONA,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

// Transmisión desde broadcasting_cache. SOLO lee lo que ya está guardado: el endpoint
// /api/broadcasting genera con Anthropic cuando no hay caché, y eso no puede pasar aquí — sería
// una llamada de pago por cada visita de un robot.
//
// Se prefiere la fila de México porque la página da la hora del centro de México; si no hay,
// se toma cualquier otra antes que no mostrar nada.
function transmisionGuardada(competitionKey) {
  return new Promise((resolve) => {
    db.get(
      `SELECT data, country FROM broadcasting_cache
        WHERE competitionKey = ?
        ORDER BY CASE WHEN country IN ('MX','Mexico','México') THEN 0 ELSE 1 END
        LIMIT 1`,
      [String(competitionKey || "")],
      (err, row) => {
        if (err || !row) return resolve(null);
        try {
          const data = JSON.parse(row.data);
          resolve({ ...data, country: row.country });
        } catch {
          resolve(null);
        }
      }
    );
  });
}

// Lista de canales -> <li>. Devuelve "" si no hay nada, para poder omitir el bloque entero.
function listaCanales(encabezado, valores) {
  const limpios = (Array.isArray(valores) ? valores : []).filter(Boolean);
  if (!limpios.length) return "";
  const items = limpios
    .map((c) => `          <li>${esc(typeof c === "string" ? c : c.name)}</li>`)
    .join("\n");
  return `
        <h3>${esc(encabezado)}</h3>
        <ul>
${items}
        </ul>`;
}

function seccionDondeVerlo(match, transmision) {
  const competencia = match.competitionName || "esta competencia";

  // La sección existe SIEMPRE, con dato o sin él. Hoy broadcasting_cache suele estar vacía
  // (initializeDatabase la borra en cada arranque del servidor), así que lo normal es caer al
  // texto genérico. Se deja como sección propia con su <h2> para que cuando llegue la tabla de
  // canales entre aquí adentro y no haya que rehacer la página.
  let cuerpo = "";
  if (transmision) {
    cuerpo += listaCanales("TV abierta", transmision.freeTV);
    cuerpo += listaCanales("TV de paga", transmision.paidTV);
    cuerpo += listaCanales("Streaming", transmision.streaming);
    if (transmision.note) cuerpo += `\n        <p>${esc(transmision.note)}</p>`;
  }

  if (!cuerpo) {
    cuerpo = `
        <p>Todavía no tenemos confirmados los canales para ${esc(competencia)}. La transmisión
        cambia según el país y a veces según la jornada.</p>`;
  }

  return `
      <section>
        <h2>Dónde verlo</h2>${cuerpo}
      </section>`;
}

function paginaNoEncontrada() {
  // Sin rastro del error ni de la consulta: es una página pública.
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Partido no encontrado | FanSchedule</title>
  </head>
  <body>
    <h1>Partido no encontrado</h1>
    <p>Puede que la dirección esté mal escrita o que el partido ya no esté disponible.</p>
    <p><a href="${SITIO}/">Ir a FanSchedule</a></p>
  </body>
</html>
`;
}

function paginaPartido(match, urlCanonica, transmision) {
  const nombre = titulo(match);
  const competencia = (match.competitionName || "").trim();
  const sede = (match.venueName || "").trim();
  const pais = (match.country || "").trim();
  const fecha = instante(match);

  const descripcion = [
    nombre,
    competencia ? `en ${competencia}` : "",
    fecha ? `· ${fechaEnTexto(fecha)} (hora del centro de México)` : "",
    sede ? `· ${sede}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: nombre,
    url: urlCanonica,
    ...(fecha ? { startDate: fecha.toISOString() } : {}),
    ...(competencia ? { superEvent: { "@type": "SportsEvent", name: competencia } } : {}),
    ...(sede
      ? { location: { "@type": "Place", name: sede, ...(pais ? { address: pais } : {}) } }
      : pais
        ? { location: { "@type": "Place", name: pais } }
        : {}),
    ...(match.homeParticipantName && match.awayParticipantName
      ? {
          competitor: [
            { "@type": "SportsTeam", name: match.homeParticipantName },
            { "@type": "SportsTeam", name: match.awayParticipantName },
          ],
        }
      : {}),
  };

  const tituloPagina = competencia ? `${nombre} — ${competencia}` : nombre;
  const noindex = esIndexable(match.competitionKey)
    ? ""
    : `\n    <meta name="robots" content="noindex" />`;

  const lineaCompetencia = competencia ? `      <p>${esc(competencia)}</p>\n` : "";
  const lineaFecha = fecha
    ? `      <p>
        <time datetime="${esc(fecha.toISOString())}">${esc(fechaEnTexto(fecha))}</time>
        (hora del centro de México)
      </p>\n`
    : `      <p>Fecha y hora por confirmar.</p>\n`;
  const lineaSede = sede ? `      <p>${esc(sede)}${pais ? `, ${esc(pais)}` : ""}</p>\n` : "";

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(tituloPagina)} | FanSchedule</title>
    <meta name="description" content="${esc(descripcion)}" />
    <link rel="canonical" href="${esc(urlCanonica)}" />${noindex}

    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="FanSchedule" />
    <meta property="og:title" content="${esc(tituloPagina)}" />
    <meta property="og:description" content="${esc(descripcion)}" />
    <meta property="og:url" content="${esc(urlCanonica)}" />
    <meta property="og:image" content="${SITIO}/og-image.png" />
    <meta property="og:locale" content="es_MX" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(tituloPagina)}" />
    <meta name="twitter:description" content="${esc(descripcion)}" />
    <meta name="twitter:image" content="${SITIO}/og-image.png" />

    <script type="application/ld+json">${escJsonLd(jsonLd)}</script>
  </head>
  <body>
    <main>
      <h1>${esc(nombre)}</h1>
${lineaCompetencia}${lineaFecha}${lineaSede}${seccionDondeVerlo(match, transmision)}
    </main>
  </body>
</html>
`;
}

async function partidoPublicoHandler(req, res) {
  try {
    const { id } = req.params;
    const match = await matchRepository.getByProviderMatchId(id);

    if (!match) {
      res.status(404);
      res.set("Content-Type", "text/html; charset=utf-8");
      return res.send(paginaNoEncontrada());
    }

    // El slug es decorativo, pero solo debe existir UNA dirección por partido: si no, Google ve
    // la misma página en infinitas URLs. Cualquier slug que no sea el canónico se manda al bueno.
    const canonico = slugCanonico(match);
    const recibido = req.params.slug || "";

    // Si el canónico sale vacío (un partido sin nombres) no hay a dónde redirigir: se sirve tal
    // cual. Sin este guard, /partido/:id redirigiría a /partido/:id/ en un bucle.
    if (canonico && recibido !== canonico) {
      return res.redirect(301, `/partido/${encodeURIComponent(id)}/${canonico}`);
    }

    const urlCanonica = canonico
      ? `${SITIO}/partido/${encodeURIComponent(id)}/${canonico}`
      : `${SITIO}/partido/${encodeURIComponent(id)}`;

    const transmision = await transmisionGuardada(match.competitionKey);

    res.set("Cache-Control", "public, max-age=300, s-maxage=900, stale-while-revalidate=3600");
    res.set("Content-Type", "text/html; charset=utf-8");
    return res.send(paginaPartido(match, urlCanonica, transmision));
  } catch (error) {
    // El detalle va al log del servidor, nunca a la respuesta.
    console.error("[partido-publico] Error:", error.message);
    res.status(500);
    res.set("Content-Type", "text/html; charset=utf-8");
    return res.send(paginaNoEncontrada());
  }
}

module.exports = { partidoPublicoHandler, aSlug, slugCanonico, esIndexable, esc };
