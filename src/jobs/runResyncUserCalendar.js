require("dotenv").config();

const { initializeDatabase } = require("../db/database");
const { googleAccountRepository } = require("../repositories/googleAccountRepositorySqlite");
const { subscriptionRepository } = require("../repositories/subscriptionRepositorySqlite");
const { matchRepository } = require("../repositories/matchRepositorySqlite");
const { calendarEventRepository } = require("../repositories/calendarEventRepositorySqlite");
const { getMatchesForUser } = require("../services/subscriptionMatchService");
const { syncMatchToCalendars } = require("../services/calendarSyncService");

const TARGET_EMAIL = process.env.TARGET_EMAIL || "lopezesmenjaud@gmail.com";

async function run() {
  await initializeDatabase();

  console.log("=".repeat(110));
  console.log(`RE-SINCRONIZACIÓN DE CALENDARIO POR USUARIO`);
  console.log(`Usuario buscado    : ${TARGET_EMAIL}`);
  console.log("Hora UTC ahora     :", new Date().toISOString());
  console.log("=".repeat(110));

  // 1. Encontrar cuenta
  const allAccounts = await googleAccountRepository.getAll();
  const target = allAccounts.find(
    a => (a.googleEmail || "").toLowerCase() === TARGET_EMAIL.toLowerCase()
  );
  if (!target) {
    console.error(`\n❌ No se encontró cuenta con email "${TARGET_EMAIL}".`);
    console.error(`   Tip: corre con TARGET_EMAIL=otra@cuenta.com node src/jobs/runResyncUserCalendar.js`);
    process.exit(1);
  }
  console.log(`\n→ Cuenta: userId=${target.userId}  email=${target.googleEmail}`);
  console.log(`  fanschedule_calendar_id (antes)=${target.fanschedule_calendar_id || "(null)"}`);

  // 2. Suscripciones del usuario
  const subscriptions = await subscriptionRepository.getByUserId(target.userId);
  console.log(`\nSuscripciones del usuario: ${subscriptions.length}`);
  for (const s of subscriptions) {
    console.log(`  - id=${s.id}  sport=${s.sport}  competition=${s.competitionKey || "—"} (${s.competitionName || ""})  team=${s.teamName || "—"}`);
  }

  if (subscriptions.length === 0) {
    console.log("\nUsuario sin suscripciones — nada que sincronizar. FIN.");
    process.exit(0);
  }

  // 3. Partidos relevantes — misma lógica que el filtro del endpoint
  //    (subscriptionMatchService.getMatchesForUser ya usa matchAppliesToSubscription)
  const relevantMatches = await getMatchesForUser(target.userId);
  const allMatchCount = (await matchRepository.getAll()).length;
  console.log(`\nPartidos en BD relevantes para este usuario: ${relevantMatches.length} (de ${allMatchCount} totales)`);

  if (relevantMatches.length === 0) {
    console.log("\nNo hay partidos en BD que coincidan con las suscripciones del usuario.");
    console.log("Tip: corre primero un sync (scheduler / endpoint /subscriptions/sync) para traer partidos.");
    process.exit(0);
  }

  // 4. Re-sincronizar — misma función que usa el endpoint POST /subscriptions/sync
  //    (server.js:1190 → syncMatchToCalendars del módulo calendarSyncService)
  console.log("\n" + "-".repeat(110));
  console.log("SINCRONIZACIÓN — procediendo...");
  console.log("-".repeat(110));

  let totalCreatedForUser = 0;
  let totalUpdatedForUser = 0;
  let totalErrors = 0;

  for (let i = 0; i < relevantMatches.length; i++) {
    const m = relevantMatches[i];
    const tag = `[${i + 1}/${relevantMatches.length}]`;
    const name = `${m.homeParticipantName || ""} vs ${m.awayParticipantName || ""}`.trim() || m.eventName || "(sin nombre)";
    process.stdout.write(`${tag} ${m.providerMatchId}  "${name}" ... `);
    try {
      const results = await syncMatchToCalendars(m);
      // syncMatchToCalendars hace fan-out a TODOS los users afectados;
      // filtramos al user objetivo para que el contador refleje su estado.
      const userResults = results.filter(r => r.userId === target.userId);
      const created = userResults.filter(r => r.action === "created").length;
      const updated = userResults.filter(r => r.action === "updated").length;
      totalCreatedForUser += created;
      totalUpdatedForUser += updated;
      console.log(`created=${created} updated=${updated} (total fan-out: ${results.length})`);
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      totalErrors++;
    }
  }

  // 5. REPORTE DE VERIFICACIÓN
  console.log("\n" + "=".repeat(110));
  console.log("REPORTE DE VERIFICACIÓN");
  console.log("=".repeat(110));

  // 5a. fanschedule_calendar_id post-sync (debió crearse si estaba en null)
  const refreshed = await googleAccountRepository.getByUserId(target.userId);
  const calIdAfter = refreshed?.fanschedule_calendar_id || null;
  console.log(`fanschedule_calendar_id (antes) : ${target.fanschedule_calendar_id || "(null)"}`);
  console.log(`fanschedule_calendar_id (después): ${calIdAfter || "(null)"}` + (calIdAfter ? "  ✓" : "  ✗ sigue null — revisar logs de Google"));

  // 5b. Total de filas en calendar_events del user
  const finalLinks = await calendarEventRepository.getByUserId(target.userId);
  console.log(`\nTotal filas en calendar_events para este usuario: ${finalLinks.length}`);

  // 5c. Agrupar por providerMatchId — marcar DUPLICADO si count > 1
  const byMatchId = new Map();
  for (const ce of finalLinks) {
    if (!byMatchId.has(ce.providerMatchId)) byMatchId.set(ce.providerMatchId, []);
    byMatchId.get(ce.providerMatchId).push(ce);
  }

  console.log(`\nDesglose por providerMatchId (ordenado por # filas desc):`);
  const entries = [...byMatchId.entries()].sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    return a[0].localeCompare(b[0]);
  });

  let duplicateMatchCount = 0;
  for (const [pmId, rows] of entries) {
    const mark = rows.length > 1 ? `  ⚠️  DUPLICADO (${rows.length} filas)` : "";
    console.log(`  providerMatchId=${pmId}  filas=${rows.length}${mark}`);
    if (rows.length > 1) {
      duplicateMatchCount++;
      for (const r of rows) {
        console.log(`     - id=${r.id}  calendarEventId=${r.calendarEventId}  created=${r.createdAtUtc}  updated=${r.updatedAtUtc}`);
      }
    }
  }

  console.log("\n" + "-".repeat(110));
  console.log("RESUMEN");
  console.log("-".repeat(110));
  console.log(`Operaciones para el usuario : created=${totalCreatedForUser}  updated=${totalUpdatedForUser}  errores-de-match=${totalErrors}`);
  console.log(`providerMatchId duplicados   : ${duplicateMatchCount}  ${duplicateMatchCount === 0 ? "✓ sin duplicados" : "✗ HAY DUPLICADOS"}`);

  console.log("\nFIN.");
  process.exit(totalErrors > 0 || duplicateMatchCount > 0 ? 1 : 0);
}

run().catch(err => {
  console.error("RE-SYNC FALLÓ:", err);
  process.exit(1);
});
