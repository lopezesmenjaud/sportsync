const { LiveTennisApiProvider } = require("../providers/liveTennisApi");
const { detectMatchChanges } = require("./matchChangeDetector");
const { matchRepository } = require("../repositories/matchRepositorySqlite");

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
