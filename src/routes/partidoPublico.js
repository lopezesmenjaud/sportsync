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

// Fórmula 1: el proveedor manda los eventos en inglés ("Azerbaijan Grand Prix Qualifying") y
// nadie en México busca así. Esta tabla los traduce.
const F1 = require("../data/f1.json");

// Los grandes premios, ORDENADOS DE MÁS LARGO A MÁS CORTO. El nombre del evento se reconoce por
// prefijo, así que el orden es lo que hace que gane el más específico: sin él,
// "Bahrain Grand Prix" podría comerse a "Bahrain in Malaysia Grand Prix".
const F1_GP_POR_LARGO = [...F1.granPremios].sort((a, b) => b.base.length - a.base.length);

const SITIO = process.env.SITE_URL || "https://fanschedule.com";
const ZONA = "America/Mexico_City";

// A dónde le pregunta el navegador por las suscripciones de quien mira. Tiene que ser la URL
// ABSOLUTA del backend: la página se ve en fanschedule.com gracias a una reescritura, así que una
// ruta relativa caería en el atrapatodo del SPA y devolvería el index.html en vez de JSON.
const API_PUBLICA = process.env.PUBLIC_API_URL || "https://sportsync-awqq.onrender.com";

// De lo que guarda matches.sport a la clave que usa la URL del dashboard. Las dos listas ya
// existen —normalizeSport en el proveedor y SPORT_MAP en server.js— pero nadie las cruzaba; esto
// es el puente. Un deporte que no esté aquí manda al dashboard a secas, que siempre funciona.
const DEPORTE_A_RUTA = {
  football: "futbol",
  basketball: "basketball",
  "american football": "futbol_americano",
  motorsport: "automovilismo",
  baseball: "baseball",
  tennis: "tenis",
  fighting: "combate",
  rugby: "rugby",
  "ice hockey": "hockey",
  volleyball: "voleibol",
  golf: "golf",
  cycling: "ciclismo",
};

// Lo más específico a lo que se puede enlazar dentro de la app: el picker de equipos de ESTA
// liga. No existe una ruta de "agregar este equipo" en un clic — hay que picarlo en la lista.
// TeamPicker aguanta que se llegue por enlace directo: saca la liga de los params y solo pierde
// el nombre bonito del encabezado, que cae a "Liga".
function urlParaSeguir(match) {
  const ruta = DEPORTE_A_RUTA[String(match.sport || "").trim().toLowerCase()];
  const clave = String(match.competitionKey || "").trim();
  return ruta && clave ? `/dashboard/${ruta}/${clave}` : "/dashboard";
}

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

// Traduce el nombre de un evento de Fórmula 1. Devuelve null si no lo reconoce, y entonces la
// página se queda EXACTAMENTE como hoy, en inglés: el día que llegue un gran premio nuevo que no
// esté en la tabla, la página sigue funcionando en vez de inventarse un nombre.
//
// Da { nombre, slug, indexar }:
//   "Azerbaijan Grand Prix"                   -> Gran Premio de Azerbaiyán              (carrera)
//   "Azerbaijan Grand Prix Qualifying"        -> Clasificación del Gran Premio de ...
//   "Azerbaijan Grand Prix Sprint Qualifying" -> Clasificación del Sprint del Gran Premio de ...
function resolverF1(eventName) {
  const texto = String(eventName || "").trim();
  if (!texto) return null;

  const gp = F1_GP_POR_LARGO.find((g) => texto.startsWith(g.base));
  if (!gp) return null;

  const resto = texto.slice(gp.base.length).trim();

  // Sin resto es la carrera misma.
  if (!resto) return { nombre: gp.nombre, slug: gp.slug, indexar: true };

  // EN EL ORDEN DEL ARCHIVO, que no es casual: "Sprint Qualifying" va antes que "Sprint" y que
  // "Qualifying". Al revés, una clasificación del sprint se anunciaría como un sprint a secas.
  const sesion = F1.sesiones.find((s) => resto.startsWith(s.sufijo));

  // Resto que no reconocemos: no se traduce a medias ni se adivina. Queda como hoy.
  if (!sesion) return null;

  return {
    nombre: `${sesion.nombre} del ${gp.nombre}`,
    slug: `${gp.slug}-${sesion.slug}`,
    indexar: sesion.indexar,
  };
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

  // Fórmula 1: si el evento se reconoce, el nombre y el slug salen traducidos de la tabla. Si no
  // —un gran premio nuevo, una sesión con otro nombre—, f1 es null y todo sigue el camino normal.
  const f1 = String(match.competitionKey || "") === F1.clave ? resolverF1(match.eventName) : null;

  // Para lo que no es equipo contra equipo se cae al nombre del evento y, en último caso, al de
  // la competencia.
  const nombre = f1
    ? f1.nombre
    : esVersus
      ? `${nombreLocal} vs ${nombreVisita}`
      : nombreLocal ||
        nombreVisita ||
        (match.eventName || "").trim() ||
        (match.competitionName || "").trim() ||
        "Partido";

  const slugLocal = entradaLocal ? entradaLocal.slug : aSlug(match.homeParticipantName);
  const slugVisita = entradaVisita ? entradaVisita.slug : aSlug(match.awayParticipantName);
  const slug = f1
    ? f1.slug
    : slugLocal && slugVisita
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
    // Las prácticas libres no las busca nadie y son casi cien páginas de relleno al año. Se
    // sirven igual —quien tenga el enlace la ve— pero no entran al índice.
    indexable: f1 ? f1.indexar : true,
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

// ¿Esta página de partido entra al índice de Google? ÚNICA fuente de esa regla: la usan tanto la
// etiqueta robots de la página como el sitemap. Si hubiera dos versiones y algún día divergieran,
// el sitemap estaría declarando direcciones que la propia página pide no indexar.
//
// Tres motivos independientes para quedarse fuera, y basta con uno:
//  - el partido ya empezó: sin marcador, como página de resultado no sirve;
//  - su competencia no está en el catálogo;
//  - es una sesión que no vale la pena indexar, como una práctica libre de F1.
function seIndexaPartido(match, vista, fecha, ahora = Date.now()) {
  return (
    momentoDelPartido(fecha, ahora) === MOMENTO.FUTURO &&
    esIndexable(match.competitionKey) &&
    vista.indexable
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

    /* Lista de próximos partidos de un equipo. Sin viñetas: cada renglón ya es un bloque con su
       propio borde, y el punto solo estorbaría. */
    .lista {
      list-style: none;
      margin: 0 0 24px;
      padding: 0;
    }
    .renglon {
      border: 1px solid var(--borde);
      border-radius: 12px;
      padding: 14px 16px;
      margin: 0 0 10px;
    }
    .renglon-titulo {
      display: inline-block;
      color: var(--azul);
      font-size: 17px;
      font-weight: 600;
      text-decoration: none;
      margin-bottom: 4px;
    }
    .renglon-titulo:hover, .renglon-titulo:focus { color: var(--naranja); }
    .renglon .dato { margin: 0; }

    /* Los equipos del h1 de un partido enlazan a su página, pero sin parecer un enlace suelto:
       heredan el tamaño y el color del encabezado y solo se subrayan al pasar encima. */
    h1 a {
      color: inherit;
      text-decoration: none;
      border-bottom: 2px solid rgba(245, 130, 10, 0.35);
    }
    h1 a:hover, h1 a:focus { border-bottom-color: var(--naranja); }

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
    /* Dos botones caben peor que uno, sobre todo a 360px. Se achican un punto y envuelven, para
       que el cuadro personalizado no crezca mucho más que el que reemplaza. */
    .botones {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .boton-chico {
      font-size: 15px;
      padding: 10px 18px;
    }
    /* Estado "ya lo sigue": aquí no se le pide nada, se le confirma que el producto funciona.
       Por eso un enlace y no un botón naranja grande. */
    .enlace-registro {
      display: inline-block;
      color: var(--naranja);
      font-weight: 600;
      font-size: 15px;
      text-decoration: none;
    }
    .enlace-registro:hover, .enlace-registro:focus { text-decoration: underline; }

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

// ─────────────────────────────────────────────────────────────────────────────
// Índice de equipos
// ─────────────────────────────────────────────────────────────────────────────

// Cuánto vive el índice en memoria. El catálogo de equipos crece con cada sincronización, pero
// no cada segundo: releerlo en cada petición sería un barrido de la tabla de partidos por visita.
const TTL_EQUIPOS_MS = 10 * 60 * 1000;

let cacheEquipos = null; // { porSlug: Map, generado: número }

const clavesDelCatalogo = () => [...COMPETENCIAS_POR_CLAVE.keys()];

// Cómo se llama y cómo se direcciona un equipo. Si está en la tabla hecha a mano manda ella —"CD
// Guadalajara" se publica como "Chivas" en /equipo/chivas—; si no, el nombre del proveedor.
//
// Se busca por NOMBRE y NO por competencia a propósito. Si dependiera de la clave, el día que un
// equipo mexicano jugara otro torneo del catálogo tendría dos direcciones —/equipo/chivas y
// /equipo/cd-guadalajara— con el mismo contenido, que para Google es contenido duplicado. Un
// equipo, una página, juegue donde juegue.
function identidadDeEquipo(nombreBase) {
  const entrada = LIGA_MX_POR_BASE.get(nombreBase);
  if (entrada) return { slug: entrada.slug, nombre: entrada.apodo };
  return { slug: aSlug(nombreBase), nombre: nombreBase };
}

// UNA consulta: los nombres distintos que aparecen como local O como visitante en las
// competencias del catálogo. El UNION de adentro es lo que evita tener que ir dos veces.
function leerEquipos() {
  const claves = clavesDelCatalogo();
  if (!claves.length) return Promise.resolve([]);
  const marcas = claves.map(() => "?").join(",");
  return new Promise((resolve) => {
    db.all(
      `SELECT DISTINCT competitionKey, nombre FROM (
         SELECT competitionKey, homeParticipantName AS nombre FROM matches
          WHERE competitionKey IN (${marcas})
            AND homeParticipantName IS NOT NULL AND TRIM(homeParticipantName) <> ''
         UNION
         SELECT competitionKey, awayParticipantName AS nombre FROM matches
          WHERE competitionKey IN (${marcas})
            AND awayParticipantName IS NOT NULL AND TRIM(awayParticipantName) <> ''
       )`,
      [...claves, ...claves],
      (err, filas) => {
        if (err) {
          console.error("[partido-publico] no se pudo leer el índice de equipos:", err.message);
          return resolve([]);
        }
        resolve(filas || []);
      }
    );
  });
}

// Índice slug -> { slug, base, nombre, claves }. Se rearma como mucho cada TTL_EQUIPOS_MS.
async function indiceEquipos() {
  const ahora = Date.now();
  if (cacheEquipos && ahora - cacheEquipos.generado < TTL_EQUIPOS_MS) return cacheEquipos.porSlug;

  const filas = await leerEquipos();
  const porSlug = new Map();

  for (const fila of filas) {
    const base = String(fila.nombre || "").trim();
    const clave = String(fila.competitionKey || "");
    if (!base) continue;

    const { slug, nombre } = identidadDeEquipo(base);
    if (!slug) continue;

    const ya = porSlug.get(slug);
    if (!ya) {
      porSlug.set(slug, { slug, base, nombre, claves: [clave] });
      continue;
    }
    // El mismo equipo jugando otra competencia: se acumula la clave y sigue siendo uno solo.
    if (ya.base === base) {
      if (!ya.claves.includes(clave)) ya.claves.push(clave);
      continue;
    }
    // Dos equipos DISTINTOS que producen el mismo slug. Gana el primero y se avisa, porque si no
    // uno de los dos deja de tener página y nadie se entera.
    console.warn(
      `[partido-publico] slug de equipo repetido "${slug}": se queda "${ya.base}" y se ignora "${base}"`
    );
  }

  cacheEquipos = { porSlug, generado: ahora };
  return porSlug;
}

// Los próximos partidos de un equipo, ya ordenados. `desde` es inyectable para poder probar
// contra datos que no son de hoy; en la ruta siempre es el instante actual.
function proximosDeEquipo(nombreBase, desde, limite = 10) {
  const claves = clavesDelCatalogo();
  if (!claves.length) return Promise.resolve([]);
  const marcas = claves.map(() => "?").join(",");
  return new Promise((resolve) => {
    db.all(
      `SELECT data FROM matches
        WHERE competitionKey IN (${marcas})
          AND (homeParticipantName = ? OR awayParticipantName = ?)
          AND COALESCE(currentStartUtc, scheduledStartUtc) > ?
        ORDER BY COALESCE(currentStartUtc, scheduledStartUtc) ASC
        LIMIT ?`,
      [...claves, nombreBase, nombreBase, desde, limite],
      (err, filas) => {
        if (err || !filas) return resolve([]);
        const partidos = [];
        for (const f of filas) {
          try {
            partidos.push(JSON.parse(f.data));
          } catch {
            /* una fila con JSON corrupto no puede tumbar la página entera */
          }
        }
        resolve(partidos);
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

// El MISMO cuadro para la página de partido y la de equipo. Lo único que cambia entre las dos es
// a quién se puede seguir desde ahí y con qué clave de atribución; los tres estados, el texto y
// el script son idénticos.
//
// En la página de partido va SIEMPRE después de "Dónde verlo": el horario y el canal son las dos
// cosas que la persona vino a buscar, y ponerse en medio de la segunda es quitarle la página a
// quien la está leyendo.
//
// El HTML que sale de aquí es SIEMPRE el de visitante sin sesión, idéntico para todo el mundo.
// No puede ser de otra manera: la respuesta se guarda 15 minutos en el CDN y se le entrega tal
// cual al siguiente que pida la página, así que decidir el estado en el servidor le enseñaría a
// un desconocido el cuadro de otra persona. Quién es quien mira se resuelve en SU navegador, con
// el script del final del body.
//
//   bases      nombres tal como los guarda la base, para comparar con las suscripciones
//   sujetos    los mismos nombres pero como se muestran (apodos)
//   claves     competencias que cuentan como "ya lo sigue" si está suscrito a la liga entera
//   sustantivo "partidos" o "carreras", según qué se agenda
//   seguir     a dónde manda el botón dentro de la app
//   origen     la clave ?g= del botón de conectar, para distinguir qué página convierte más
//
// Los valores van como JSON dentro de atributos data-, no interpolados en el <script>: un nombre
// con comillas o con "</script>" no puede romperlo. Todo es información pública, nada del usuario.
function cuadroDeRegistro({ bases, sujetos, claves, sustantivo, seguir, origen }) {
  return `      <section class="registro" id="fs-cuadro"
        data-api="${esc(API_PUBLICA)}"
        data-bases="${esc(JSON.stringify(bases))}"
        data-sujetos="${esc(JSON.stringify(sujetos))}"
        data-claves="${esc(JSON.stringify(claves))}"
        data-sustantivo="${esc(sustantivo)}"
        data-seguir="${esc(seguir)}">
        <h2>No te vuelvas a quedar con la duda</h2>
        <p>FanSchedule pone los partidos de tus equipos en tu Google Calendar.
        Te avisa solo, aunque cambien de horario.</p>
        <a class="boton" href="/?g=${esc(origen)}">Conectar mi calendario</a>
      </section>`;
}

// El cuadro de una página de PARTIDO: se puede seguir a cualquiera de los dos equipos, o a la
// competencia cuando no hay dos participantes (una carrera).
function cuadroDePartido(vista, match) {
  const bases = vista.esVersus
    ? [match.homeParticipantName, match.awayParticipantName]
    : [];
  const sujetos = vista.esVersus ? [vista.nombreLocal, vista.nombreVisita] : [vista.competencia];
  return cuadroDeRegistro({
    bases,
    sujetos,
    claves: [String(match.competitionKey || "")],
    sustantivo: vista.esVersus ? "partidos" : "carreras",
    seguir: urlParaSeguir(match),
    origen: vista.origen,
  });
}

// Script que personaliza el cuadro en el navegador de cada quien.
//
// Reglas que cumple, todas deliberadas:
//  - No bloquea el pintado: es lo último del <body> y no toca nada hasta que ya hay página.
//  - Ante CUALQUIER duda se queda callado. Sin sesión, sin token, petición que falla, que tarda
//    más de 2 s o que devuelve algo raro: el cuadro se queda exactamente como llegó del
//    servidor. Nunca hay un estado a medias ni un hueco en blanco.
//  - No manda la identidad a ningún lado nuevo: la única petición va al backend de FanSchedule,
//    que ya conoce a esa persona. El token sale del mismo localStorage que usa la app.
//  - No recorre lo que se está leyendo: el cuadro es lo último antes del pie, así que un cambio
//    de alto solo mueve el pie.
const SCRIPT_CUADRO = `
    (function () {
      var caja = document.getElementById("fs-cuadro");
      if (!caja) return;

      // La app guarda la sesión en estas dos llaves de localStorage (frontend/src/auth.js).
      // Modo privado o storage bloqueado: se sale sin tocar nada.
      var usuario, token;
      try {
        usuario = JSON.parse(localStorage.getItem("fanschedule_user") || "null");
        token = localStorage.getItem("fanschedule_token");
      } catch (e) { return; }
      if (!usuario || !usuario.userId || !token) return;

      var d = caja.dataset;

      // Los datos del cuadro. Si vinieran rotos, mejor no tocar nada.
      var bases, sujetos, claves;
      try {
        bases = JSON.parse(d.bases || "[]");
        sujetos = JSON.parse(d.sujetos || "[]");
        claves = JSON.parse(d.claves || "[]");
      } catch (e) { return; }
      if (!sujetos.length) return;

      var corta = new AbortController();
      var reloj = setTimeout(function () { corta.abort(); }, 2000);

      fetch(d.api + "/subscriptions/" + encodeURIComponent(usuario.userId), {
        headers: { Authorization: "Bearer " + token },
        signal: corta.signal
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          clearTimeout(reloj);
          if (!data || !data.ok || !Array.isArray(data.subscriptions)) return;

          var sigue = data.subscriptions.some(function (s) {
            // A uno de los equipos — se compara con el nombre que guarda la base, que es el que
            // eligió del picker, no con el apodo que muestra la página.
            if (s.teamName && bases.indexOf(s.teamName) !== -1) return true;
            // O a la competencia completa: sin equipo y con una de las claves que aplican aquí.
            return !s.teamName && claves.indexOf(String(s.competitionKey || "")) !== -1;
          });

          pintar(sigue);
        })
        .catch(function () { clearTimeout(reloj); });

      function pintar(sigue) {
        // A PROPÓSITO no se fija una altura mínima. El cuadro es el último elemento antes del
        // pie, así que si encoge lo único que sube es el pie y nada de lo que la persona está
        // leyendo se mueve; en cambio una altura clavada deja un hueco blanco a la vista.
        var h = document.createElement("h2");
        var p = document.createElement("p");

        if (sigue) {
          h.textContent = "Ya está en tu calendario";
          p.textContent = "Te va a avisar solo, y si cambian el horario se actualiza.";
          var ver = document.createElement("a");
          ver.className = "enlace-registro";
          ver.href = "/upcoming";
          ver.textContent = "Ver mis partidos";
          caja.replaceChildren(h, p, ver);
          return;
        }

        h.textContent = "Que se agenden solos";
        var fila = document.createElement("div");
        fila.className = "botones";

        // Uno o dos sujetos: los dos equipos de un partido, la competencia de una carrera, o el
        // equipo del que es la página.
        var quienes = sujetos.length > 1 ? sujetos[0] + " o a " + sujetos[1] : sujetos[0];
        p.textContent = "Sigue a " + quienes + " y sus " + d.sustantivo +
          " entran a tu calendario sin que hagas nada.";
        sujetos.forEach(function (nombre) { fila.appendChild(boton("Seguir a " + nombre)); });

        caja.replaceChildren(h, p, fila);
      }

      function boton(texto) {
        var a = document.createElement("a");
        a.className = "boton boton-chico";
        a.href = caja.dataset.seguir;
        a.textContent = texto;
        return a;
      }
    })();`;

// La misma página para las dos rutas, así que el texto no puede decir "partido": también sale
// cuando no existe el equipo. Sin rastro del error ni de la consulta: es una página pública.
function paginaNoEncontrada() {
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Página no encontrada | FanSchedule</title>
    <style>${ESTILOS}    </style>
  </head>
  <body>
${barra()}
    <main class="contenido">
      <h1>Página no encontrada</h1>
      <p class="dato">Puede que la dirección esté mal escrita, o que el partido o el equipo ya
      no estén disponibles.</p>
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

  // La MISMA regla que usa el sitemap para decidir si declara esta dirección.
  const noindex = seIndexaPartido(match, vista, fecha)
    ? ""
    : `\n    <meta name="robots" content="noindex" />`;

  const lineaAviso =
    momento === MOMENTO.YA_PASO
      ? `      <p class="aviso">Este partido ya se jugó.</p>\n`
      : momento === MOMENTO.EN_CURSO
        ? `      <p class="aviso">Este partido está en curso.</p>\n`
        : "";

  // Los dos equipos enlazan a su página. Es la otra mitad de la conexión del sitio: de un
  // partido se llega al equipo y de un equipo a sus partidos. En una carrera no hay a quién
  // enlazar, y el h1 se queda como estaba.
  const h1 = vista.esVersus
    ? `${enlaceEquipo(match.homeParticipantName, vista.nombreLocal)} vs ` +
      `${enlaceEquipo(match.awayParticipantName, vista.nombreVisita)}`
    : esc(vista.nombre);

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
      <h1>${h1}</h1>
${lineaAviso}      <div class="datos">
${lineaCompetencia}${lineaFecha}${lineaSede}      </div>
${seccionDondeVerlo(vista, transmision, momento)}
${cuadroDePartido(vista, match)}
    </main>
${pie()}
    <script>${SCRIPT_CUADRO}
    </script>
  </body>
</html>
`;
}

// Enlace al equipo dentro de un h1. Devuelve texto escapado a secas si el equipo no tiene slug.
function enlaceEquipo(nombreBase, nombreVisible) {
  const { slug } = identidadDeEquipo(String(nombreBase || "").trim());
  if (!slug) return esc(nombreVisible);
  return `<a href="/equipo/${esc(slug)}">${esc(nombreVisible)}</a>`;
}

// Un renglón de la lista de próximos partidos de un equipo.
function renglonDePartido(match, nombreBaseDelEquipo) {
  const vista = vistaDelPartido(match);
  const fecha = instante(match);
  const esLocal = match.homeParticipantName === nombreBaseDelEquipo;

  // Contra quién juega: el otro, con su nombre público.
  const rival = esLocal ? vista.nombreVisita : vista.nombreLocal;
  const donde = esLocal ? "Local" : "Visitante";

  // El canal es el del equipo LOCAL del partido, no el del equipo de esta página.
  const canal = vista.dondeVerLocal ? ` · ${esc(vista.dondeVerLocal)}` : "";

  const url = `/partido/${encodeURIComponent(match.providerMatchId)}${
    vista.slug ? `/${vista.slug}` : ""
  }`;

  const cuando = fecha
    ? `<time datetime="${esc(fecha.toISOString())}">${esc(fechaEnTexto(fecha))}</time>`
    : "Fecha por confirmar";

  return `        <li class="renglon">
          <a class="renglon-titulo" href="${esc(url)}">${esc(
            rival ? (esLocal ? `vs ${rival}` : `en casa de ${rival}`) : vista.nombre
          )}</a>
          <p class="dato">${cuando} (hora del centro de México)</p>
          <p class="dato">${esc(donde)} · ${esc(vista.competencia)}${canal}</p>
        </li>`;
}

function paginaEquipo(equipo, partidos) {
  const hay = partidos.length > 0;

  const frase = `${equipo.nombre}: próximos partidos, a qué hora juegan y dónde verlos`;
  const descripcion = hay
    ? `${frase}. Los siguientes ${partidos.length} ${
        partidos.length === 1 ? "partido" : "partidos"
      } de ${equipo.nombre}, con horario del centro de México.`
    : `${frase}. Ahora mismo no hay partidos programados.`;

  const urlCanonica = `${SITIO}/equipo/${equipo.slug}`;

  // Un equipo sin partidos próximos no aporta nada a quien busca: fuera del índice. Es lo que
  // evita treinta páginas vacías el día que una liga termina su temporada.
  const noindex = hay ? "" : `\n    <meta name="robots" content="noindex" />`;

  const lista = hay
    ? `      <ul class="lista">
${partidos.map((m) => renglonDePartido(m, equipo.base)).join("\n")}
      </ul>`
    : `      <section class="tarjeta">
        <p>No hay partidos programados de ${esc(equipo.nombre)} por ahora. En cuanto se
        publique el calendario aparecen aquí.</p>
      </section>`;

  const cuadro = cuadroDeRegistro({
    bases: [equipo.base],
    sujetos: [equipo.nombre],
    claves: equipo.claves,
    sustantivo: "partidos",
    seguir: "/dashboard",
    // Clave propia para poder comparar después qué convierte más, si las páginas de equipo o
    // las de partido.
    origen: "seo-equipo",
  });

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(frase)} | FanSchedule</title>
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
    <style>${ESTILOS}    </style>
  </head>
  <body>
${barra()}
    <main class="contenido">
      <h1>${esc(equipo.nombre)}</h1>
      <p class="dato">${
        hay ? `Próximos ${partidos.length === 1 ? "partido" : "partidos"}` : "Sin partidos programados"
      }</p>
${lista}
${cuadro}
    </main>
${pie()}
    <script>${SCRIPT_CUADRO}
    </script>
  </body>
</html>
`;
}

async function equipoPublicoHandler(req, res) {
  try {
    const indice = await indiceEquipos();
    const equipo = indice.get(String(req.params.slug || "").toLowerCase());

    if (!equipo) {
      res.status(404);
      res.set("Content-Type", "text/html; charset=utf-8");
      return res.send(paginaNoEncontrada());
    }

    const partidos = await proximosDeEquipo(equipo.base, new Date().toISOString());

    res.set("Cache-Control", "public, max-age=300, s-maxage=900, stale-while-revalidate=3600");
    res.set("Content-Type", "text/html; charset=utf-8");
    return res.send(paginaEquipo(equipo, partidos));
  } catch (error) {
    console.error("[equipo-publico] Error:", error.message);
    res.status(500);
    res.set("Content-Type", "text/html; charset=utf-8");
    return res.send(paginaNoEncontrada());
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sitemap
// ─────────────────────────────────────────────────────────────────────────────

// Tope defensivo. Un sitemap admite 50 000 direcciones; si algún día nos acercamos, hay que
// partirlo en varios con un índice. Mientras tanto, mejor cortar y avisar que servir uno inválido.
const TOPE_SITEMAP = 40000;

// Escapado para XML. Son los mismos cinco de siempre, pero con `esc` no bastaba: aquí &quot; y
// &#39; no son opcionales dentro de un atributo, y sobre todo el resultado va a un parser de XML,
// que es menos indulgente que el de HTML.
function escXml(valor) {
  return String(valor === null || valor === undefined ? "" : valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// TODOS los partidos futuros de las competencias del catálogo. Sin límite por equipo: esto
// alimenta el sitemap, no una pantalla.
function partidosFuturos(desde, limite = TOPE_SITEMAP) {
  const claves = clavesDelCatalogo();
  if (!claves.length) return Promise.resolve([]);
  const marcas = claves.map(() => "?").join(",");
  return new Promise((resolve) => {
    db.all(
      `SELECT data FROM matches
        WHERE competitionKey IN (${marcas})
          AND COALESCE(currentStartUtc, scheduledStartUtc) > ?
        ORDER BY COALESCE(currentStartUtc, scheduledStartUtc) ASC
        LIMIT ?`,
      [...claves, desde, limite],
      (err, filas) => {
        if (err || !filas) {
          if (err) console.error("[sitemap] no se pudieron leer los partidos:", err.message);
          return resolve([]);
        }
        const partidos = [];
        for (const f of filas) {
          try {
            partidos.push(JSON.parse(f.data));
          } catch {
            /* una fila corrupta no puede tumbar el sitemap entero */
          }
        }
        resolve(partidos);
      }
    );
  });
}

// Arma la lista de direcciones. Se genera EN EL MOMENTO, nunca se escribe a disco: el día que
// entre el Gran Premio de México o una jornada nueva, su dirección aparece sola en la siguiente
// petición, sin que nadie se acuerde de actualizar una lista.
async function direccionesDelSitemap(ahora = Date.now()) {
  const desde = new Date(ahora).toISOString();
  const partidos = await partidosFuturos(desde);

  const urls = [`${SITIO}/`, `${SITIO}/privacy`, `${SITIO}/terms`];
  const fijas = urls.length;

  // Equipos: los que tienen al menos un partido futuro. Salen de estos mismos partidos, que es
  // justo la condición que hace que su página NO lleve noindex. Declarar un equipo sin partidos
  // sería mandar a Google a una puerta cerrada.
  const equipos = new Map();

  let partidosDeclarados = 0;
  for (const match of partidos) {
    const vista = vistaDelPartido(match);

    // Los equipos cuentan aunque el partido concreto no se indexe: la página del equipo sí
    // existe y sí tiene contenido. Una práctica de F1 no aporta equipos porque no los tiene.
    for (const base of [match.homeParticipantName, match.awayParticipantName]) {
      const limpio = String(base || "").trim();
      if (!limpio) continue;
      const { slug } = identidadDeEquipo(limpio);
      if (slug && !equipos.has(slug)) equipos.set(slug, limpio);
    }

    // La MISMA regla que decide el noindex de la página. No hay una segunda versión.
    if (!seIndexaPartido(match, vista, instante(match), ahora)) continue;

    const id = encodeURIComponent(match.providerMatchId);
    urls.push(vista.slug ? `${SITIO}/partido/${id}/${vista.slug}` : `${SITIO}/partido/${id}`);
    partidosDeclarados++;
  }

  for (const slug of [...equipos.keys()].sort()) urls.push(`${SITIO}/equipo/${slug}`);

  if (urls.length >= TOPE_SITEMAP) {
    console.warn(
      `[sitemap] se alcanzó el tope de ${TOPE_SITEMAP} direcciones: toca partirlo en varios archivos`
    );
  }

  return { urls, fijas, partidos: partidosDeclarados, equipos: equipos.size };
}

async function sitemapHandler(req, res) {
  try {
    const { urls } = await direccionesDelSitemap();
    const cuerpo = urls.map((u) => `  <url><loc>${escXml(u)}</loc></url>`).join("\n");

    res.set("Cache-Control", "public, max-age=600, s-maxage=3600");
    res.set("Content-Type", "application/xml; charset=utf-8");
    return res.send(
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${cuerpo}\n</urlset>\n`
    );
  } catch (error) {
    console.error("[sitemap] Error:", error.message);
    res.status(500);
    res.set("Content-Type", "application/xml; charset=utf-8");
    // Un sitemap vacío es XML válido: Google lo lee, no encuentra nada nuevo y vuelve luego. Es
    // mejor que un 500 con HTML, que sí le ensucia el informe de cobertura.
    return res.send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n`
    );
  }
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
  equipoPublicoHandler,
  sitemapHandler,
  direccionesDelSitemap,
  aSlug,
  slugCanonico,
  vistaDelPartido,
  momentoDelPartido,
  MOMENTO,
  esIndexable,
  esc,
  // Para inspeccionar y probar el índice sin pasar por HTTP.
  indiceEquipos,
  proximosDeEquipo,
  identidadDeEquipo,
};
