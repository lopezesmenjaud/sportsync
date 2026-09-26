// src/jobs/runReporteCategoriasTenis.js
//
// Reporte SOLO LECTURA: clasifica todos los partidos de tenis de la base con
// src/services/tenisCategorias.js e imprime cuántos caen en cada categoría,
// cuántos quedan fuera y por qué, y qué nombres de torneo faltan en
// src/data/tenisTorneos.json.
//
// No escribe nada: abre la base con { readonly: true }, así que SQLite rechaza
// cualquier escritura. NO carga src/db/database.js ni llama a initializeDatabase().
// La ruta de la base es la misma que usa src/db/database.js.
//
// Uso:
//   Local:   node src/jobs/runReporteCategoriasTenis.js
//   Render:  NODE_ENV=production node src/jobs/runReporteCategoriasTenis.js

require("dotenv").config();

const path = require("path");
const Database = require("better-sqlite3");
const { clasificarTorneoTenis, MOTIVOS, categorias } = require("../services/tenisCategorias");

const dbPath = process.env.NODE_ENV === "production"
  ? "/var/data/sportsync.db"
  : path.resolve(__dirname, "../../sportsync.db");

function main() {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const partidos = db.prepare(
    "SELECT sport, competitionKey, competitionName FROM matches WHERE lower(sport) = 'tennis'"
  ).all();
  db.close();

  console.log("========================================================");
  console.log(" CATEGORÍAS DE TENIS  (solo lectura)");
  console.log(` Base: ${dbPath}`);
  console.log("========================================================\n");
  console.log(`Partidos de tenis en total: ${partidos.length}\n`);

  const porCategoria = new Map(categorias.map(c => [c.clave, { ATP: 0, WTA: 0 }]));
  const porMotivo = new Map();
  const fueraDeTabla = new Map();   // "nombre|clave" -> { nombre, clave, partidos }
  const circuitoNoJuega = new Map(); // "nombre|clave" -> { nombre, clave, circuito, partidos }

  for (const partido of partidos) {
    const r = clasificarTorneoTenis(partido);
    if (r.categoria) {
      porCategoria.get(r.categoria)[r.circuito] += 1;
      continue;
    }
    porMotivo.set(r.motivo, (porMotivo.get(r.motivo) || 0) + 1);

    const llave = `${partido.competitionName}|${partido.competitionKey}`;
    if (r.motivo === MOTIVOS.FUERA_DE_LA_TABLA) {
      const fila = fueraDeTabla.get(llave)
        || { nombre: partido.competitionName, clave: partido.competitionKey, circuito: r.circuito, partidos: 0 };
      fila.partidos += 1;
      fueraDeTabla.set(llave, fila);
    } else if (r.motivo === MOTIVOS.CIRCUITO_NO_JUEGA) {
      const fila = circuitoNoJuega.get(llave)
        || { nombre: partido.competitionName, clave: partido.competitionKey, circuito: r.circuito, torneoEnTabla: r.torneo, partidos: 0 };
      fila.partidos += 1;
      circuitoNoJuega.set(llave, fila);
    }
  }

  console.log("\n1) PARTIDOS POR CATEGORÍA");
  console.table(categorias.map(c => {
    const n = porCategoria.get(c.clave);
    return { categoria: c.nombre, clave: c.clave, ATP: n.ATP, WTA: n.WTA, total: n.ATP + n.WTA };
  }));

  console.log("\n2) PARTIDOS SIN CATEGORÍA, POR MOTIVO");
  console.table(Object.values(MOTIVOS)
    .filter(m => m !== MOTIVOS.NO_ES_TENIS)
    .map(m => ({ motivo: m, partidos: porMotivo.get(m) || 0 })));

  const porPartidos = (a, b) => b.partidos - a.partidos || String(a.nombre).localeCompare(String(b.nombre));

  console.log("\n3) TRAEN CLAVE PERO NO ESTÁN EN LA TABLA  (mal escritos o faltantes)");
  const lista3 = [...fueraDeTabla.values()].sort(porPartidos);
  if (lista3.length) console.table(lista3);
  else console.log("   (ninguno)");

  console.log("\n4) ESTÁN EN LA TABLA PERO SU CIRCUITO NO COINCIDE  (la tabla dice null para ese circuito)");
  const lista4 = [...circuitoNoJuega.values()].sort(porPartidos);
  if (lista4.length) console.table(lista4);
  else console.log("   (ninguno)");

  console.log("\nListo. No se escribió nada.");
}

try {
  main();
} catch (err) {
  console.error("❌ Error en el reporte:", err);
  process.exit(1);
}
