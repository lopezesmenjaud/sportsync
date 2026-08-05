const { matchAppliesToSubscription } = require("./subscriptionMatchService");

// ─────────────────────────────────────────────────────────────────────────────────────────────
// REGLA DE DISEÑO QUE ORDENA TODO ESTO:
//
//   El calendario de un usuario depende ÚNICAMENTE de las suscripciones de ese usuario.
//   Lo que hagan o dejen de hacer los demás no lo toca nunca.
//
// El cleanup de DELETE /subscriptions/:id preguntaba "¿ALGUIEN sigue esta liga?" en vez de "¿ESTE
// usuario todavía quiere este evento?", porque calculaba los huérfanos contra
// subscriptionRepository.getAll(). Por eso jcgviejo@gmail.com se dio de baja de la Champions y sus
// eventos se quedaron: lopezesmenjaud la seguía, así que esos partidos nunca contaron como
// huérfanos. A escala, con alguien siguiendo cada liga popular, la limpieza al darse de baja deja
// de correr para nadie, nunca, y sin un solo error en ningún log.
//
// ABANDONADO es una categoría distinta de huérfano y fantasma: la fila existe Y el evento existe
// en Google —perfectamente consistentes— pero ninguna suscripción ACTUAL de ese usuario lo reclama.
//
// Este módulo es la ÚNICA definición del predicado y lo usan los tres caminos: la auditoría
// (runAuditoriaCalendario), el borrado del rezago (runBorrarAbandonados) y el cleanup del endpoint
// (server.js). Si calcularan distinto, la medición dejaría de significar algo.
//
// Vive en services/ y no en jobs/ porque server.js no puede importar un job: los jobs abren su
// propia conexión a la base al cargarse y salen del proceso si no encuentran el archivo.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Clasifica los eventos de calendario de UN usuario contra sus suscripciones ACTUALES.
 *
 * Consulta ACOTADA: solo las filas de ese usuario, con JOIN por providerMatchId (PRIMARY KEY de
 * matches, así que va por índice). Nada de getAll(): el cleanup viejo cargaba la tabla completa de
 * partidos Y todas las suscripciones de todos, en cada baja.
 *
 * La decisión se toma en JS con matchAppliesToSubscription, única fuente de verdad del predicado.
 * Se puede expresar en SQL con un NOT EXISTS, pero normalizeSport() es lógica JS: traducirla
 * crearía dos definiciones del mismo predicado que un día se separan en silencio.
 *
 * @param sqlite  Instancia de better-sqlite3 (con .prepare). Se inyecta para que cada llamador use
 *                SU conexión: la auditoría la suya (readonly, en DB_PATH) y el servidor la suya.
 *                Cruzar calendar_events de una base con suscripciones de otra daría un resultado
 *                mal sin avisar.
 * @param userId  Usuario a clasificar.
 */
function classifyUserEvents(sqlite, userId) {
  const subs = sqlite.prepare("SELECT * FROM subscriptions WHERE userId = ?").all(userId);

  const filas = sqlite.prepare(`
    SELECT ce.id, ce.calendarEventId, ce.providerMatchId,
           m.providerMatchId AS matchExiste,
           m.sport, m.competitionKey, m.competitionName,
           m.homeParticipantName, m.awayParticipantName,
           COALESCE(m.currentStartUtc, m.scheduledStartUtc) AS inicio
    FROM calendar_events ce
    LEFT JOIN matches m ON m.providerMatchId = ce.providerMatchId
    WHERE ce.userId = ?
  `).all(userId);

  const ahora = Date.now();
  const cubiertos = [], abandonadosFuturos = [], abandonadosPasados = [], inevaluables = [];

  for (const fila of filas) {
    // INEVALUABLE: el partido ya no está en matches (rastro del cleanup viejo, que sí borraba de
    // ahí), así que no hay sport ni competitionKey ni equipos contra qué evaluar. NO va a
    // abandonados ni a cubiertos: un número falso es peor que un hueco declarado.
    if (fila.matchExiste === null || fila.matchExiste === undefined) {
      inevaluables.push(fila);
      continue;
    }

    if (subs.some((sub) => matchAppliesToSubscription(fila, sub))) {
      cubiertos.push(fila);
      continue;
    }

    // Solo se actúa sobre los FUTUROS: borrarle a alguien su historial sería una sorpresa
    // desagradable y no aporta nada. Un partido sin fecha legible cuenta como pasado a propósito,
    // que es el lado en el que nunca se toca.
    const inicio = Date.parse(fila.inicio || "");
    if (Number.isFinite(inicio) && inicio > ahora) abandonadosFuturos.push(fila);
    else abandonadosPasados.push(fila);
  }

  return { subs, filas, cubiertos, abandonadosFuturos, abandonadosPasados, inevaluables };
}

module.exports = { classifyUserEvents };
