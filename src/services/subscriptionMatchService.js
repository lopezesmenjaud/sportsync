const { subscriptionRepository } = require("../repositories/subscriptionRepositorySqlite");
const { matchRepository } = require("../repositories/matchRepositorySqlite");
const { normalizeSport } = require("./syncService");

function matchAppliesToSubscription(match, subscription) {
  if (subscription.sport && normalizeSport(subscription.sport) !== normalizeSport(match.sport)) {
    return false;
  }

  if (
    subscription.competitionKey &&
    match.competitionKey !== subscription.competitionKey
  ) {
    return false;
  }

  if (subscription.teamName) {
    const teamName = subscription.teamName.toLowerCase();
    const home = (match.homeParticipantName || "").toLowerCase();
    const away = (match.awayParticipantName || "").toLowerCase();

    if (home !== teamName && away !== teamName) {
      return false;
    }
  }

  return true;
}

// isInclusionReason: ¿esta suscripción es una RAZÓN por la que este partido se muestra?
//
// El principio del filtro (dicho por Julio, y es el correcto): el filtro se pregunta "¿por qué
// estoy mostrando este partido?". Si la razón es que el usuario sigue al Atlas, entonces el
// partido aparece cuando filtra por Atlas. La atribución NO es una regla nueva: es la razón de
// inclusión, hecha explícita. Por eso este MISMO helper decide dos cosas con una sola regla:
//   - visibilidad: un partido se muestra si ALGUNA suscripción es razón de inclusión;
//   - atribución (inclusionReasonIds): CUÁLES suscripciones son esa razón.
// Visibilidad y atribución son la misma regla POR DISEÑO. Separarlas —una regla para lo que se
// muestra y otra distinta para a qué favorito pertenece— sería el bug: aparecerían partidos
// visibles que ningún favorito reclama, y el filtro los escondería para siempre.
//
// ⚠️ OJO — esta regla (la de la visibilidad de hoy) difiere A PROPÓSITO del canónico
// matchAppliesToSubscription en UN caso: cuando una suscripción tiene teamName Y competitionKey a
// la vez (modo league_only y selecciones nacionales), aquí se matchea SOLO por equipo e IGNORA la
// competición, mientras que el canónico exige ambas. Consecuencia: un "Atlas en Liga MX" aquí
// también incluye los partidos de Atlas en otras competiciones. Es una inconsistencia CONOCIDA
// entre lo que el usuario VE (esta regla) y lo que se sincroniza a su calendario (el canónico, vía
// getMatchesForUser). Está PENDIENTE de medir en producción y resolver en su propia tarea. NO es un
// descuido: se mantiene idéntico a la visibilidad de hoy para no cambiar lo que el usuario ya ve.
function isInclusionReason(match, subscription) {
  if (normalizeSport(subscription.sport) !== normalizeSport(match.sport)) return false;
  if (subscription.teamName) {
    return match.homeParticipantName === subscription.teamName ||
           match.awayParticipantName === subscription.teamName;
  }
  if (subscription.competitionKey) return match.competitionKey === subscription.competitionKey;
  return true;
}

// subscriptions es OPCIONAL: si el caller ya las cargó (para reusarlas y no leer dos veces
// por usuario en la misma corrida, p.ej. userBackfillService), las pasa; si no, se cargan aquí.
async function getMatchesForUser(userId, subscriptions) {
  if (!subscriptions) subscriptions = await subscriptionRepository.getByUserId(userId);
  const matches = await matchRepository.getAll();

  const relevantMatches = matches.filter((match) =>
    subscriptions.some((subscription) =>
      matchAppliesToSubscription(match, subscription)
    )
  );

  return relevantMatches;
}

// Devuelve de qué lado juega el equipo que sigue el usuario: 'home' | 'away' | null.
// null si: sigue la liga (sin equipo), sigue a los DOS equipos, o no hay dos equipos (F1/ciclismo).
function getUserSide(match, subscriptions) {
  const home = (match.homeParticipantName || "").toLowerCase();
  const away = (match.awayParticipantName || "").toLowerCase();
  if (!home || !away) return null;
  const teams = (subscriptions || []).filter((s) => s.teamName).map((s) => s.teamName.toLowerCase());
  const followsHome = teams.includes(home);
  const followsAway = teams.includes(away);
  if (followsHome && !followsAway) return "home";
  if (followsAway && !followsHome) return "away";
  return null;
}

module.exports = {
  getMatchesForUser,
  matchAppliesToSubscription,
  isInclusionReason,
  getUserSide,
};