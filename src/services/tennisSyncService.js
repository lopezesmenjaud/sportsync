const { LiveTennisApiProvider } = require("../providers/liveTennisApi");
const { detectMatchChanges } = require("./matchChangeDetector");
const { matchRepository } = require("../repositories/matchRepositorySqlite");
const { tennisPlayerRepository } = require("../repositories/tennisPlayerRepositorySqlite");

// Sync de TENIS contra Live Tennis API.
//
// Módulo aparte de syncService a propósito: requiere solo el proveedor, el repositorio y el
// detector de cambios. No importa syncService, que ya es importado por
// subscriptionMatchService — meterlo aquí cerraría un ciclo.
//
// ─────────────────────────────────────────────────────────────────────────────
// INTERRUPTOR: TENNIS_SYNC_ENABLED
//
// APAGADO POR DEFECTO, y esto no es precaución de más. El cron de tenis en scheduler.js YA
// EXISTE y ya corre; en cuanto syncSport quedó cableado, ese cron empezaría a barrer de
// verdad y a escribir en calendarios de usuarios reales sin que nadie haya visto una prueba
// en seco del sync completo.
//
// Con la variable apagada, syncTennis devuelve [] sin gastar NI UNA petición al proveedor.
//
// Encenderlo es cambiar la variable en Render, SIN desplegar. Y apagarlo es el FRENO DE
// EMERGENCIA: si algo sale mal con los calendarios de verdad, se apaga y el barrido se
// detiene en el siguiente ciclo sin esperar un deploy ni un revert.
// ─────────────────────────────────────────────────────────────────────────────
// El valor tiene que ser exactamente "true" (sin importar mayúsculas). Un "1" o un "yes" NO
// encienden nada: es preferible que quede apagado a que se encienda por una variable escrita
// de una forma que nadie revisó.
function tennisSyncEnabled() {
  // Se lee en CADA llamada, no al cargar el módulo: así apagarlo en Render surte efecto en el
  // siguiente barrido. Si se leyera una sola vez al arranque, el freno de emergencia exigiría
  // reiniciar el servicio, que es justo lo que no se quiere en una emergencia.
  return String(process.env.TENNIS_SYNC_ENABLED || "").toLowerCase() === "true";
}

// Solo "atp" y "wta" cuentan como circuito. "challenger" e "itf" devuelven null A PROPÓSITO.
function normalizaTour(t) {
  const s = String(t || "").trim().toLowerCase();
  return s === "atp" || s === "wta" ? s : null;
}

/**
 * De qué circuito es este jugador.
 *
 * Hace falta deducirlo porque el proveedor manda `tour` en null para 58 de 484 jugadores, y
 * entre ellos está DJOKOVIC (#5). Filtrar solo por el campo propio lo dejaría fuera de las dos
 * listas del picker, junto con Navarro (#27) y Krejcikova (#28).
 *
 * Los tres pasos se apoyan en hechos comprobados el 30 ago 2026, no en suposiciones:
 *   1. Su propio `tour` — resuelve 426 de 484.
 *   2. El `tour` DEL RIVAL. Un partido de singles es siempre del mismo género, y hay 51
 *      partidos donde uno de los dos sí lo trae y el otro no.
 *   3. El `tour` DEL EVENTO cuando es atp/wta — resuelve a Djokovic (evento atp) y a
 *      Navarro (evento wta).
 *
 * NO hay un paso 4 de "challenger → atp", y la omisión es deliberada. Challenger es el
 * circuito masculino de la ATP, pero no está comprobado que este proveedor no meta ahí los
 * WTA 125, y clasificar a una jugadora como ATP sería un error VISIBLE en pantalla. Que un
 * jugador de Challenger salga sin circuito y se encuentre con el buscador es un costo chico;
 * enseñar a una jugadora en la lista equivocada, no.
 */
function derivarTour(jugador, rival, tourDelEvento) {
  return normalizaTour(jugador?.tour)
      || normalizaTour(rival?.tour)
      || normalizaTour(tourDelEvento)
      || null;
}

// Junta los jugadores de un barrido, ya con su circuito deducido.
//
// Se salta los DOBLES: ahí players.pN.name es la pareja completa ("Ana Candiotto / Sofia
// Cabezas Dominguez"), que como nombre de jugador no sirve para nada y ensuciaría la lista.
function recolectarJugadores(raw) {
  const porId = new Map();
  for (const r of raw) {
    if (r.is_doubles) continue;
    const p1 = r.players?.p1;
    const p2 = r.players?.p2;
    if (!p1?.id || !p1?.name || !p2?.id || !p2?.name) continue;

    for (const [jugador, rival] of [[p1, p2], [p2, p1]]) {
      const id = String(jugador.id);
      const yaEsta = porId.get(id);
      const tour = derivarTour(jugador, rival, r.tour);
      // Si el mismo jugador sale en varios partidos, gana el registro que SÍ dedujo circuito.
      if (yaEsta && (yaEsta.tour || !tour)) continue;
      porId.set(id, {
        playerId: id,
        name: jugador.name,          // TAL CUAL. Ver el comentario de normalizeMatch.
        tour,
        country: jugador.country || null,
        ranking: jugador.ranking != null ? Number(jugador.ranking) : null,
      });
    }
  }
  return [...porId.values()];
}

/**
 * Barre los partidos próximos de tenis y devuelve los CAMBIOS, en la misma forma que
 * syncLeague y syncTeam: [{ matchId, homeParticipantName, awayParticipantName, changes, newMatch }].
 *
 * Esa forma es el contrato con el scheduler, que le pasa cada `newMatch` a
 * syncMatchToCalendars — y de ahí sale el updateEvent que MUEVE el evento en Google cuando
 * cambia el horario. Por eso el bucle de abajo es el de syncLeague, sin inventar nada:
 * leer el partido viejo, comparar con detectMatchChanges, guardar, y emitir solo lo que cambió.
 * Escribir directo en matches sin pasar por el detector dejaría los eventos congelados en la
 * hora vieja, en silencio.
 */
async function syncTennis() {
  if (!tennisSyncEnabled()) {
    console.log("[tennis] TENNIS_SYNC_ENABLED apagado — no se barre nada (0 peticiones).");
    return [];
  }

  const provider = new LiveTennisApiProvider();
  const { raw, paginas, completo, error, motivoParo } = await provider.getUpcomingMatches();

  console.log(`[tennis] barrido: ${raw.length} crudos en ${paginas} páginas (paro: ${motivoParo || "—"})`);

  if (!completo) {
    // Un barrido incompleto NO significa que los partidos que faltan se cancelaron: lo que no
    // llegó simplemente no se actualiza en este ciclo. Nada se borra por ausencia.
    console.warn(`[tennis] ✗ barrido INCOMPLETO: ${error}. Se procesa solo lo que llegó.`);
  }

  if (raw.length === 0) {
    console.warn("[tennis] ✗ cero partidos. No se procesa nada.");
    return [];
  }

  const descartados = new Map();
  const normalizados = [];
  for (const r of raw) {
    const motivo = provider.descartar(r);
    if (motivo) {
      descartados.set(motivo, (descartados.get(motivo) || 0) + 1);
      continue;
    }
    normalizados.push(provider.normalizeMatch(r));
  }

  if (descartados.size > 0) {
    const detalle = [...descartados.entries()].map(([m, n]) => `${n} ${m}`).join(", ");
    console.log(`[tennis] descartados: ${detalle}`);
  }

  // Lista de jugadores del picker. Se llena desde los datos que este barrido YA trajo, así
  // que no cuesta ni una petición extra. Va en su propio try: si guardar los jugadores falla,
  // los partidos y los calendarios NO se caen con ella.
  try {
    const jugadores = recolectarJugadores(raw);
    const { guardados, renombrados } = await tennisPlayerRepository.upsertMany(jugadores);
    const sinTour = jugadores.filter(j => !j.tour).length;
    console.log(`[tennis] jugadores: ${guardados} guardados (${sinTour} sin circuito deducido)`);

    // LA ÚNICA FALLA SILENCIOSA QUE QUEDA, hecha ruidosa.
    //
    // La suscripción guarda el NOMBRE del jugador y casa por igualdad exacta contra el nombre
    // del partido. Si el proveedor cambia una escritura ("H. Shi" → "Haoxuan Shi"), quien lo
    // siguió con la anterior deja de recibir sus partidos y NADA truena: el partido se guarda,
    // ninguna suscripción lo reclama, y la persona simplemente no se entera.
    //
    // Hoy no pasa (0 conflictos en 495 ids, comprobado el 29 ago 2026), pero es lo que hay que
    // vigilar. Si este renglón aparece, hay suscripciones que quedaron huérfanas.
    for (const r of renombrados) {
      console.warn(`[tennis] ⚠️ NOMBRE CAMBIADO id=${r.playerId}: "${r.antes}" → "${r.ahora}". Revisar suscripciones con el nombre viejo.`);
    }
  } catch (e) {
    console.error(`[tennis] no se pudo guardar la lista de jugadores: ${e.message}`);
  }

  const results = [];
  for (const match of normalizados) {
    const oldMatch = await matchRepository.getByProviderMatchId(match.providerMatchId);
    const changes  = detectMatchChanges(oldMatch, match);
    await matchRepository.save(match);

    if (changes.length > 0) {
      results.push({
        matchId:             match.providerMatchId,
        homeParticipantName: match.homeParticipantName,
        awayParticipantName: match.awayParticipantName,
        changes,
        newMatch: match
      });
    }
  }

  console.log(`[tennis] ${normalizados.length} partidos procesados, ${results.length} con cambios`);
  return results;
}

module.exports = { syncTennis, tennisSyncEnabled };
