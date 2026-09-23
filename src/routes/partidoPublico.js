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

// Catálogo ÚNICO de competencias. Decide DOS cosas y las dos salen solo de aquí: qué se indexa
// (estar en el archivo = se indexa) y cómo se llama la competencia de cara al público. Lo que no
// esté no se indexa y se muestra con el nombre que traiga la base.
const COMPETENCIAS = require("../data/competencias.json");

// Índice por clave. Se va por CLAVE y no por nombre porque la clave es lo único estable: el
// proveedor renombra ligas —4350 aparece hoy como "Mexican Liga MX" y en la base está guardada
// como "Mexican Primera League"— y un índice por texto se rompería en silencio con cada cambio.
const COMPETENCIAS_POR_CLAVE = new Map(COMPETENCIAS.competencias.map((c) => [c.clave, c]));

// Liga MX es la única competencia con tabla de equipos propia, así que su clave se nombra aquí.
const CLAVE_LIGA_MX = "4350";

// Tabla de Liga MX armada a mano: los apodos con los que la gente busca y, sobre todo, el canal
// por equipo LOCAL. Eso último no lo vende ninguna API — la caché de transmisión está guardada
// por competencia, así que sin esta tabla un partido de Chivas mostraba las doce opciones de
// toda la liga. Se carga UNA vez, al cargar el módulo: es un archivo estático y no tiene por qué
// leerse en cada petición.
const LIGA_MX = require("../data/ligaMx.json");

// Índice por el nombre EXACTO de la columna homeParticipantName. Sin normalizar, sin quitar
// acentos y sin minúsculas: la gracia es que si el proveedor renombra un equipo el índice falle
// y lo avise (ver el console.warn de vistaDelPartido), en vez de acertar por casualidad.
const LIGA_MX_POR_BASE = new Map(LIGA_MX.equipos.map((e) => [e.base, e]));

const SITIO = process.env.SITE_URL || "https://fanschedule.com";
const ZONA = "America/Mexico_City";

// Paleta de la marca. Va aquí y no repartida por el CSS para poder cambiarla en un solo sitio.
const NARANJA = "#F5820A";
const AZUL = "#1C2430";
const GRIS = "#6B7280";
const FONDO = "#FFFFFF";

// Estar en el catálogo es lo que hace que una competencia se indexe. No hay segunda lista.
function esIndexable(competitionKey) {
  return COMPETENCIAS_POR_CLAVE.has(String(competitionKey || ""));
}

// Cómo se llama la competencia en público. Del catálogo si está; si no, lo que traiga la base,
// que es el comportamiento de siempre para todo lo que no se indexa.
function nombreDeCompetencia(match) {
  const entrada = COMPETENCIAS_POR_CLAVE.get(String(match.competitionKey || ""));
  return entrada ? entrada.nombrePublico : (match.competitionName || "").trim();
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

// Cómo se PRESENTA el partido, ya resuelto: nombres, slug, competencia y dónde verlo.
//
// Es el único lugar donde se decide si el partido es de Liga MX y, por tanto, si se usan los
// apodos de la tabla en vez de los nombres del proveedor. Todo lo visible —h1, title,
// description, Open Graph, Twitter, JSON-LD y el slug canónico— sale de aquí, para que no haya
// forma de que un sitio diga "CD Guadalajara" y otro "Chivas".
//
// Para cualquier competencia que no sea Liga MX devuelve exactamente lo de siempre.
function vistaDelPartido(match) {
  // Por CLAVE y no por el nombre del proveedor: ese nombre cambia (la misma liga aparece como
  // "Mexican Primera League" en la base y como "Mexican Liga MX" en la API del proveedor hoy),
  // y si cambiara dejaríamos de reconocer Liga MX sin que nadie se entere.
  const ligaMx = String(match.competitionKey || "") === CLAVE_LIGA_MX;

  const entradaLocal = ligaMx ? LIGA_MX_POR_BASE.get(match.homeParticipantName) || null : null;
  const entradaVisita = ligaMx ? LIGA_MX_POR_BASE.get(match.awayParticipantName) || null : null;

  // Si el proveedor renombra un equipo, la tabla deja de casar y la página se degrada en
  // silencio. Este aviso es la alarma, y sale con el nombre EXACTO que llegó para poder
  // copiarlo tal cual al JSON.
  if (ligaMx && match.homeParticipantName && !entradaLocal) {
    console.warn(
      `[partido-publico] Liga MX: no hay entrada en ligaMx.json para el equipo LOCAL "${match.homeParticipantName}"`
    );
  }
  if (ligaMx && match.awayParticipantName && !entradaVisita) {
    console.warn(
      `[partido-publico] Liga MX: no hay entrada en ligaMx.json para el equipo VISITANTE "${match.awayParticipantName}"`
    );
  }

  const nombreLocal = entradaLocal ? entradaLocal.apodo : (match.homeParticipantName || "").trim();
  const nombreVisita = entradaVisita
    ? entradaVisita.apodo
    : (match.awayParticipantName || "").trim();

  // ¿Hay dos participantes enfrentados? Una carrera de F1 no los tiene, y de eso depende que la
  // página diga "a qué hora JUEGAN" o "a qué hora ES".
  const esVersus = Boolean(nombreLocal && nombreVisita);

  // Para lo que no es equipo contra equipo se cae al nombre del evento y, en último caso, al de
  // la competencia.
  const nombre = esVersus
    ? `${nombreLocal} vs ${nombreVisita}`
    : nombreLocal ||
      nombreVisita ||
      (match.eventName || "").trim() ||
      (match.competitionName || "").trim() ||
      "Partido";

  const slugLocal = entradaLocal ? entradaLocal.slug : aSlug(match.homeParticipantName);
  const slugVisita = entradaVisita ? entradaVisita.slug : aSlug(match.awayParticipantName);
  const slug =
    slugLocal && slugVisita
      ? `${slugLocal}-vs-${slugVisita}`
      : slugLocal || slugVisita || aSlug(match.eventName) || aSlug(match.competitionName);

  const competencia = nombreDeCompetencia(match);

  return {
    ligaMx,
    esVersus,
    nombre,
    nombreLocal,
    nombreVisita,
    slug,
    competencia,
    // Clave de atribución del botón de registro. Sale de la competencia ya en su forma pública,
    // así que un partido de Liga MX manda "seo-liga-mx" y no "seo-mexican-primera-league".
    origen: `seo-${aSlug(competencia)}`.replace(/-$/, ""),
    // Solo se llena cuando el equipo LOCAL está en la tabla. Es lo que decide si "Dónde verlo"
    // muestra el canal de este partido o cae a la caché por competencia.
    dondeVerLocal: entradaLocal ? entradaLocal.dondeVer : null,
  };
}

// El slug canónico de un partido. Envoltorio de vistaDelPartido para quien solo quiere el slug.
function slugCanonico(match) {
  return vistaDelPartido(match).slug;
}

// Cuánto dura un partido para efectos de esta página. No es la duración real —varía por
// deporte y con alargues no hay número fijo— sino la ventana durante la cual se dice "está en
// curso" en vez de "ya se jugó". Tres horas cubre de sobra un partido de fútbol con descuento.
const VENTANA_EN_CURSO_MS = 3 * 60 * 60 * 1000;

const MOMENTO = {
  FUTURO: "futuro",
  EN_CURSO: "en-curso",
  YA_PASO: "ya-paso",
};

// En qué momento está el partido respecto de AHORA.
//
// Se calcula con la hora y no con la columna `status` a propósito. `status` solo se refresca
// cuando corre el sync —cada 12 h para fútbol, basket y NFL— así que un partido que terminó
// puede seguir diciendo "scheduled" media jornada. La hora de inicio, en cambio, es exacta.
//
// Sin fecha se trata como futuro: si no sabemos cuándo es, no podemos afirmar que ya pasó.
function momentoDelPartido(fecha, ahora = Date.now()) {
  if (!fecha) return MOMENTO.FUTURO;
  const inicio = fecha.getTime();
  if (ahora < inicio) return MOMENTO.FUTURO;
  if (ahora < inicio + VENTANA_EN_CURSO_MS) return MOMENTO.EN_CURSO;
  return MOMENTO.YA_PASO;
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

// ─────────────────────────────────────────────────────────────────────────────
// Presentación
// ─────────────────────────────────────────────────────────────────────────────

// Todo el CSS va EN LÍNEA. Esta ruta la sirve Express, que no tiene pipeline de estáticos: una
// hoja externa sería otra petición —y otro viaje a Render— justo para el robot que queremos que
// vea la página rápido. Por lo mismo, la tipografía es la del sistema y no se carga ninguna
// fuente remota.
//
// Móvil primero: los tamaños base son los de un teléfono y la única consulta de medios sube el
// h1 en pantallas grandes. Nada tiene ancho fijo, así que a 360px no hay barrido lateral.
const ESTILOS = `
    :root {
      --naranja: ${NARANJA};
      --azul: ${AZUL};
      --gris: ${GRIS};
      --fondo: ${FONDO};
      --borde: #E5E7EB;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--fondo);
      color: var(--azul);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
        "Helvetica Neue", Arial, sans-serif;
      font-size: 16px;
      line-height: 1.5;
      -webkit-text-size-adjust: 100%;
    }
    /* Que un nombre largo parta de línea en vez de ensanchar la página. */
    h1, h2, p, li { overflow-wrap: break-word; }

    .barra {
      border-bottom: 1px solid var(--borde);
      padding: 14px 0;
    }
    /* Mismo ancho y mismo margen lateral que .contenido: así el logotipo queda a plomo con la
       columna en pantallas grandes, en vez de pegado a la orilla izquierda. */
    .barra-interior {
      max-width: 680px;
      margin: 0 auto;
      padding: 0 16px;
    }
    .logo {
      display: inline-block;
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.02em;
      text-decoration: none;
    }
    .logo-fan { color: var(--naranja); }
    .logo-schedule { color: var(--azul); }

    .contenido {
      max-width: 680px;
      margin: 0 auto;
      padding: 24px 16px 8px;
    }
    h1 {
      margin: 0 0 12px;
      font-size: 26px;
      line-height: 1.25;
      letter-spacing: -0.02em;
    }
    /* El aviso de partido en curso o ya jugado. Va en el naranja de la marca y en negrita: es lo
       primero que tiene que registrar quien llegó de una búsqueda a un partido de la semana
       pasada. En gris se perdería entre los datos. */
    .aviso {
      margin: 0 0 14px;
      color: var(--naranja);
      font-weight: 600;
      font-size: 15px;
    }

    .datos { margin: 0 0 24px; }
    .dato {
      margin: 0 0 4px;
      color: var(--gris);
      font-size: 15px;
    }
    .dato time { color: var(--gris); }

    .tarjeta {
      border: 1px solid var(--borde);
      border-radius: 12px;
      padding: 18px 20px;
      margin: 0 0 20px;
    }
    .tarjeta h2 {
      margin: 0 0 10px;
      font-size: 17px;
      font-weight: 600;
    }
    .tarjeta h3 {
      margin: 14px 0 6px;
      font-size: 14px;
      font-weight: 600;
      color: var(--gris);
    }
    .tarjeta p { margin: 0 0 8px; }
    .tarjeta p:last-child { margin-bottom: 0; }
    .tarjeta ul { margin: 0; padding-left: 20px; }

    /* El cuadro de registro NO debe leerse como un anuncio: lleva el naranja de la marca en el
       borde y en el botón, el mismo tipo de letra que el resto y ningún gris de banner. */
    .registro {
      border: 2px solid var(--naranja);
      border-radius: 12px;
      background: #FFF8F0;
      padding: 20px;
      margin: 0 0 28px;
    }
    .registro h2 {
      margin: 0 0 8px;
      font-size: 19px;
      line-height: 1.3;
      color: var(--azul);
    }
    .registro p {
      margin: 0 0 16px;
      color: var(--azul);
      font-size: 15px;
    }
    .boton {
      display: inline-block;
      background: var(--naranja);
      color: #FFFFFF;
      text-decoration: none;
      font-size: 16px;
      font-weight: 600;
      padding: 12px 22px;
      border-radius: 10px;
    }

    .pie {
      max-width: 680px;
      margin: 0 auto;
      padding: 20px 16px 32px;
      border-top: 1px solid var(--borde);
      color: var(--gris);
      font-size: 14px;
    }
    .pie-enlaces {
      margin: 0 0 8px;
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
    }
    .pie a { color: var(--gris); text-decoration: none; }
    .pie a:hover, .pie a:focus { text-decoration: underline; }
    .pie p { margin: 0; }

    @media (min-width: 600px) {
      h1 { font-size: 32px; }
      .contenido { padding-top: 32px; }
    }
`;

function barra() {
  return `    <header class="barra">
      <div class="barra-interior">
        <a class="logo" href="/"><span class="logo-fan">Fan</span><span class="logo-schedule">Schedule</span></a>
      </div>
    </header>`;
}

function pie() {
  return `    <footer class="pie">
      <nav class="pie-enlaces">
        <a href="/">Inicio</a>
        <a href="/privacy">Privacidad</a>
        <a href="/terms">Términos</a>
      </nav>
      <p>FanSchedule — los partidos de tus equipos, en tu Google Calendar.</p>
    </footer>`;
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

function seccionDondeVerlo(vista, transmision, momento) {
  // Un partido que ya se jugó no se "ve", se transmitió. El que está en curso sí se puede ver
  // todavía, así que ahí el encabezado no cambia.
  const encabezado = momento === MOMENTO.YA_PASO ? "Dónde se transmitió" : "Dónde verlo";

  // Camino bueno: partido de Liga MX con el equipo local en la tabla. Se muestra SOLO su canal y
  // no se toca la caché por competencia — era la que listaba las doce opciones de toda la liga en
  // cada partido. Tampoco entra la nota de esa caché: la escribió un modelo, nadie la verificó, y
  // en una página pública eso es afirmar cosas sin respaldo.
  if (vista.dondeVerLocal) {
    return `      <section class="tarjeta">
        <h2>${encabezado}</h2>
        <p>${esc(vista.dondeVerLocal)}</p>
      </section>`;
  }

  // Cualquier otra competencia, y Liga MX cuando el local no está en la tabla: como siempre.
  // Hoy broadcasting_cache suele estar vacía —initializeDatabase la borra en cada arranque del
  // servidor— así que lo normal es caer al texto genérico.
  let cuerpo = "";
  if (transmision) {
    cuerpo += listaCanales("TV abierta", transmision.freeTV);
    cuerpo += listaCanales("TV de paga", transmision.paidTV);
    cuerpo += listaCanales("Streaming", transmision.streaming);
    if (transmision.note) cuerpo += `\n        <p>${esc(transmision.note)}</p>`;
  }

  if (!cuerpo) {
    // El texto de relleno se redacta en pasado cuando el partido ya se jugó: bajo el encabezado
    // "Dónde se transmitió", decir "todavía no tenemos confirmados los canales" no significa nada.
    cuerpo =
      momento === MOMENTO.YA_PASO
        ? `
        <p>No tenemos registro de los canales que transmitieron este partido de ${esc(
          vista.competencia || "esta competencia"
        )}.</p>`
        : `
        <p>Todavía no tenemos confirmados los canales para ${esc(
          vista.competencia || "esta competencia"
        )}. La transmisión cambia según el país y a veces según la jornada.</p>`;
  }

  return `      <section class="tarjeta">
        <h2>${encabezado}</h2>${cuerpo}
      </section>`;
}

// Va SIEMPRE después de "Dónde verlo": el horario y el canal son las dos cosas que la persona
// vino a buscar, y ponerse en medio de la segunda es quitarle la página a quien la está leyendo.
//
// Un solo estado por ahora, el de visitante sin sesión. Esta ruta no lee sesión (ni la tiene:
// se sirve cacheada por el CDN), así que no puede saber si quien mira ya es usuario.
function cuadroDeRegistro(vista) {
  return `      <section class="registro">
        <h2>No te vuelvas a quedar con la duda</h2>
        <p>FanSchedule pone los partidos de tus equipos en tu Google Calendar.
        Te avisa solo, aunque cambien de horario.</p>
        <a class="boton" href="/?g=${esc(vista.origen)}">Conectar mi calendario</a>
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
    <style>${ESTILOS}    </style>
  </head>
  <body>
${barra()}
    <main class="contenido">
      <h1>Partido no encontrado</h1>
      <p class="dato">Puede que la dirección esté mal escrita o que el partido ya no esté disponible.</p>
      <p><a class="boton" href="/">Ir a FanSchedule</a></p>
    </main>
${pie()}
  </body>
</html>
`;
}

function paginaPartido(match, vista, urlCanonica, transmision) {
  const sede = (match.venueName || "").trim();
  const pais = (match.country || "").trim();
  const fecha = instante(match);
  const competencia = vista.competencia;

  const momento = momentoDelPartido(fecha);

  // "juegan" solo cuando hay dos participantes enfrentados. Un Gran Premio no lo juega nadie.
  const verbo = vista.esVersus ? "a qué hora juegan" : "a qué hora es";

  // Qué se promete en el buscador. Preguntar "a qué hora juegan" de algo que terminó hace cuatro
  // días es lo que hace que la página parezca abandonada, así que en cuanto empieza el partido la
  // frase deja de hablar en futuro.
  const nucleo =
    momento === MOMENTO.YA_PASO
      ? "ya se jugó"
      : momento === MOMENTO.EN_CURSO
        ? "está en curso"
        : `${verbo} y dónde verlo`;

  // La frase que encabeza title y description. Se escribe una sola vez para que las dos digan
  // exactamente lo mismo: el buscador las enseña juntas y una discrepancia se nota.
  const frase = competencia
    ? `${vista.nombre}: ${nucleo} — ${competencia}`
    : `${vista.nombre}: ${nucleo}`;

  const descripcion = [
    `${frase}.`,
    fecha ? `${fechaEnTexto(fecha)} (hora del centro de México).` : "",
    sede ? `${sede}${pais ? `, ${pais}` : ""}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: vista.nombre,
    url: urlCanonica,
    ...(fecha ? { startDate: fecha.toISOString() } : {}),
    ...(competencia ? { superEvent: { "@type": "SportsEvent", name: competencia } } : {}),
    ...(sede
      ? { location: { "@type": "Place", name: sede, ...(pais ? { address: pais } : {}) } }
      : pais
        ? { location: { "@type": "Place", name: pais } }
        : {}),
    // Los competidores también llevan el apodo, no el nombre del proveedor: el JSON-LD debe
    // decir lo mismo que la página o Google lo marca como inconsistente.
    ...(vista.esVersus
      ? {
          competitor: [
            { "@type": "SportsTeam", name: vista.nombreLocal },
            { "@type": "SportsTeam", name: vista.nombreVisita },
          ],
        }
      : {}),
  };

  const tituloPagina = `${frase} | FanSchedule`;

  // Un partido que ya empezó NUNCA se indexa, esté o no su competencia en la lista blanca. No
  // tenemos marcador, así que como página de resultado no sirve, y cientos de ellas indexadas
  // pesan más que el tráfico que traen.
  const noindex =
    momento !== MOMENTO.FUTURO || !esIndexable(match.competitionKey)
      ? `\n    <meta name="robots" content="noindex" />`
      : "";

  const lineaAviso =
    momento === MOMENTO.YA_PASO
      ? `      <p class="aviso">Este partido ya se jugó.</p>\n`
      : momento === MOMENTO.EN_CURSO
        ? `      <p class="aviso">Este partido está en curso.</p>\n`
        : "";

  const lineaCompetencia = competencia ? `        <p class="dato">${esc(competencia)}</p>\n` : "";
  const lineaFecha = fecha
    ? `        <p class="dato"><time datetime="${esc(fecha.toISOString())}">${esc(
        fechaEnTexto(fecha)
      )}</time> (hora del centro de México)</p>\n`
    : `        <p class="dato">Fecha y hora por confirmar.</p>\n`;
  const lineaSede = sede
    ? `        <p class="dato">${esc(sede)}${pais ? `, ${esc(pais)}` : ""}</p>\n`
    : "";

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(tituloPagina)}</title>
    <meta name="description" content="${esc(descripcion)}" />
    <link rel="canonical" href="${esc(urlCanonica)}" />${noindex}

    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="FanSchedule" />
    <meta property="og:title" content="${esc(frase)}" />
    <meta property="og:description" content="${esc(descripcion)}" />
    <meta property="og:url" content="${esc(urlCanonica)}" />
    <meta property="og:image" content="${SITIO}/og-image.png" />
    <meta property="og:locale" content="es_MX" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(frase)}" />
    <meta name="twitter:description" content="${esc(descripcion)}" />
    <meta name="twitter:image" content="${SITIO}/og-image.png" />

    <script type="application/ld+json">${escJsonLd(jsonLd)}</script>
    <style>${ESTILOS}    </style>
  </head>
  <body>
${barra()}
    <main class="contenido">
      <h1>${esc(vista.nombre)}</h1>
${lineaAviso}      <div class="datos">
${lineaCompetencia}${lineaFecha}${lineaSede}      </div>
${seccionDondeVerlo(vista, transmision, momento)}
${cuadroDeRegistro(vista)}
    </main>
${pie()}
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

    // Se calcula UNA vez por petición: si se llamara dos veces, el aviso de equipo sin entrada en
    // la tabla saldría duplicado en el log.
    const vista = vistaDelPartido(match);

    // El slug es decorativo, pero solo debe existir UNA dirección por partido: si no, Google ve
    // la misma página en infinitas URLs. Cualquier slug que no sea el canónico se manda al bueno.
    // Esto es también lo que reencamina las direcciones viejas al cambiar un apodo de la tabla:
    // /america-vs-cd-guadalajara -> /america-vs-chivas.
    const canonico = vista.slug;
    const recibido = req.params.slug || "";

    // Si el canónico sale vacío (un partido sin nombres) no hay a dónde redirigir: se sirve tal
    // cual. Sin este guard, /partido/:id redirigiría a /partido/:id/ en un bucle.
    //
    // La ruta del Location es RELATIVA a propósito. La página se sirve a través de una
    // reescritura de Vercel desde fanschedule.com, y un Location absoluto hacia el dominio de
    // Render sacaría al visitante del sitio. Express 5 deja el encabezado tal cual se le pasa.
    if (canonico && recibido !== canonico) {
      return res.redirect(301, `/partido/${encodeURIComponent(id)}/${canonico}`);
    }

    const urlCanonica = canonico
      ? `${SITIO}/partido/${encodeURIComponent(id)}/${canonico}`
      : `${SITIO}/partido/${encodeURIComponent(id)}`;

    const transmision = await transmisionGuardada(match.competitionKey);

    res.set("Cache-Control", "public, max-age=300, s-maxage=900, stale-while-revalidate=3600");
    res.set("Content-Type", "text/html; charset=utf-8");
    return res.send(paginaPartido(match, vista, urlCanonica, transmision));
  } catch (error) {
    // El detalle va al log del servidor, nunca a la respuesta.
    console.error("[partido-publico] Error:", error.message);
    res.status(500);
    res.set("Content-Type", "text/html; charset=utf-8");
    return res.send(paginaNoEncontrada());
  }
}

module.exports = {
  partidoPublicoHandler,
  aSlug,
  slugCanonico,
  vistaDelPartido,
  momentoDelPartido,
  MOMENTO,
  esIndexable,
  esc,
};
