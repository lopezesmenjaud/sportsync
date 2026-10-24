// src/routes/portada.js
//
// GET /api/portada/partidos: los partidos REALES que muestra la portada (fanschedule.com/) en sus
// tarjetas y en la cinta. Antes eran seis textos escritos a mano con "Hoy", "En vivo" y un
// "Verstappen vs Hamilton" que ponía a dos personas reales en un duelo que podía no existir.
//
// Solo lectura y solo datos públicos (nombres de equipos, de competencias y la hora): sin sesión.
// Lo pide el NAVEGADOR, nunca el build: el HTML que se genera al compilar no lleva partidos, así
// que nada de esta respuesta puede quedarse congelado en una página vieja.
//
// Qué entra, y todo sale de reglas que ya existen en partidoPublico.js:
//   - solo competencias de competencias.json (no las de selecciones): las mismas que se indexan,
//     así que cada tarjeta enlaza a una página /partido/ que existe y entra a Google. El catálogo
//     no tiene tenis, así que nunca sale un duelo entre dos personas, y en F1 el nombre es el del
//     Gran Premio (resolverF1), no el de los pilotos;
//   - solo lo que seIndexaPartido acepta: que no haya empezado (por la HORA, no por `status`) y
//     que no sea una práctica libre de F1;
//   - dentro de los próximos DIAS_DE_VENTANA días.
//
// Tarjetas: el PRIMER partido de cada competencia, recorriendo PRIORIDAD en orden, hasta juntar
// TARJETAS. Una por competencia para que no salgan cuatro de la misma liga una noche de NBA.
// Cinta: los siguientes partidos en orden de hora, sin repetir los de las tarjetas.

const { db } = require("../db/database");
const COMPETENCIAS = require("../data/competencias.json");
const { vistaDelPartido, instante, seIndexaPartido } = require("./partidoPublico");

// Orden en que se llenan las tarjetas. Decidido por Julio con las 97 suscripciones reales (24 oct
// 2026): personas distintas por competencia, juntando suscripciones a equipos y a liga. Una
// competencia sin partidos en la ventana se salta y entra la siguiente.
// El tenis NO está: sus partidos traen la clave del circuito (4464 ATP / 4517 WTA), que no es del
// catálogo, y seIndexaPartido los deja fuera (sus páginas /partido/ llevan noindex). Meterlo pide
// tocar ese filtro, y es un cambio aparte.
const PRIORIDAD = [
  "4480", // Champions League (11 personas)
  "4391", // NFL (11)
  "4335", // La Liga (10)
  "4370", // Fórmula 1 (9)
  "4350", // Liga MX (7)
  "4424", // MLB (4)
  "4387", // NBA (3)
  "4328", // Premier League (2)
  "4332", // Serie A (1)
  "4334", // Ligue 1 (1)
  "4331", // Bundesliga (1)
  "4337", // Eredivisie (0)
  "4344", // Primeira Liga (0)
];

const TARJETAS = 4;
const EN_LA_CINTA = 10;
const DIAS_DE_VENTANA = 14;

// Cuántas filas se leen como máximo. Catorce días de trece competencias son unos cientos; el tope
// solo está para que un dato raro no convierta esta petición en una lectura de la tabla entera.
const TOPE_DE_FILAS = 2000;

// Caché en memoria: la portada la abre cualquiera y la respuesta es la misma para todos. Cinco
// minutos no cambian nada para la persona: el navegador además descarta lo que ya empezó.
const TTL_MS = 5 * 60 * 1000;
let enCache = null; // { hasta, cuerpo }

const CLAVES = COMPETENCIAS.competencias.map((c) => String(c.clave));

// Toda clave del catálogo tiene que estar en PRIORIDAD y al revés. Si alguien agrega una
// competencia a competencias.json y no aquí, sus partidos igual salen en la cinta, pero nunca en
// una tarjeta: se avisa al arrancar para que no pase en silencio.
{
  const faltan = CLAVES.filter((c) => !PRIORIDAD.includes(c));
  const sobran = PRIORIDAD.filter((c) => !CLAVES.includes(c));
  if (faltan.length || sobran.length) {
    console.warn(
      `[portada] PRIORIDAD no coincide con competencias.json. Faltan: ${faltan.join(", ") || "ninguna"}. ` +
        `Sobran: ${sobran.join(", ") || "ninguna"}.`
    );
  }
}

function leerProximos(desde, hasta) {
  const marcas = CLAVES.map(() => "?").join(",");
  return new Promise((resolve) => {
    db.all(
      `SELECT data FROM matches
        WHERE competitionKey IN (${marcas})
          AND COALESCE(currentStartUtc, scheduledStartUtc) > ?
          AND COALESCE(currentStartUtc, scheduledStartUtc) <= ?
        ORDER BY COALESCE(currentStartUtc, scheduledStartUtc) ASC
        LIMIT ?`,
      [...CLAVES, desde, hasta, TOPE_DE_FILAS],
      (err, filas) => {
        if (err || !filas) {
          if (err) console.error("[portada] no se pudieron leer los partidos:", err.message);
          return resolve([]);
        }
        const partidos = [];
        for (const f of filas) {
          try {
            partidos.push(JSON.parse(f.data));
          } catch {
            /* una fila corrupta no puede tumbar la portada */
          }
        }
        resolve(partidos);
      }
    );
  });
}

// Lo que viaja al navegador por partido. Nada de ningún usuario.
function aTarjeta(match, vista, fecha) {
  const id = encodeURIComponent(match.providerMatchId);
  return {
    id: String(match.providerMatchId),
    url: vista.slug ? `/partido/${id}/${vista.slug}` : `/partido/${id}`,
    competencia: vista.competencia,
    nombre: vista.nombre,
    inicioUtc: fecha.toISOString(),
  };
}

// `ahora` es inyectable para poder probar contra una base que no es de hoy.
async function partidosDePortada(ahora = Date.now()) {
  const desde = new Date(ahora).toISOString();
  const hasta = new Date(ahora + DIAS_DE_VENTANA * 24 * 60 * 60 * 1000).toISOString();
  const filas = await leerProximos(desde, hasta);

  const candidatos = [];
  for (const match of filas) {
    if (!match.providerMatchId) continue;
    const fecha = instante(match);
    if (!fecha) continue;
    const vista = vistaDelPartido(match);
    if (!seIndexaPartido(match, vista, fecha, ahora)) continue;
    candidatos.push({ clave: String(match.competitionKey), tarjeta: aTarjeta(match, vista, fecha) });
  }

  // Ya vienen en orden de hora, así que el primero de cada clave es su partido más próximo.
  const primeroPorClave = new Map();
  for (const c of candidatos) {
    if (!primeroPorClave.has(c.clave)) primeroPorClave.set(c.clave, c.tarjeta);
  }
  const tarjetas = PRIORIDAD.filter((clave) => primeroPorClave.has(clave))
    .slice(0, TARJETAS)
    .map((clave) => primeroPorClave.get(clave));

  const enTarjetas = new Set(tarjetas.map((t) => t.id));
  const cinta = candidatos
    .map((c) => c.tarjeta)
    .filter((t) => !enTarjetas.has(t.id))
    .slice(0, EN_LA_CINTA);

  return { tarjetas, cinta };
}

async function portadaPartidosHandler(req, res) {
  // Datos públicos y sin credenciales: se dejan leer desde cualquier origen. Sin esto los
  // previews de Vercel (otro dominio) no podrían pedirlos y no habría forma de probarlos antes
  // de producción. Va solo en esta ruta: el CORS del resto de la API no cambia.
  res.set("Access-Control-Allow-Origin", "*");
  try {
    const ahora = Date.now();
    if (!enCache || enCache.hasta <= ahora) {
      enCache = { hasta: ahora + TTL_MS, cuerpo: { ok: true, ...(await partidosDePortada(ahora)) } };
    }
    res.set("Cache-Control", "public, max-age=300");
    return res.json(enCache.cuerpo);
  } catch (error) {
    console.error("[portada] Error:", error.message);
    // La portada sin partidos sigue siendo la portada: el navegador omite la sección.
    return res.status(500).json({ ok: false, tarjetas: [], cinta: [] });
  }
}

module.exports = { portadaPartidosHandler, partidosDePortada, PRIORIDAD };
