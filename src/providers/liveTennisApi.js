const axios = require("axios");
const { createMatch } = require("../domain/matchModel");
const { INTERNAL_STATUS } = require("../domain/statusMap");
const { getEnv } = require("../config/env");

// Proveedor de TENIS. Existe porque TheSportsDB cataloga tenis pero no trae partidos:
// comprobado el 29 ago 2026, cero eventos en 8 días, con MLB y Liga MX de control
// devolviendo 20 cada una.
//
// Misma forma que TheSportsDbProvider a propósito: lo único que expone hacia afuera es
// normalizeMatch(raw) devolviendo createMatch({...}). Así matchRepository,
// detectMatchChanges, syncMatchToCalendars y buildEventFromMatch no se enteran de que
// hay dos proveedores.
//
// PRESUPUESTO: el plan gratis son 100 peticiones al día. Un barrido son 4 páginas, y el
// plan es barrer cada 2 h → 48/día. Por eso NADA que se sirva al usuario en vivo puede
// pegarle a esta API: el picker se sirve de tabla, nunca de aquí.

const BASE_URL = "https://api.livetennisapi.com/api/public/v1";

// El horizonte real de los datos es de ~2.5 días. No es un defecto del proveedor: en tenis
// el cuadro no existe hasta que alguien gana.
const PAGE_LIMIT = 50;

// Tope de SEGURIDAD, no la condición de paro: los frenos de getUpcomingMatches cortan antes
// en cuanto llega una página vacía o corta. Existe para que un has_more que nunca baje no se
// coma la cuota del día.
//
// 8 = holgura sobre las 6 páginas reales medidas el 29 ago 2026 (252 partidos, la 6ª con
// solo 2). Se pone con holgura porque la lista CRECE durante el día: esa misma mañana eran
// 194 en 4 páginas. El tope no cuesta peticiones mientras no se alcance — se paga por página
// que existe, no por página permitida.
//
// ⚠️ PRESUPUESTO: 6 páginas por barrido × 12 barridos al día = 72 de las 100 del plan
// gratis. El plan original suponía 4 páginas (48). Antes de conectar esto al scheduler hay
// que decidir el intervalo: cada 3 h son 8 barridos ≈ 48, que sí cabe.
const MAX_PAGES = 8;

// tour → competitionKey. Se mapea a los ids de TheSportsDB que YA usan las suscripciones
// de tenis de hoy (LeaguePicker.jsx: ATP 4464, WTA 4517). Inventar ids nuevos obligaría a
// migrar las suscripciones existentes; esto no obliga a nada.
// LLAVES EN MINÚSCULAS: el proveedor manda "atp" y "wta", no "ATP"/"WTA". Comprobado en la
// respuesta real el 29 ago 2026 — la primera versión tenía el mapa en mayúsculas y mandaba
// TODOS los partidos del circuito principal al descarte "tour desconocido".
const TOUR_TO_COMPETITION_KEY = {
  atp: "4464",
  wta: "4517",
};

// Único punto donde se traduce tour → competitionKey.
//
// Devolver null NO es un error: challenger e itf entran a propósito y se guardan sin
// competitionKey (ver el bloque de descartar()). Null significa "ninguna suscripción por
// circuito lo reclama", que es justo lo que se quiere para esos partidos.
function competitionKeyForTour(tour) {
  return TOUR_TO_COMPETITION_KEY[String(tour || "").trim().toLowerCase()] || null;
}

class LiveTennisApiProvider {
  constructor() {
    this.apiKey = getEnv("LIVE_TENNIS_API_KEY");
    this.baseUrl = BASE_URL;
  }

  // La llave viaja en header, no en la URL. Es la diferencia con TheSportsDB, que la lleva
  // incrustada en la ruta y por eso necesita urlSinLlave() antes de tocar un log: aquí una
  // URL logueada no puede filtrar nada.
  get headers() {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  // UNA página, sin normalizar. Devuelve también el status y un recorte del cuerpo, porque
  // cuando esto sale vacío lo único que sirve es poder LEER qué contestó el proveedor.
  async getUpcomingPage({ limit = PAGE_LIMIT, offset = 0 } = {}) {
    const response = await axios.get(`${this.baseUrl}/matches`, {
      params: { status: "upcoming", limit, offset },
      headers: this.headers,
      timeout: 15000,
      // No lanzar por status. Un 401/429 trae CUERPO, y ese cuerpo es justo lo que hay que
      // poder leer; con el default de axios se pierde dentro del objeto de error. Es la
      // misma regla que safeFetchJson: un status de error es un fallo, pero primero se lee.
      validateStatus: () => true,
    });

    // response.data ES el cuerpo ya parseado (axios). Y dentro del cuerpo, los partidos
    // vienen en `data` y la paginación en `meta`:
    //   {"data":[ ...50 objetos... ],"meta":{count,has_more,limit,offset,total}}
    // La primera versión leía `matches` y por eso traía cero. NO se deja un respaldo a
    // `matches`: un respaldo escondería el siguiente cambio de forma en vez de gritarlo.
    const cuerpo = response.data;
    const serializado = typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo);

    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      matches: Array.isArray(cuerpo?.data) ? cuerpo.data : [],
      meta: cuerpo?.meta || {},
      cuerpoRecortado: String(serializado ?? "").slice(0, 300),
    };
  }

  // Barrido, paginando.
  //
  // Devuelve { raw, paginas, completo, error, diagnostico }.
  //
  // CERO PARTIDOS CUENTA COMO FALLO, no como resultado. Un barrido vacío que se reporta
  // "completo" es guardar un fracaso como si fuera un dato — es exactamente lo que pasó en
  // el primer intento y lo que obligó a consultar la API a mano para descubrir que el bug
  // era nuestro. Si algún día el circuito está de verdad vacío, el log lo va a decir con el
  // cuerpo del proveedor a la vista y se decide entonces; hoy, con 194 partidos próximos,
  // cero solo puede significar que algo se rompió.
  //
  // `diagnostico` guarda SIEMPRE el status y los primeros 300 caracteres del cuerpo de la
  // primera página, haya salido bien o mal. Es el rastro que no existía.
  //
  // No reintenta. Con 100 peticiones al día, un bucle de reintentos quema el día entero;
  // si una página truena, se conserva lo que sí llegó y se espera al siguiente barrido.
  async getUpcomingMatches({ limit = PAGE_LIMIT, maxPages = MAX_PAGES } = {}) {
    const raw = [];
    let paginas = 0;
    let error = null;
    let diagnostico = null;
    let ultimaMeta = null;
    // Por qué se dejó de pedir páginas. "tope de páginas" NO cuenta como barrido terminado:
    // significa que la lista se cortó donde nosotros dijimos, no donde se acabó.
    let motivoParo = null;

    for (let pagina = 0; pagina < maxPages; pagina++) {
      const offset = pagina * limit;

      let p;
      try {
        p = await this.getUpcomingPage({ limit, offset });
      } catch (err) {
        // Aquí solo caen red, DNS y timeout: los status de error ya no lanzan.
        error = err.message;
        console.warn(`[tennis] ✗ página ${pagina + 1} (offset ${offset}) no salió: ${error}`);
        break;
      }

      paginas++;
      if (pagina === 0) diagnostico = { status: p.status, cuerpo: p.cuerpoRecortado };

      if (!p.ok) {
        error = `HTTP ${p.status}`;
        console.warn(`[tennis] ✗ página ${pagina + 1} (offset ${offset}): ${error}`);
        break;
      }

      raw.push(...p.matches);
      ultimaMeta = p.meta;

      // CUATRO frenos, y has_more es solo uno. El primer intento se comió 6 peticiones
      // porque la única condición de paro era has_more; los tres primeros frenos de aquí
      // habrían cortado en la página 1 sin depender de que el proveedor lo diga bien.
      //
      // Y no es paranoia: el 29 ago 2026 el barrido trajo 200 partidos en 4 páginas llenas
      // mientras meta.total decía 194. El meta de este proveedor NO es de fiar, así que la
      // condición de paro real son las tres primeras, no has_more ni total.
      // Los DOS primeros no dependen del meta y son los únicos de fiar: una página vacía o
      // más corta que el límite solo puede significar que se acabó la lista.
      if (p.matches.length === 0)   { motivoParo = "página vacía"; break; }
      if (p.matches.length < limit) { motivoParo = "página corta"; break; }

      // has_more queda como ÚLTIMO RECURSO, y su motivo dice de dónde salió a propósito: si
      // algún día trunca el barrido, que se sepa que la decisión fue del proveedor.
      //
      // NO se frena por meta.total, y la razón es que ESE NÚMERO CRECE DURANTE EL DÍA. El 29
      // ago 2026 la lista pasó de 194 a 252 partidos en unas horas: el proveedor va agregando
      // partidos conforme se define el cuadro. Un freno por total cortaría en el número que
      // se leyó al empezar y anunciaría "total alcanzado" —que suena a final legítimo—
      // dejando fuera lo que se agregó mientras tanto. Un freno que disfraza un truncamiento
      // de final correcto es peor que no tenerlo.
      if (!p.meta.has_more) { motivoParo = "has_more=false (lo dice el proveedor)"; break; }
    }

    if (!error && !motivoParo) {
      // Se acabaron las páginas permitidas sin que ningún freno dijera "ya no hay más".
      // Puede haber partidos que no trajimos, así que esto NO es un barrido terminado.
      motivoParo = "tope de páginas";
      error = `tope de ${maxPages} páginas alcanzado sin señal de fin`;
    }

    if (!error && raw.length === 0) error = "cero partidos";

    return { raw, paginas, completo: !error, error, diagnostico, ultimaMeta, motivoParo };
  }

  // ¿Este partido se puede usar? Devuelve null si sí, o el motivo del descarte si no.
  //
  // Vive separado de normalizeMatch para que el script de prueba en seco pueda CONTAR los
  // descartes por motivo sin duplicar las reglas.
  // ── QUÉ NO SE DESCARTA, Y POR QUÉ ──
  //
  // NO se descarta por tour. Entran challenger e itf igual que atp y wta. La razón está en
  // cómo casa una suscripción: TeamPicker guarda a un jugador con competitionKey NULL y
  // teamName = su nombre, y matchAppliesToSubscription solo compara el competitionKey
  // cuando la suscripción trae uno. O sea que un partido de Challenger SÍ le llega a quien
  // sigue a ese jugador, por nombre. No queda huérfano. Lo único que no pasa es que una
  // suscripción "sigo el ATP Tour" lo reclame — y eso es correcto: un Challenger no es ATP
  // Tour. Por eso competitionKeyForTour devuelve null fuera de atp/wta y está bien así.
  //
  // NO se descarta la qualy, por el mismo argumento. La qualy de un Grand Slam es un
  // jugador que alguien sigue jugando un partido de verdad. Excluirla sería la app
  // decidiendo por el usuario cuáles de sus partidos no cuentan.
  descartar(raw) {
    // DOBLES SÍ SE DESCARTA, y por una razón DISTINTA de las de arriba — que quede escrita
    // para que nadie la revierta por simetría cuando lea que challenger y qualy sí entran:
    // en dobles, players.p1.name viene como la PAREJA completa, "Ana Candiotto / Sofia
    // Cabezas Dominguez". Ese string no puede casar con ninguna suscripción individual,
    // así que serían filas que NADIE puede reclamar jamás. No es una preferencia sobre qué
    // tenis vale: es que no funciona. Confirmado en la respuesta real del proveedor.
    if (raw.is_doubles) return "dobles";

    // Sin hora no hay evento posible. Sin esta guarda el partido cae en el bug conocido de
    // crear un evento en 1970: new Date(null) da epoch y nadie avisa.
    if (!raw.scheduled_time) return "sin scheduled_time";

    // Sin los dos nombres no hay título ni forma de casar la suscripción.
    if (!raw.players?.p1?.name || !raw.players?.p2?.name) return "sin los dos jugadores";

    return null;
  }

  mapStatus(rawStatus) {
    if (!rawStatus) return INTERNAL_STATUS.UNKNOWN;
    const normalized = String(rawStatus).trim().toLowerCase();
    switch (normalized) {
      case "upcoming":
      case "scheduled":
      case "not started":  return INTERNAL_STATUS.SCHEDULED;
      case "postponed":    return INTERNAL_STATUS.POSTPONED;
      case "cancelled":
      case "canceled":
      case "walkover":
      case "retired":      return INTERNAL_STATUS.CANCELLED;
      case "delayed":      return INTERNAL_STATUS.DELAYED;
      case "live":
      case "in progress":  return INTERNAL_STATUS.LIVE;
      case "finished":
      case "completed":    return INTERNAL_STATUS.FINISHED;
      default:             return INTERNAL_STATUS.UNKNOWN;
    }
  }

  // scheduled_time ya viene en ISO UTC. Se normaliza a la forma que usa el resto del
  // sistema (…Z) para que la comparación de detectMatchChanges sea contra el mismo formato
  // y un cambio de horario no se pierda por una diferencia de string.
  buildScheduledStartUtc(raw) {
    if (!raw.scheduled_time) return null;
    const d = new Date(raw.scheduled_time);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  normalizeMatch(raw) {
    const providerMatchId = `ltapi_${raw.id}`;
    const competitionKey  = competitionKeyForTour(raw.tour);

    // Los nombres van TAL CUAL vienen del proveedor, sin tocar acentos ni formato.
    // matchAppliesToSubscription (subscriptionMatchService.js) casa la suscripción con el
    // partido comparando subscriptions.teamName contra estos strings, en minúsculas y por
    // igualdad EXACTA. Cualquier normalización aquí rompe el match en silencio: el partido
    // se guarda, ninguna suscripción lo reclama, y no se agenda nada.
    const homeParticipantName = raw.players?.p1?.name || null;
    const awayParticipantName = raw.players?.p2?.name || null;

    const scheduledStartUtc = this.buildScheduledStartUtc(raw);

    return createMatch({
      internalMatchId: `live_tennis_api_${raw.id}`,
      // El prefijo NO es cosmético: matches.providerMatchId es PRIMARY KEY y la comparte
      // con los ids de TheSportsDB, y calendar_events enlaza por ahí. Sin prefijo, un id
      // numérico repetido pisaría el partido de otro deporte sin avisar.
      provider: "live_tennis_api",
      providerMatchId,
      sport: "tennis",
      competitionKey,
      competitionName: raw.tournament || "Tenis",
      // El nombre del torneo como respaldo del título: buildEventFromMatch solo lo usa
      // cuando NO hay dos participantes, y aquí siempre hay dos.
      eventName: raw.tournament || null,
      homeParticipantName,
      awayParticipantName,
      scheduledStartUtc,
      // Iguales al crear, como hace TheSportsDbProvider. currentStartUtc es el campo que
      // compara detectMatchChanges, y es el que mueve el evento en Google cuando cambia.
      currentStartUtc: scheduledStartUtc,
      status: this.mapStatus(raw.status || raw.event_status),
      rawStatus: raw.status || raw.event_status || null,
      // El proveedor no manda sede ni ciudad. El evento sale sin ubicación.
      venueName: null,
      city: null,
      country: null,
      // round_code alimenta a getRoundLabel. Va como string por consistencia con
      // TheSportsDB, que manda códigos numéricos en el mismo campo.
      intRound: raw.round_code != null ? String(raw.round_code) : null,
      lastProviderUpdateUtc: raw.updated_at || new Date().toISOString(),
    });
  }
}

module.exports = { LiveTennisApiProvider, TOUR_TO_COMPETITION_KEY };
