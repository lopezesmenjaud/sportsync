// src/jobs/runConvertirSuscripcionesTenisACategorias.js
//
// Convierte las suscripciones de tenis por CIRCUITO (ATP Tour 4464 / WTA Tour 4517, sin
// jugador) en suscripciones por CATEGORÍA de torneo:
//   ATP Tour -> las categorías de ATP de src/data/tenisTorneos.json
//   WTA Tour -> las categorías de WTA
// Las suscripciones por jugador (con teamName, con o sin circuito) NO se tocan.
//
// ─── QUÉ ESCRIBE ───────────────────────────────────────────────────────────────────────
// Escribe SOLO en la tabla subscriptions. NO toca calendar_events ni Google Calendar.
//
// PERO OJO: después de convertir, los partidos que la suscripción vieja cubría y ninguna
// categoría cubre (challengers no, esos nunca los cubrió; sí los torneos de circuito que
// falten en la tabla) quedan "abandonados". La próxima baja de ese usuario, o
// runBorrarAbandonados, los borraría de su Google Calendar. Antes de correr esto con
// CONFIRM=1, corre src/jobs/runReporteTenisAntesDespues.js y mira ese número.
//
// Y NO se corre hasta que exista la pantalla de ligas nueva: la de hoy solo conoce 4464/4517.
// ───────────────────────────────────────────────────────────────────────────────────────
//
// Nunca corre sola: no la llama el scheduler ni el arranque. No llama a initializeDatabase().
//
// Uso:
//   Prueba en seco (default, abre la base en solo lectura):
//     NODE_ENV=production node src/jobs/runConvertirSuscripcionesTenisACategorias.js
//   Escribir, un usuario:
//     CONFIRM=1 TARGET_USER=correo@x.com NODE_ENV=production node src/jobs/runConvertirSuscripcionesTenisACategorias.js
//   Escribir, con tope de usuarios:
//     CONFIRM=1 MAX=5 NODE_ENV=production node src/jobs/runConvertirSuscripcionesTenisACategorias.js

require("dotenv").config();

const path = require("path");
const Database = require("better-sqlite3");
const { planDeConversion } = require("../services/tenisCategorias");

const dbPath = process.env.NODE_ENV === "production"
  ? "/var/data/sportsync.db"
  : path.resolve(__dirname, "../../sportsync.db");

const CONFIRM = process.env.CONFIRM === "1";
const TARGET_USER = process.env.TARGET_USER || null;
const MAX = process.env.MAX ? Number(process.env.MAX) : Infinity;

function describir(sub) {
  return `${sub.userId}  sport=${sub.sport}  competitionKey=${sub.competitionKey}  competitionName=${sub.competitionName}`;
}

function main() {
  const db = new Database(dbPath, { readonly: !CONFIRM, fileMustExist: true });

  console.log("========================================================");
  console.log(" CONVERSIÓN DE SUSCRIPCIONES DE TENIS A CATEGORÍAS");
  console.log(` Modo: ${CONFIRM ? "ESCRIBE (CONFIRM=1)" : "PRUEBA EN SECO (no escribe nada)"}`);
  console.log(` Base: ${dbPath}`);
  if (TARGET_USER) console.log(` Solo usuario: ${TARGET_USER}`);
  if (Number.isFinite(MAX)) console.log(` Tope de usuarios: ${MAX}`);
  console.log("========================================================\n");

  const todas = db.prepare("SELECT * FROM subscriptions").all()
    .filter(s => !TARGET_USER || s.userId === TARGET_USER);
  const plan = planDeConversion(todas);

  const usuarios = [...new Set(plan.aBorrar.map(s => s.userId))].slice(0, MAX);
  if (usuarios.length === 0) {
    console.log("No hay suscripciones de tenis por circuito que convertir.");
    db.close();
    return;
  }

  const leerSubsDe = db.prepare("SELECT * FROM subscriptions WHERE userId = ?");
  const borrar = db.prepare(
    "DELETE FROM subscriptions WHERE id = ? AND userId = ? AND teamName IS NULL AND competitionKey = ?"
  );
  const crear = db.prepare(`
    INSERT INTO subscriptions (userId, sport, competitionKey, competitionName, teamName, createdAtUtc)
    VALUES (?, ?, ?, ?, NULL, ?)
  `);

  let totalBorradas = 0, totalCreadas = 0;

  for (const userId of usuarios) {
    // El plan se recalcula con las filas de ESTE usuario al momento de escribir.
    const { aBorrar, aCrear } = planDeConversion(leerSubsDe.all(userId));

    console.log(`── ${userId}`);
    for (const s of aBorrar) console.log(`   BORRARÍA  id=${s.id}  ${describir(s)}`);
    for (const s of aCrear)  console.log(`   CREARÍA   ${describir(s)}`);

    if (CONFIRM) {
      // Todo o nada por usuario: si una fila no se puede borrar, no se crea ninguna.
      db.transaction(() => {
        const ahora = new Date().toISOString();
        for (const s of aBorrar) {
          const r = borrar.run(s.id, s.userId, s.competitionKey);
          if (r.changes !== 1) throw new Error(`la fila id=${s.id} ya no está como se leyó`);
        }
        for (const s of aCrear) {
          crear.run(s.userId, s.sport, s.competitionKey, s.competitionName, ahora);
        }
      })();
      console.log(`   ✅ escrito: ${aBorrar.length} borrada(s), ${aCrear.length} creada(s)`);
    }

    totalBorradas += aBorrar.length;
    totalCreadas += aCrear.length;
  }

  db.close();

  console.log("\n========================================================");
  console.log(` Usuarios: ${usuarios.length}   Filas a borrar: ${totalBorradas}   Filas a crear: ${totalCreadas}`);
  console.log(CONFIRM ? " Escrito." : " PRUEBA EN SECO: no se escribió nada. Para escribir: CONFIRM=1");
  console.log("========================================================");
}

try {
  main();
} catch (err) {
  console.error("❌ Error en la conversión:", err.message);
  process.exit(1);
}
