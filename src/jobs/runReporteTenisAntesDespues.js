// src/jobs/runReporteTenisAntesDespues.js
//
// Reporte SOLO LECTURA: por cada usuario con suscripciones de tenis, cuántos partidos
// FUTUROS de tenis recibe hoy (ANTES) y cuántos recibiría después de correr la conversión
// a categorías (DESPUÉS), desglosado por torneo.
//
// Y el número que decide si se corre la conversión: cuántos eventos que HOY están en su
// calendario (calendar_events) y cubiertos dejarían de estar cubiertos. Ésos son los que la
// limpieza de abandonados (la baja de una suscripción, o runBorrarAbandonados) borraría
// después de Google Calendar.
//
// No duplica reglas: usa el predicado real (matchAppliesToSubscription) y el MISMO plan que
// la conversión (planDeConversion). No escribe nada: su propia conexión es { readonly: true }
// y no llama a initializeDatabase(). Al cargar subscriptionMatchService se carga también
// src/db/database.js (abre su conexión sin inicializar nada), igual que runAuditoriaCalendario.
//
// Uso:
//   Render:  NODE_ENV=production node src/jobs/runReporteTenisAntesDespues.js
//            TARGET_USER=correo@x.com NODE_ENV=production node src/jobs/runReporteTenisAntesDespues.js
//   Local:   node src/jobs/runReporteTenisAntesDespues.js

require("dotenv").config();

const path = require("path");
const Database = require("better-sqlite3");
const { planDeConversion } = require("../services/tenisCategorias");
const { matchAppliesToSubscription } = require("../services/subscriptionMatchService");

const dbPath = process.env.NODE_ENV === "production"
  ? "/var/data/sportsync.db"
  : path.resolve(__dirname, "../../sportsync.db");

const TARGET_USER = process.env.TARGET_USER || null;

const INICIO = "COALESCE(m.currentStartUtc, m.scheduledStartUtc)";

function main() {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const ahora = new Date().toISOString();

  const subs = db.prepare("SELECT * FROM subscriptions").all()
    .filter(s => !TARGET_USER || s.userId === TARGET_USER);
  const partidosFuturos = db.prepare(`
    SELECT m.* FROM matches m
    WHERE lower(m.sport) = 'tennis' AND ${INICIO} > ?
  `).all(ahora);
  const eventosFuturosDe = db.prepare(`
    SELECT ce.id AS calendarEventRowId, m.*
    FROM calendar_events ce
    JOIN matches m ON m.providerMatchId = ce.providerMatchId
    WHERE ce.userId = ? AND lower(m.sport) = 'tennis' AND ${INICIO} > ?
  `);

  const usuariosTenis = [...new Set(
    subs.filter(s => ["tenis", "tennis"].includes(String(s.sport || "").trim().toLowerCase())).map(s => s.userId)
  )].sort();

  console.log("========================================================");
  console.log(" TENIS: ANTES Y DESPUÉS DE LA CONVERSIÓN  (solo lectura)");
  console.log(` Base: ${dbPath}`);
  console.log(` Partidos de tenis futuros en la base: ${partidosFuturos.length}`);
  console.log(` Usuarios con suscripciones de tenis: ${usuariosTenis.length}`);
  console.log("========================================================");

  const totales = { antes: 0, despues: 0, eventosQueQuedanSinCubrir: 0, eventosYaSinCubrir: 0 };

  for (const userId of usuariosTenis) {
    const subsAntes = subs.filter(s => s.userId === userId);
    const { aBorrar, aCrear } = planDeConversion(subsAntes);
    const idsBorrados = new Set(aBorrar.map(s => s.id));
    const subsDespues = subsAntes.filter(s => !idsBorrados.has(s.id)).concat(aCrear);

    const cubre = (lista, m) => lista.some(s => matchAppliesToSubscription(m, s));

    const porTorneo = new Map();
    let antes = 0, despues = 0;
    for (const m of partidosFuturos) {
      const a = cubre(subsAntes, m), d = cubre(subsDespues, m);
      if (!a && !d) continue;
      const nombre = m.competitionName || "(sin nombre)";
      const llave = `${nombre}|${m.competitionKey}`;
      const fila = porTorneo.get(llave) || { torneo: nombre, clave: m.competitionKey, antes: 0, despues: 0 };
      if (a) { fila.antes++; antes++; }
      if (d) { fila.despues++; despues++; }
      porTorneo.set(llave, fila);
    }

    // Eventos YA agendados en su calendario, futuros: ¿quién los cubre hoy y quién después?
    const eventos = eventosFuturosDe.all(userId, ahora);
    const quedanSinCubrir = eventos.filter(e => cubre(subsAntes, e) && !cubre(subsDespues, e));
    const yaSinCubrir = eventos.filter(e => !cubre(subsAntes, e));

    console.log(`\n── ${userId}`);
    console.log("   Suscripciones de tenis hoy:");
    for (const s of subsAntes.filter(s => ["tenis", "tennis"].includes(String(s.sport || "").toLowerCase()))) {
      const cambia = idsBorrados.has(s.id) ? "  -> se convierte" : "  (no cambia)";
      console.log(`     ${s.teamName ? `jugador "${s.teamName}"` : "competencia"}  clave=${s.competitionKey}  ${s.competitionName || ""}${cambia}`);
    }
    if (aCrear.length) console.log(`   Categorías que se crearían: ${aCrear.map(s => s.competitionKey).join(", ")}`);

    console.log(`   Partidos futuros de tenis: ANTES ${antes}  ->  DESPUÉS ${despues}`);
    const tabla = [...porTorneo.values()]
      .map(f => ({ ...f, diferencia: f.despues - f.antes }))
      .sort((x, y) => y.antes - x.antes || y.despues - x.despues || x.torneo.localeCompare(y.torneo));
    if (tabla.length) console.table(tabla);

    console.log(`   Eventos futuros de tenis ya en su calendario: ${eventos.length}`);
    console.log(`   >>> Cubiertos hoy que DEJARÍAN de estar cubiertos: ${quedanSinCubrir.length}`);
    if (quedanSinCubrir.length) {
      const porT = new Map();
      for (const e of quedanSinCubrir) {
        const k = `${e.competitionName}|${e.competitionKey}`;
        const f = porT.get(k) || { torneo: e.competitionName, clave: e.competitionKey, eventos: 0 };
        f.eventos++;
        porT.set(k, f);
      }
      console.table([...porT.values()].sort((x, y) => y.eventos - x.eventos));
    }
    console.log(`   (Ya sin cubrir HOY, sin relación con la conversión: ${yaSinCubrir.length})`);

    totales.antes += antes;
    totales.despues += despues;
    totales.eventosQueQuedanSinCubrir += quedanSinCubrir.length;
    totales.eventosYaSinCubrir += yaSinCubrir.length;
  }

  db.close();

  console.log("\n========================================================");
  console.log(" TOTALES");
  console.log(`   Partidos futuros de tenis entregados: ANTES ${totales.antes}  ->  DESPUÉS ${totales.despues}`);
  console.log(`   >>> Eventos en calendarios que la conversión dejaría sin cubrir: ${totales.eventosQueQuedanSinCubrir}`);
  console.log("       (ésos los borraría después la limpieza de abandonados)");
  console.log(`   Eventos que YA estaban sin cubrir antes de la conversión: ${totales.eventosYaSinCubrir}`);
  console.log(" No se escribió nada.");
  console.log("========================================================");
}

try {
  main();
} catch (err) {
  console.error("❌ Error en el reporte:", err);
  process.exit(1);
}
