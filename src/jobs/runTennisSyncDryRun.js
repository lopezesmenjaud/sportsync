require("dotenv").config();

// PRUEBA EN SECO DEL SYNC DE TENIS. NO ESCRIBE NADA.
//
// Contesta, ANTES de encender TENNIS_SYNC_ENABLED: qué partidos se insertarían, cuáles se
// actualizarían, cuántos cambios de horario se detectarían, y a cuántos usuarios les tocaría
// un evento.
//
// Diferencia con runTennisDryRun.js: aquel valida el MAPEO del proveedor y no toca la base.
// Este valida el SYNC — lee la base para comparar contra lo guardado, sin escribir.
//
// DOS garantías, no una promesa:
//   1. Nunca llama a syncMatchToCalendars ni a googleCalendarProvider: no puede tocar el
//      calendario de nadie porque no los importa.
//   2. matchRepository.save se REEMPLAZA por una función que lanza. Si algún camino intentara
//      escribir un partido, truena a la vista en vez de escribir en silencio.
//
// Se corre contra la base de PRODUCCIÓN en el Shell de Render, en solo lectura:
//
//   cd ~/project/src && node src/jobs/runTennisSyncDryRun.js
//
// Cuesta ~6 peticiones al proveedor (un barrido completo).
//
// Ignora TENNIS_SYNC_ENABLED a propósito: la gracia es poder mirar ANTES de encenderlo.

const { LiveTennisApiProvider } = require("../providers/liveTennisApi");
const { detectMatchChanges } = require("./../services/matchChangeDetector");
const { matchRepository } = require("../repositories/matchRepositorySqlite");
const { getAffectedUserIdsForMatch } = require("../services/affectedUsersService");

// ── Candado de escritura ──
// Antes de hacer nada, se inutiliza el único método que podría escribir un partido.
matchRepository.save = async () => {
  throw new Error("PRUEBA EN SECO: alguien intentó llamar a matchRepository.save()");
};

const MUESTRA = 10;

function linea() {
  console.log("─".repeat(72));
}

async function run() {
  console.log("PRUEBA EN SECO DEL SYNC DE TENIS");
  console.log("NO se escribe ninguna fila. NO se toca ningún calendario.");
  linea();

  let provider;
  try {
    provider = new LiveTennisApiProvider();
  } catch (e) {
    console.error(`✗ ${e.message}`);
    console.error("  Si lo corres en tu máquina: falta LIVE_TENNIS_API_KEY en el .env de la raíz del repo.");
    console.error("  Si lo corres en Render:     falta LIVE_TENNIS_API_KEY en las Environment Variables del servicio.");
    process.exitCode = 1;
    return;
  }

  const { raw, paginas, completo, error, motivoParo } = await provider.getUpcomingMatches();

  console.log(`Páginas traídas:   ${paginas}`);
  console.log(`Barrido completo:  ${completo ? "sí" : `NO — ${error}`}`);
  console.log(`Se paró por:       ${motivoParo || "—"}`);
  console.log(`Partidos crudos:   ${raw.length}`);

  if (raw.length === 0) {
    linea();
    console.log("✗ CERO PARTIDOS. Nada que simular.");
    process.exitCode = 1;
    return;
  }

  const normalizados = [];
  for (const r of raw) {
    if (!provider.descartar(r)) normalizados.push(provider.normalizeMatch(r));
  }
  console.log(`Pasan el filtro:   ${normalizados.length}`);

  // ── Simulación del bucle de syncTennis, sin el save ──
  const seInsertarian = [];
  const seActualizarian = [];
  const sinCambios = [];
  let cambiosDeHorario = 0;
  let cambiosDeEstado = 0;
  const ejemplosDeHorario = [];

  for (const match of normalizados) {
    const oldMatch = await matchRepository.getByProviderMatchId(match.providerMatchId);
    const changes  = detectMatchChanges(oldMatch, match);

    if (!oldMatch) {
      seInsertarian.push(match);
      continue;
    }
    if (changes.length === 0) {
      sinCambios.push(match);
      continue;
    }

    seActualizarian.push({ match, changes });
    for (const c of changes) {
      if (c.type === "match_time_changed") {
        cambiosDeHorario++;
        if (ejemplosDeHorario.length < 5) {
          ejemplosDeHorario.push(
            `${match.homeParticipantName} vs ${match.awayParticipantName}: ${c.oldStartUtc} → ${c.newStartUtc}`
          );
        }
      }
      if (c.type === "match_status_changed") cambiosDeEstado++;
    }
  }

  linea();
  console.log("QUÉ HARÍA EL SYNC");
  console.log(`   Se INSERTARÍAN (partidos nuevos):   ${seInsertarian.length}`);
  console.log(`   Se ACTUALIZARÍAN (ya guardados):    ${seActualizarian.length}`);
  console.log(`   Sin cambios (no producen nada):     ${sinCambios.length}`);
  console.log("");
  console.log(`   Cambios de HORARIO detectados:      ${cambiosDeHorario}`);
  console.log(`   Cambios de ESTADO detectados:       ${cambiosDeEstado}`);

  if (ejemplosDeHorario.length > 0) {
    console.log("");
    console.log("   Ejemplos de cambio de horario (estos MOVERÍAN el evento en Google):");
    for (const e of ejemplosDeHorario) console.log(`      · ${e}`);
  }

  // ── A cuántos usuarios les tocaría evento ──
  //
  // Solo cuentan los partidos que producirían `results`: los nuevos y los que cambiaron. Un
  // partido sin cambios no llega a syncMatchToCalendars y por tanto no genera ningún evento.
  // getAffectedUserIdsForMatch es lectura pura (lee subscriptions y filtra en memoria).
  const conResultado = [...seInsertarian, ...seActualizarian.map(x => x.match)];

  const usuarios = new Set();
  let eventosTotales = 0;
  const porUsuario = new Map();

  for (const match of conResultado) {
    const ids = await getAffectedUserIdsForMatch(match);
    for (const id of ids) {
      usuarios.add(id);
      porUsuario.set(id, (porUsuario.get(id) || 0) + 1);
      eventosTotales++;
    }
  }

  linea();
  console.log("A QUIÉN LE TOCARÍA UN EVENTO");
  console.log(`   Partidos que llegarían al calendario: ${conResultado.length}`);
  console.log(`   Usuarios distintos afectados:         ${usuarios.size}`);
  console.log(`   Eventos que se crearían/actualizarían: ${eventosTotales}`);

  if (porUsuario.size > 0) {
    console.log("");
    for (const [userId, n] of [...porUsuario.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`      ${String(n).padStart(4)} eventos  ${userId}`);
    }
  } else {
    console.log("");
    console.log("   Ningún usuario tiene suscripciones que casen con estos partidos.");
    console.log("   Es lo esperado si todavía nadie sigue tenis: el sync guardaría los");
    console.log("   partidos y no crearía un solo evento.");
  }

  if (seInsertarian.length > 0) {
    linea();
    console.log(`MUESTRA DE ${Math.min(MUESTRA, seInsertarian.length)} PARTIDOS QUE SE INSERTARÍAN`);
    linea();
    for (const m of seInsertarian.slice(0, MUESTRA)) {
      console.log(`  ${m.currentStartUtc}  ${m.competitionName}  [${m.intRound || "—"}]`);
      console.log(`     ${m.homeParticipantName} vs ${m.awayParticipantName}   (competitionKey ${m.competitionKey || "null"})`);
    }
  }

  linea();
  console.log("FIN. No se escribió ninguna fila y no se tocó ningún calendario.");
}

run().catch(err => {
  console.error("PRUEBA EN SECO FALLÓ:");
  console.error(err.response?.data || err.message);
  process.exitCode = 1;
});
