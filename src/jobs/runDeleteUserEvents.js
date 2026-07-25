// src/jobs/runDeleteUserEvents.js
//
// Borra QUIRÚRGICAMENTE una lista EXPLÍCITA de eventos (por providerMatchId) de UN usuario.
// Uso: deshacer eventos creados por error (ej. GP de Canadá ya jugado). NO es un filtro
// automático de "pasados" — solo toca los IDs listados, para no borrar histórico válido
// (p.ej. tu baseball). Dry-run por defecto; CONFIRM=1 para aplicar.
//
// Por cada providerMatchId, para TARGET_USER:
//   - Busca la fila (getByUserIdAndProviderMatchId).
//   - Borra el evento en Google (googleCalendarProvider.deleteEvent → calendar.events.delete;
//     maneja 404/410 como éxito).
//   - Borra la fila (calendarEventRepository.deleteById).
// Log por evento; NO aborta si uno falla.
//
// Uso:
//   Dry-run:  TARGET_USER=tu@email node src/jobs/runDeleteUserEvents.js
//   Aplicar:  TARGET_USER=tu@email CONFIRM=1 node src/jobs/runDeleteUserEvents.js
//   Render:   añade NODE_ENV=production

require("dotenv").config();

const { calendarEventRepository } = require("../repositories/calendarEventRepositorySqlite");
const { googleAccountRepository } = require("../repositories/googleAccountRepositorySqlite");
const googleCalendarProvider = require("../services/googleCalendarProvider");
const { db } = require("../db/database");

const TARGET_EMAIL = process.env.TARGET_USER;
const APPLY = process.env.CONFIRM === "1" || process.env.CONFIRM === "true";

// Lista EXPLÍCITA a borrar (GP de Canadá creado por error). providerMatchId es TEXT.
const PROVIDER_MATCH_IDS = ["2408152", "2408153", "2408154", "2408155", "2408156"];

async function main() {
  if (!TARGET_EMAIL) {
    console.error("[delete] TARGET_USER (email) es obligatorio.");
    process.exit(1);
  }
  console.log(`[delete] modo: ${APPLY ? "APLICAR (CONFIRM=1)" : "DRY-RUN (no borra nada)"}`);
  console.log(`[delete] TARGET_USER=${TARGET_EMAIL}  IDs=[${PROVIDER_MATCH_IDS.join(", ")}]`);

  const acc = (await googleAccountRepository.getAll()).find(
    (a) => (a.googleEmail || "").toLowerCase() === TARGET_EMAIL.toLowerCase()
  );
  if (!acc) {
    console.error(`[delete] No hay cuenta con googleEmail=${TARGET_EMAIL}. Aborta.`);
    process.exit(1);
  }
  const userId = acc.userId;
  const calendarId = acc.fanschedule_calendar_id;
  console.log(`[delete] userId=${userId}  fanschedule_calendar_id=${calendarId === null ? "NULL" : calendarId}`);

  let matched = 0, deleted = 0, notFound = 0, errors = 0;
  for (const pid of PROVIDER_MATCH_IDS) {
    try {
      const row = await calendarEventRepository.getByUserIdAndProviderMatchId(userId, pid);
      if (!row) { notFound++; console.log(`[delete] ${pid}: sin fila en calendar_events (nada que borrar)`); continue; }
      matched++;

      if (!APPLY) {
        console.log(`[delete] ${pid}: DRY-RUN borraría rowId=${row.id} calendarEventId=${row.calendarEventId}`);
        continue;
      }

      // Borrar en Google (si hay calendario). deleteEvent trata 404/410 como éxito.
      if (calendarId) {
        await googleCalendarProvider.deleteEvent({ userId, calendarId, calendarEventId: row.calendarEventId });
      } else {
        console.log(`[delete] ${pid}: calendar_id NULL — salto Google, borro solo la fila`);
      }
      // Borrar la fila.
      await calendarEventRepository.deleteById(row.id);
      deleted++;
      console.log(`[delete] ${pid}: borrado (rowId=${row.id}, calendarEventId=${row.calendarEventId})`);
    } catch (e) {
      errors++;
      console.error(`[delete] ${pid}: error ${e.message}`);
    }
  }

  console.log("─".repeat(56));
  if (!APPLY) {
    console.log(`[delete] DRY-RUN: borraría=${matched}  sin_fila=${notFound}`);
    console.log("[delete] Nada se borró. Re-ejecuta con CONFIRM=1 para aplicar.");
  } else {
    console.log(`[delete] borrados=${deleted}  sin_fila=${notFound}  errores=${errors}`);
  }
  console.log("[delete] Listo.");
}

main()
  .then(() => { db.close(); process.exit(0); })
  .catch((err) => { console.error("[delete] FALLÓ:", err.message); db.close(); process.exit(1); });
