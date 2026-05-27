require("dotenv").config();

const { initializeDatabase } = require("../db/database");
const { googleAccountRepository } = require("../repositories/googleAccountRepositorySqlite");
const { calendarEventRepository } = require("../repositories/calendarEventRepositorySqlite");
const { getCalendarClientForUser } = require("../services/googleCalendarProvider");

const TARGET_EMAIL = process.env.TARGET_EMAIL || "lopezesmenjaud@gmail.com";
const CONFIRM = process.env.CONFIRM === "yes";

// Ventana: 365 días atrás y 365 días adelante.
const WINDOW_PAST_DAYS = 365;
const WINDOW_FUTURE_DAYS = 365;

function isGoneStatus(err) {
  const status = err?.code || err?.response?.status;
  return status === 404 || status === 410;
}

// Clasifica un evento del calendario primary según señales que NOSOTROS
// inyectamos en buildEventFromMatch (googleCalendarProvider.js:68-107):
//   - source.url = https://fanschedule.com/match/{providerMatchId}
//   - source.title = "Ver en FanSchedule"
//   - description contiene "Ver partido: https://fanschedule.com/match/..."
//   - description contiene "Powered by FanSchedule"
// Y branding LEGACY "SportSync" (visto en server.js:979 cleanup-calendar):
//   - mención de "SportSync" en cualquier campo, sin nuestros marcadores actuales → DUDOSO
function classifyEvent(ev) {
  const desc = ev.description || "";
  const sourceUrl = ev.source?.url || "";
  const sourceTitle = ev.source?.title || "";
  const summary = ev.summary || "";

  // Señales PRIMARIAS (confianza alta)
  if (sourceUrl.startsWith("https://fanschedule.com/match/")) {
    return { kind: "fanschedule", certain: true, reason: "source.url=fanschedule.com/match/..." };
  }
  if (/https?:\/\/(www\.)?fanschedule\.com\/match\//i.test(desc)) {
    return { kind: "fanschedule", certain: true, reason: "description tiene URL fanschedule.com/match/..." };
  }
  if (/Powered by FanSchedule/i.test(desc) || sourceTitle === "Ver en FanSchedule") {
    return { kind: "fanschedule", certain: true, reason: "tiene marcador 'Powered by FanSchedule' o source.title='Ver en FanSchedule'" };
  }

  // Branding LEGACY — marcar como DUDOSO
  if (/SportSync/i.test(desc) || /SportSync/i.test(sourceTitle) || /SportSync/i.test(summary)) {
    return { kind: "fanschedule", certain: false, reason: "branding legacy 'SportSync' sin marcadores actuales" };
  }

  // El q: search trajo este evento (porque menciona "FanSchedule" en algún campo),
  // pero NO tiene ninguna de nuestras firmas → muy probable evento personal del usuario.
  return { kind: "other", reason: "q: matched pero sin firmas de creación de FanSchedule" };
}

async function listCandidates(calendar, timeMin, timeMax) {
  const queries = ["FanSchedule", "SportSync"];
  const seen = new Map(); // event.id → event
  let listedTotal = 0;

  for (const q of queries) {
    let pageToken = undefined;
    do {
      const res = await calendar.events.list({
        calendarId: "primary",
        timeMin,
        timeMax,
        q,
        maxResults: 250,
        singleEvents: true,
        orderBy: "startTime",
        pageToken,
      });
      const items = res.data.items || [];
      listedTotal += items.length;
      for (const ev of items) {
        if (!seen.has(ev.id)) seen.set(ev.id, ev);
      }
      pageToken = res.data.nextPageToken || undefined;
    } while (pageToken);
  }

  return { events: [...seen.values()], listedTotal };
}

async function run() {
  await initializeDatabase();

  console.log("=".repeat(110));
  console.log("LIMPIEZA DE HUÉRFANOS FANSCHEDULE EN CALENDARIO PRIMARY");
  console.log(`Usuario buscado    : ${TARGET_EMAIL}`);
  console.log(`Modo               : ${CONFIRM ? "BORRADO (CONFIRM=yes)" : "REPORTE (sin borrar)"}`);
  console.log("Hora UTC ahora     :", new Date().toISOString());
  console.log("=".repeat(110));

  // 1. Encontrar cuenta
  const allAccounts = await googleAccountRepository.getAll();
  const target = allAccounts.find(
    a => (a.googleEmail || "").toLowerCase() === TARGET_EMAIL.toLowerCase()
  );
  if (!target) {
    console.error(`\n❌ No se encontró cuenta con email "${TARGET_EMAIL}".`);
    console.error(`   Tip: corre con TARGET_EMAIL=otra@cuenta.com node src/jobs/runCleanupPrimaryOrphans.js`);
    process.exit(1);
  }
  console.log(`\n→ Cuenta: userId=${target.userId}  email=${target.googleEmail}`);
  console.log(`  fanschedule_calendar_id=${target.fanschedule_calendar_id || "(null)"}`);

  // 2. Set de calendarEventId registrados en calendar_events del usuario.
  //    PROTECCIÓN ABSOLUTA: el script NUNCA borrará ninguno de éstos.
  const links = await calendarEventRepository.getByUserId(target.userId);
  const registeredEventIds = new Set(links.map(l => l.calendarEventId));
  console.log(`\nRegistros en calendar_events del usuario: ${links.length} (protegidos — el script NO los toca)`);

  // 3. Cliente de Calendar
  let calendar;
  try {
    calendar = await getCalendarClientForUser(target.userId);
  } catch (err) {
    console.error(`❌ No se pudo construir el client de Calendar: ${err.message}`);
    process.exit(1);
  }

  // 4. Listar candidatos del PRIMARY usando q: "FanSchedule" y q: "SportSync".
  //    Esto le pide a Google que filtre del lado del server: nunca enumeramos
  //    los eventos personales del usuario, solo los que mencionan esas palabras.
  const now = Date.now();
  const timeMin = new Date(now - WINDOW_PAST_DAYS * 86400000).toISOString();
  const timeMax = new Date(now + WINDOW_FUTURE_DAYS * 86400000).toISOString();
  console.log(`\nVentana de búsqueda: ${timeMin}  →  ${timeMax}`);
  console.log(`Listando candidatos en primary con q: "FanSchedule" y q: "SportSync"...`);

  let listed;
  try {
    listed = await listCandidates(calendar, timeMin, timeMax);
  } catch (err) {
    console.error(`❌ No se pudo listar eventos del primary: ${err.message}`);
    process.exit(1);
  }
  console.log(`Eventos devueltos por las queries (post-dedupe): ${listed.events.length}  (suma bruta entre queries: ${listed.listedTotal})`);

  // 5. Clasificar y filtrar.
  //    Tres compuertas de protección:
  //      a) si el id está en calendar_events del usuario → NUNCA tocar
  //      b) si la clasificación dice "other" → no es nuestro → NUNCA tocar
  //      c) (al borrar) re-verificar que NO esté en el set registrado antes del delete
  const candidates = [];
  let skippedRegistered = 0;
  let skippedNonFanschedule = 0;

  for (const ev of listed.events) {
    if (registeredEventIds.has(ev.id)) {
      skippedRegistered++;
      continue;
    }
    const classification = classifyEvent(ev);
    if (classification.kind !== "fanschedule") {
      skippedNonFanschedule++;
      continue;
    }
    candidates.push({ ev, classification });
  }

  console.log(`\nClasificación:`);
  console.log(`  Protegidos (registrados en calendar_events)        : ${skippedRegistered}`);
  console.log(`  Descartados (q: match pero sin firma de FanSchedule): ${skippedNonFanschedule}`);
  console.log(`  Candidatos huérfanos                                : ${candidates.length}`);

  if (candidates.length === 0) {
    console.log("\nNada que limpiar. FIN.");
    process.exit(0);
  }

  // 6. REPORTE — siempre corre, modo default
  console.log("\n" + "-".repeat(110));
  console.log("REPORTE — eventos candidatos a borrar:");
  console.log("-".repeat(110));

  const certainCount = candidates.filter(c => c.classification.certain).length;
  const dudosoCount = candidates.length - certainCount;

  for (const { ev, classification } of candidates) {
    const startRaw = ev.start?.dateTime || ev.start?.date || "(sin fecha)";
    const mark = classification.certain ? "" : "  ⚠️  DUDOSO";
    console.log(
      `  eventId=${ev.id}\n` +
      `    start  : ${startRaw}\n` +
      `    title  : "${ev.summary || "(sin título)"}"\n` +
      `    razón  : ${classification.reason}${mark}`
    );
  }

  console.log("\n" + "=".repeat(110));
  console.log(`Total candidatos: ${candidates.length}  (confirmados=${certainCount}  dudosos=${dudosoCount})`);
  console.log("=".repeat(110));

  if (!CONFIRM) {
    console.log("\nModo reporte. Para borrar, corre con CONFIRM=yes.");
    console.log("Si hay DUDOSOS y NO los quieres borrar, NO corras CONFIRM=yes hasta investigarlos manualmente.");
    process.exit(0);
  }

  // 7. FASE DE BORRADO — solo con CONFIRM=yes
  console.log("\n" + "-".repeat(110));
  console.log("BORRADO — procediendo...");
  console.log("-".repeat(110));

  let okGoogle = 0;
  let goneGoogle = 0;
  let errGoogle = 0;
  let skippedSafety = 0;

  for (let i = 0; i < candidates.length; i++) {
    const { ev, classification } = candidates[i];
    const tag = `[${i + 1}/${candidates.length}]`;
    const startRaw = ev.start?.dateTime || ev.start?.date || "(sin fecha)";
    const dudosoMark = classification.certain ? "" : "  [DUDOSO]";
    console.log(`\n${tag} eventId=${ev.id}  start=${startRaw}  title="${ev.summary || "(sin título)"}"${dudosoMark}`);

    // COMPUERTA FINAL DE SEGURIDAD: re-verificar que el id NO esté registrado.
    // (Defensa en profundidad — ya fue filtrado en el paso 5, pero por si acaso.)
    if (registeredEventIds.has(ev.id)) {
      console.log(`${tag}   ⚠️  Está en calendar_events — NO se borra (defensa en profundidad)`);
      skippedSafety++;
      continue;
    }

    try {
      await calendar.events.delete({ calendarId: "primary", eventId: ev.id });
      console.log(`${tag}   ✓ Borrado de primary`);
      okGoogle++;
    } catch (err) {
      if (isGoneStatus(err)) {
        console.log(`${tag}   ✓ Ya no existía (404/410) — tratado como éxito`);
        goneGoogle++;
      } else {
        console.error(`${tag}   ✗ ERROR — ${err.message}`);
        errGoogle++;
      }
    }
  }

  console.log("\n" + "=".repeat(110));
  console.log("RESUMEN");
  console.log("=".repeat(110));
  console.log(`Procesados=${candidates.length}  borrados=${okGoogle}  ya-no-existían=${goneGoogle}  errores=${errGoogle}  saltados-por-seguridad=${skippedSafety}`);

  console.log("\nFIN.");
  process.exit(errGoogle > 0 ? 1 : 0);
}

run().catch(err => {
  console.error("LIMPIEZA FALLÓ:", err);
  process.exit(1);
});
