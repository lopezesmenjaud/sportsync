// src/jobs/runRespaldoBase.js
//
// Escribe un respaldo LÓGICO y VERIFICADO de la base dentro del mismo disco
// persistente, para que el snapshot diario de Render contenga una copia
// consistente y no solo el archivo vivo (.db + -wal escritos en momentos distintos).
//
// Qué hace, en orden:
//   1. Mide espacio libre del disco y tamaño de la base (.db + -wal). Si no
//      alcanza para 3 copias más, aborta sin escribir: un respaldo no puede
//      llenar el disco y tumbar la app.
//   2. VACUUM INTO desde una conexión { readonly: true } a un archivo temporal
//      (.parcial) creado de antemano con modo 0600.
//   3. Verifica la copia: PRAGMA integrity_check y count(*) tabla por tabla contra
//      la original. Si algo falla, BORRA la copia y termina con error.
//   4. Solo si quedó verificada, la renombra a su nombre final y aplica la
//      retención: conserva las RETENER más recientes (default 7) y borra las
//      anteriores. Solo toca archivos con el patrón de nombre de este job.
//
// Ensayo por default: sin CONFIRM=1 solo mide y dice qué escribiría y qué
// borraría. NO carga src/db/database.js ni llama a initializeDatabase().
// Solo cuenta filas; nunca lee ni imprime el contenido de ninguna.
// La ruta de la base es la misma que usa src/db/database.js.
//
// Uso:
//   Render (ensayo): cd ~/project/src && NODE_ENV=production node src/jobs/runRespaldoBase.js
//   Render (real):   cd ~/project/src && NODE_ENV=production CONFIRM=1 node src/jobs/runRespaldoBase.js

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const dbPath = process.env.NODE_ENV === "production"
  ? "/var/data/sportsync.db"
  : path.resolve(__dirname, "../../sportsync.db");

const CONFIRM = process.env.CONFIRM === "1";
const COPIAS_DE_MARGEN = 3;

const dirBase = path.dirname(dbPath);
const dirRespaldos = path.join(dirBase, "respaldos");
const prefijo = path.basename(dbPath, ".db");
// Solo los archivos que coinciden con esto son de este job y se pueden borrar por retención.
const patronRespaldo = new RegExp(`^${prefijo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d{4}-\\d{2}-\\d{2}T\\d{4}Z\\.db$`);

function tamano(ruta) {
  try {
    return fs.statSync(ruta).size;
  } catch (err) {
    if (err.code === "ENOENT") return 0;
    throw err;
  }
}

function espacioLibre(dir) {
  const s = fs.statfsSync(dir);
  return s.bavail * s.bsize;
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function sello(fecha) {
  // 2026-10-23T20:57:12.345Z -> 2026-10-23T2057Z
  return fecha.toISOString().slice(0, 16).replace(":", "") + "Z";
}

function leerRetener() {
  const crudo = process.env.RETENER;
  if (crudo === undefined || crudo === "") return 7;
  const n = Number(crudo);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`RETENER debe ser un entero >= 1 (llegó "${crudo}").`);
  }
  return n;
}

function respaldosExistentes() {
  if (!fs.existsSync(dirRespaldos)) return [];
  return fs.readdirSync(dirRespaldos).filter(n => patronRespaldo.test(n)).sort();
}

function tablas(db) {
  return db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
  ).pluck().all();
}

function contarFilas(db, nombres) {
  const conteo = new Map();
  for (const nombre of nombres) {
    const id = `"${nombre.replace(/"/g, '""')}"`;
    conteo.set(nombre, db.prepare(`SELECT count(*) FROM ${id}`).pluck().get());
  }
  return conteo;
}

function borrarSiExiste(ruta) {
  try {
    fs.unlinkSync(ruta);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

function main() {
  const RETENER = leerRetener();

  console.log("========================================================");
  console.log(` RESPALDO DE LA BASE  (${CONFIRM ? "REAL" : "ENSAYO, no escribe nada"})`);
  console.log(` Base: ${dbPath}`);
  console.log("========================================================\n");

  if (!fs.existsSync(dbPath)) {
    throw new Error(`No existe la base en "${dbPath}". En Render hay que correrlo con NODE_ENV=production.`);
  }

  // ── 1. Espacio antes de escribir nada ──
  const bytesDb = tamano(dbPath);
  const bytesWal = tamano(`${dbPath}-wal`);
  const bytesBase = bytesDb + bytesWal;
  const libre = espacioLibre(dirBase);
  const necesario = bytesBase * COPIAS_DE_MARGEN;

  console.log(`Base (.db)        : ${bytesDb} bytes (${mb(bytesDb)})`);
  console.log(`WAL (-wal)        : ${bytesWal} bytes (${mb(bytesWal)})`);
  console.log(`Espacio libre     : ${libre} bytes (${mb(libre)})`);
  console.log(`Mínimo requerido  : ${necesario} bytes (${mb(necesario)}) = ${COPIAS_DE_MARGEN} x (.db + -wal)`);

  if (libre < necesario) {
    throw new Error(
      `ABORTADO: el disco no tiene espacio para ${COPIAS_DE_MARGEN} copias más de la base. ` +
      `Libre ${mb(libre)}, requerido ${mb(necesario)}. No se escribió nada.`
    );
  }

  const nombre = `${prefijo}-${sello(new Date())}.db`;
  const destino = path.join(dirRespaldos, nombre);
  const parcial = `${destino}.parcial`;

  const existentes = respaldosExistentes();
  if (existentes.includes(nombre)) {
    throw new Error(`Ya existe ${destino}. Espera al siguiente minuto. No se escribió nada.`);
  }
  const despues = [...existentes, nombre].sort();
  const aBorrar = despues.slice(0, Math.max(0, despues.length - RETENER));

  if (!CONFIRM) {
    console.log(`\nEscribiría        : ${destino}`);
    console.log(`Retención         : conservar ${RETENER}; hoy hay ${existentes.length}`);
    if (aBorrar.length === 0) {
      console.log("Borraría          : nada");
    } else {
      console.log("Borraría          :");
      for (const n of aBorrar) console.log(`  - ${path.join(dirRespaldos, n)}`);
    }
    console.log("\nENSAYO: no se escribió ni se borró nada. Para hacerlo de verdad: CONFIRM=1");
    return;
  }

  // ── 2. Escribir la copia ──
  fs.mkdirSync(dirRespaldos, { recursive: true, mode: 0o700 });
  // VACUUM INTO acepta un archivo vacío ya existente. Lo creamos con 0600 para que
  // la copia (que trae los tokens de google_accounts) nunca exista con otros permisos.
  fs.closeSync(fs.openSync(parcial, "wx", 0o600));

  let original;
  let copia;
  try {
    original = new Database(dbPath, { readonly: true, fileMustExist: true });
    original.prepare("VACUUM INTO ?").run(parcial);
    fs.chmodSync(parcial, 0o600);

    // ── 3. Verificar ──
    copia = new Database(parcial, { readonly: true, fileMustExist: true });
    const integridad = copia.prepare("PRAGMA integrity_check").pluck().all();
    const integridadOk = integridad.length === 1 && integridad[0] === "ok";

    const tablasOriginal = tablas(original);
    const tablasCopia = tablas(copia);
    const conteoOriginal = contarFilas(original, tablasOriginal);
    const conteoCopia = contarFilas(copia, tablasCopia.filter(t => conteoOriginal.has(t)));

    const diferencias = [];
    for (const t of tablasOriginal) {
      const a = conteoOriginal.get(t);
      const b = conteoCopia.has(t) ? conteoCopia.get(t) : "falta";
      if (a !== b) diferencias.push({ tabla: t, original: a, copia: b });
    }
    for (const t of tablasCopia) {
      if (!conteoOriginal.has(t)) diferencias.push({ tabla: t, original: "falta", copia: "?" });
    }

    copia.close();
    copia = null;
    original.close();
    original = null;

    if (!integridadOk || diferencias.length > 0) {
      borrarSiExiste(parcial);
      console.error(`\nIntegridad        : ${integridadOk ? "ok" : integridad.slice(0, 10).join(" | ")}`);
      if (diferencias.length > 0) {
        console.error("Tablas con diferencia:");
        console.table(diferencias);
      }
      if (!integridadOk) {
        throw new Error("La copia NO pasó la verificación de integridad y se borró. Los respaldos anteriores quedaron intactos.");
      }
      throw new Error(
        "La copia se descartó por precaución: la integridad salió ok, pero el conteo de filas no coincide. " +
        "Lo más probable es que la app escribió durante la copia, no que la base esté dañada. " +
        "Vuelve a correr el job. Los respaldos anteriores quedaron intactos."
      );
    }

    fs.renameSync(parcial, destino);

    // ── 4. Retención, solo con la copia nueva ya verificada ──
    const borrados = [];
    const actuales = respaldosExistentes();
    for (const n of actuales.slice(0, Math.max(0, actuales.length - RETENER))) {
      fs.unlinkSync(path.join(dirRespaldos, n));
      borrados.push(n);
    }

    const quedan = respaldosExistentes().length;
    console.log("\n--------------------------------------------------------");
    console.log(`Respaldo          : ${destino}`);
    console.log(`Bytes .db         : ${bytesDb}`);
    console.log(`Bytes -wal        : ${bytesWal}`);
    console.log(`Bytes respaldo    : ${tamano(destino)}`);
    console.log("Integridad        : ok");
    console.log(`Tablas            : ${tablasOriginal.length}`);
    console.log("Con diferencia    : 0");
    console.log(`Borrados retención: ${borrados.length === 0 ? "ninguno" : borrados.join(", ")}`);
    console.log(`Copias que quedan : ${quedan} (RETENER=${RETENER})`);
    console.log(`Espacio libre     : ${espacioLibre(dirBase)} bytes (${mb(espacioLibre(dirBase))})`);
  } catch (err) {
    if (copia) copia.close();
    if (original) original.close();
    borrarSiExiste(parcial);
    throw err;
  }
}

try {
  main();
} catch (err) {
  console.error(`\n❌ ${err.message}`);
  process.exitCode = 1;
}
