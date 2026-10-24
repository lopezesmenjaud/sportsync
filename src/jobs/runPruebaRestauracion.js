// src/jobs/runPruebaRestauracion.js
//
// ENSAYO de restauración. NO toca producción: comprueba que un respaldo de
// /var/data/respaldos/ serviría para levantar la app, restaurándolo en un
// directorio temporal FUERA de /var/data.
//
// Qué hace, en orden:
//   1. Elige el respaldo: el de la variable RESPALDO (solo el nombre del archivo), o el más
//      reciente si no viene.
//   2. Lo copia a un directorio temporal (os.tmpdir()/prueba-restauracion-XXXX) con el nombre
//      que tendría la base, SIN ningún -wal ni -shm.
//   3. Comprueba que la copia sirve: integrity_check, esquema completo contra producción
//      (tablas, columnas, índices, vistas, triggers), conteo por tabla, consultas reales de los
//      repositorios y una escritura de prueba que se deshace con ROLLBACK.
//   4. Imprime el veredicto:
//        NO APTA         — el respaldo no sirve: integridad distinta de ok, una tabla esencial vacía,
//                          una consulta que truena o no devuelve nada, o no acepta escrituras.
//        APTA CON AVISO  — sirve, pero el esquema difiere de producción (normalmente un deploy que
//                          agregó algo después del respaldo). Lista qué y en qué dirección.
//        APTA            — ni una diferencia.
//   5. Borra el directorio temporal pase lo que pase: la copia trae los tokens de google_accounts.
//
// Producción se abre con { readonly: true } y /var/data/respaldos solo se lee. NO carga
// src/db/database.js ni llama a initializeDatabase(). De google_accounts solo se imprimen conteos.
// Procedimiento de restauración real: RESTAURAR-BASE.md en la raíz del repo.
//
// Uso:
//   Render: cd ~/project/src && NODE_ENV=production node src/jobs/runPruebaRestauracion.js
//   Otro respaldo: ... RESPALDO=sportsync-2026-10-23T1015Z.db node src/jobs/runPruebaRestauracion.js

const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const { dbPath, dirRespaldos, patronRespaldo } = require("./runRespaldoBase");

const dirBase = path.dirname(dbPath);

// Tablas sin las que la app no funciona: si producción tiene filas y el respaldo trae cero, no sirve.
const TABLAS_NUCLEO = ["google_accounts", "subscriptions", "calendar_events", "matches"];

function dentroDe(hijo, padre) {
  const rel = path.relative(path.resolve(padre), path.resolve(hijo));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function elegirRespaldo() {
  const pedido = process.env.RESPALDO;
  if (pedido) {
    const nombre = path.basename(pedido);
    if (!patronRespaldo.test(nombre)) {
      throw new Error(`RESPALDO="${pedido}" no tiene el nombre de un respaldo (sportsync-AAAA-MM-DDTHHMMZ.db).`);
    }
    const ruta = path.join(dirRespaldos, nombre);
    if (!fs.existsSync(ruta)) throw new Error(`No existe ${ruta}.`);
    return ruta;
  }
  if (!fs.existsSync(dirRespaldos)) throw new Error(`No existe la carpeta de respaldos ${dirRespaldos}.`);
  const nombres = fs.readdirSync(dirRespaldos).filter(n => patronRespaldo.test(n)).sort();
  if (nombres.length === 0) throw new Error(`No hay respaldos en ${dirRespaldos}.`);
  return path.join(dirRespaldos, nombres[nombres.length - 1]);
}

const normalizar = (sql) => (sql == null ? null : sql.replace(/\s+/g, " ").trim());
const citar = (nombre) => `"${nombre.replace(/"/g, '""')}"`;

// Foto del esquema: clave "tipo nombre" -> firma comparable.
function esquema(db) {
  const foto = new Map();
  const objetos = db.prepare(
    "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table', 'index', 'view', 'trigger') ORDER BY type, name"
  ).all();
  for (const o of objetos) {
    let firma;
    if (o.type === "table") {
      const columnas = db.prepare(`PRAGMA table_xinfo(${citar(o.name)})`).all()
        .map(c => `${c.name} ${c.type} notnull=${c.notnull} default=${c.dflt_value} pk=${c.pk} hidden=${c.hidden}`);
      firma = { columnas, sql: normalizar(o.sql) };
    } else if (o.type === "index") {
      const columnas = db.prepare(`PRAGMA index_xinfo(${citar(o.name)})`).all()
        .filter(c => c.key === 1)
        .map(c => `${c.name} desc=${c.desc} coll=${c.coll}`);
      firma = { tabla: o.tbl_name, columnas, sql: normalizar(o.sql) };
    } else {
      firma = { tabla: o.tbl_name, sql: normalizar(o.sql) };
    }
    foto.set(`${o.type} ${o.name}`, firma);
  }
  return foto;
}

// Diferencias separadas por dirección. En una tabla que existe en las dos, baja al nivel de
// columna: "lo tiene producción y le falta al respaldo" es justo lo que deja un deploy que agregó
// una columna después del respaldo.
function compararEsquemas(prod, rest) {
  const soloProduccion = [];
  const soloRespaldo = [];
  const distintos = [];
  for (const [clave, firma] of prod) {
    if (!rest.has(clave)) { soloProduccion.push(clave); continue; }
    const otra = rest.get(clave);
    if (JSON.stringify(firma) === JSON.stringify(otra)) continue;
    if (!clave.startsWith("table ")) { distintos.push(`${clave}: definición distinta`); continue; }

    const tabla = clave.slice("table ".length);
    const porNombre = (f) => new Map(f.columnas.map(c => [c.split(" ")[0], c]));
    const colsProd = porNombre(firma);
    const colsRest = porNombre(otra);
    let difColumnas = 0;
    for (const [nombre, def] of colsProd) {
      if (!colsRest.has(nombre)) { soloProduccion.push(`columna ${tabla}.${nombre}`); difColumnas++; }
      else if (colsRest.get(nombre) !== def) {
        distintos.push(`columna ${tabla}.${nombre}: producción "${def}" / respaldo "${colsRest.get(nombre)}"`);
        difColumnas++;
      }
    }
    for (const nombre of colsRest.keys()) {
      if (!colsProd.has(nombre)) { soloRespaldo.push(`columna ${tabla}.${nombre}`); difColumnas++; }
    }
    // Columnas iguales pero el CREATE distinto (una restricción, el orden): se reporta tal cual.
    if (difColumnas === 0) distintos.push(`${clave}: definición distinta`);
  }
  for (const clave of rest.keys()) {
    if (!prod.has(clave)) soloRespaldo.push(clave);
  }
  return { soloProduccion, soloRespaldo, distintos };
}

// Consultas REALES de los repositorios. Se corren igual en las dos bases y solo se reportan
// cuántas filas devolvieron. Los parámetros salen de la base restaurada, así que ahí deben
// devolver al menos una fila (salvo las marcadas como informativas).
function consultasReales(rest) {
  const ahora = new Date().toISOString();
  const en14dias = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();

  const unUsuarioConSubs = rest.prepare("SELECT DISTINCT userId FROM subscriptions ORDER BY userId ASC").pluck().get();
  const unaCuenta = rest.prepare("SELECT userId FROM google_accounts LIMIT 1").pluck().get();
  const unEvento = rest.prepare("SELECT userId, providerMatchId FROM calendar_events LIMIT 1").get();
  const unProximo = rest.prepare(
    "SELECT competitionKey, country FROM matches WHERE currentStartUtc >= ? AND competitionKey IS NOT NULL ORDER BY currentStartUtc ASC LIMIT 1"
  ).get(ahora);
  const unaSesion = rest.prepare("SELECT userId FROM sessions LIMIT 1").pluck().get();

  return [
    {
      nombre: "Suscripciones de un usuario",
      origen: "subscriptionRepositorySqlite.js:59-62 (getByUserId)",
      sql: "SELECT * FROM subscriptions WHERE userId = ? ORDER BY id ASC",
      params: [unUsuarioConSubs],
      hayParametro: unUsuarioConSubs != null,
    },
    {
      nombre: "Cuenta de Google de un usuario",
      origen: "googleAccountRepositorySqlite.js:78-81 (getByUserId)",
      sql: "SELECT * FROM google_accounts WHERE userId = ? LIMIT 1",
      params: [unaCuenta],
      hayParametro: unaCuenta != null,
    },
    {
      nombre: "Eventos de calendario de un usuario (lo que usa el backfill)",
      origen: "calendarEventRepositorySqlite.js:67-70 (getByUserId)",
      sql: "SELECT * FROM calendar_events WHERE userId = ? ORDER BY id ASC",
      params: [unEvento && unEvento.userId],
      hayParametro: unEvento != null,
    },
    {
      nombre: "Un evento de calendario por usuario y partido",
      origen: "calendarEventRepositorySqlite.js:103-105",
      sql: "SELECT * FROM calendar_events WHERE userId = ? AND providerMatchId = ?",
      params: unEvento ? [unEvento.userId, unEvento.providerMatchId] : [null, null],
      hayParametro: unEvento != null,
    },
    {
      nombre: "Partidos de una competencia con partidos próximos",
      origen: "matchRepositorySqlite.js:43 (getByCompetitionKey)",
      sql: "SELECT data FROM matches WHERE competitionKey = ?",
      params: [unProximo && unProximo.competitionKey],
      hayParametro: unProximo != null,
      parsearData: true,
    },
    {
      nombre: "Próximos 14 días de un país",
      origen: "matchRepositorySqlite.js:63-67 (getByCountryAndDates)",
      sql: "SELECT data FROM matches WHERE LOWER(country) = LOWER(?) AND currentStartUtc >= ? AND currentStartUtc <= ? ORDER BY currentStartUtc ASC",
      params: [unProximo && unProximo.country, ahora, en14dias],
      hayParametro: unProximo != null && unProximo.country != null,
      parsearData: true,
    },
    {
      nombre: "Sesiones vivas de un usuario",
      origen: "sessionRepositorySqlite.js:100-101",
      sql: "SELECT COUNT(*) AS n FROM sessions WHERE userId = ? AND revokedAtUtc IS NULL AND expiresAtUtc > ?",
      params: [unaSesion, ahora],
      hayParametro: unaSesion != null,
      informativa: true, // con sesiones vencidas, cero es correcto
    },
  ];
}

function correrConsulta(db, c) {
  const filas = db.prepare(c.sql).all(...c.params);
  // Igual que el repositorio: si data no es JSON válido, la app truena al leerlo.
  if (c.parsearData) for (const f of filas) JSON.parse(f.data);
  return filas.length;
}

function main() {
  const inicio = Date.now();
  const fallas = [];   // NO APTA
  const avisos = [];   // APTA CON AVISO
  let temporalSeQuedo = false;
  let tmp = null;
  let prod = null;
  let rest = null;

  console.log("========================================================");
  console.log(" ENSAYO DE RESTAURACIÓN  (producción solo se lee)");
  console.log(` Base de producción: ${dbPath}`);
  console.log("========================================================\n");

  try {
    if (!fs.existsSync(dbPath)) {
      throw new Error(`No existe la base en "${dbPath}". En Render hay que correrlo con NODE_ENV=production.`);
    }

    // ── 1. Elegir respaldo ──
    const respaldo = elegirRespaldo();
    const bytesRespaldo = fs.statSync(respaldo).size;
    console.log(`Respaldo elegido  : ${respaldo} (${mb(bytesRespaldo)})`);

    // ── 2. Directorio temporal, FUERA de la carpeta de la base ──
    const raizTmp = os.tmpdir();
    if (dentroDe(raizTmp, dirBase)) {
      throw new Error(`El directorio temporal ${raizTmp} cae dentro de ${dirBase}. No se hace nada.`);
    }
    const s = fs.statfsSync(raizTmp);
    const libreTmp = s.bavail * s.bsize;
    if (libreTmp < bytesRespaldo * 3) {
      throw new Error(`No hay espacio en ${raizTmp}: libre ${mb(libreTmp)}, se necesitan ${mb(bytesRespaldo * 3)}.`);
    }
    tmp = fs.mkdtempSync(path.join(raizTmp, "prueba-restauracion-"));
    const restaurada = path.join(tmp, path.basename(dbPath));
    fs.copyFileSync(respaldo, restaurada, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(restaurada, 0o600);
    console.log(`Restaurada en     : ${restaurada}`);
    console.log("-wal y -shm       : NO se copiaron. El respaldo es una base completa por sí sola; un");
    console.log("                    -wal o -shm de otra base pertenece a OTRA base y la corrompería.");
    for (const sufijo of ["-wal", "-shm"]) {
      if (fs.existsSync(restaurada + sufijo)) throw new Error(`Apareció ${restaurada}${sufijo} antes de abrir la base.`);
    }

    prod = new Database(dbPath, { readonly: true, fileMustExist: true });
    rest = new Database(restaurada, { fileMustExist: true });

    // ── 3a. Integridad ──
    const integridad = rest.prepare("PRAGMA integrity_check").pluck().all();
    const integridadOk = integridad.length === 1 && integridad[0] === "ok";
    console.log(`\nIntegridad        : ${integridadOk ? "ok" : integridad.slice(0, 10).join(" | ")}`);
    if (!integridadOk) fallas.push("integrity_check no devolvió ok");

    // ── 3b. Esquema completo ──
    const fotoProd = esquema(prod);
    const fotoRest = esquema(rest);
    const cuenta = (foto, tipo) => [...foto.keys()].filter(k => k.startsWith(tipo + " ")).length;
    console.log(`Esquema producción: ${cuenta(fotoProd, "table")} tablas, ${cuenta(fotoProd, "index")} índices, ${cuenta(fotoProd, "view")} vistas, ${cuenta(fotoProd, "trigger")} triggers`);
    console.log(`Esquema respaldo  : ${cuenta(fotoRest, "table")} tablas, ${cuenta(fotoRest, "index")} índices, ${cuenta(fotoRest, "view")} vistas, ${cuenta(fotoRest, "trigger")} triggers`);
    const dif = compararEsquemas(fotoProd, fotoRest);
    const totalDif = dif.soloProduccion.length + dif.soloRespaldo.length + dif.distintos.length;
    if (totalDif === 0) {
      console.log("Diferencias       : ninguna (columnas, índices, vistas y triggers iguales)");
    } else {
      console.log("Diferencias de esquema:");
      const bloque = (titulo, lista) => {
        if (lista.length === 0) return;
        console.log(`  ${titulo}:`);
        for (const d of lista) console.log(`    - ${d}`);
      };
      bloque("Lo tiene producción y le FALTA al respaldo", dif.soloProduccion);
      bloque("Lo tiene el respaldo y NO producción", dif.soloRespaldo);
      bloque("Existe en los dos pero distinto", dif.distintos);
      if (dif.soloProduccion.length > 0) {
        avisos.push(
          `a este respaldo le faltan ${dif.soloProduccion.length} cosa(s) que producción sí tiene. Lo PROBABLE es que ` +
          "la app las cree al arrancar (initializeDatabase en src/db/database.js usa CREATE ... IF NOT EXISTS y " +
          "addColumnIfNotExists), pero NO es seguro: addColumnIfNotExists se traga los errores en silencio. " +
          "Si después de restaurar algo falla con \"no such column\" o \"no such table\", ésta es la razón."
        );
      }
      if (dif.soloRespaldo.length > 0) {
        avisos.push(`el respaldo tiene ${dif.soloRespaldo.length} cosa(s) que producción ya no tiene; al restaurar, regresarían.`);
      }
      if (dif.distintos.length > 0) {
        avisos.push(`${dif.distintos.length} cosa(s) existen en los dos pero definidas distinto; al restaurar queda la versión del respaldo.`);
      }
    }

    // ── 3c. Conteo por tabla (el respaldo es de antes: que difiera es normal) ──
    const tablas = prod.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").pluck().all();
    const filasConteo = [];
    for (const t of tablas) {
      const p = prod.prepare(`SELECT count(*) FROM ${citar(t)}`).pluck().get();
      const r = fotoRest.has(`table ${t}`) ? rest.prepare(`SELECT count(*) FROM ${citar(t)}`).pluck().get() : "falta";
      filasConteo.push({ tabla: t, produccion: p, respaldo: r, diferencia: typeof r === "number" ? r - p : "" });
      if (TABLAS_NUCLEO.includes(t) && p > 0 && r === 0) {
        fallas.push(`${t} está vacía en el respaldo y producción tiene ${p} filas`);
      }
    }
    console.log("\nFilas por tabla (que difieran es normal: el respaldo es de antes):");
    console.table(filasConteo);

    // ── 3d. Consultas reales de la app ──
    console.log("\nConsultas reales de los repositorios (solo cuántas filas):");
    const resultados = [];
    for (const c of consultasReales(rest)) {
      const fila = { consulta: c.nombre, origen: c.origen, respaldo: "", produccion: "" };
      if (!c.hayParametro) {
        fila.respaldo = "sin datos para probar";
        resultados.push(fila);
        continue;
      }
      try {
        fila.respaldo = correrConsulta(rest, c);
        if (fila.respaldo === 0 && !c.informativa) {
          fallas.push(`"${c.nombre}" devolvió 0 filas en el respaldo`);
        }
      } catch (e) {
        fila.respaldo = `ERROR: ${e.message}`;
        fallas.push(`"${c.nombre}" falló en el respaldo: ${e.message}`);
      }
      try {
        fila.produccion = correrConsulta(prod, c);
      } catch (e) {
        fila.produccion = `ERROR: ${e.message}`;
      }
      resultados.push(fila);
    }
    console.table(resultados);

    // ── 3e. Que acepte escrituras como la abre la app (WAL), sin dejar nada ──
    try {
      const modo = rest.pragma("journal_mode = WAL", { simple: true });
      rest.exec("BEGIN; CREATE TABLE __prueba_escritura (x); INSERT INTO __prueba_escritura VALUES (1); ROLLBACK;");
      console.log(`\nEscritura de prueba: ok (journal_mode=${modo}, deshecha con ROLLBACK)`);
      if (modo !== "wal") fallas.push(`no pudo pasar a modo WAL (quedó en ${modo})`);
    } catch (e) {
      console.log(`\nEscritura de prueba: FALLÓ (${e.message})`);
      fallas.push(`no acepta escrituras: ${e.message}`);
    }
  } catch (e) {
    fallas.push(e.message);
  } finally {
    if (rest) rest.close();
    if (prod) prod.close();
    // ── 5. Borrar el temporal pase lo que pase ──
    if (tmp) {
      fs.rmSync(tmp, { recursive: true, force: true });
      console.log(`\nTemporal borrado  : ${tmp} (${fs.existsSync(tmp) ? "SIGUE AHÍ, bórralo a mano" : "ya no existe"})`);
      temporalSeQuedo = fs.existsSync(tmp);
    }
  }

  // ── 4. Veredicto ──
  console.log("\n========================================================");
  if (fallas.length > 0) {
    console.log(" VEREDICTO: NO APTA — este respaldo NO sirve para restaurar.");
    for (const m of fallas) console.log(`   - ${m}`);
  } else if (avisos.length > 0) {
    console.log(" VEREDICTO: APTA CON AVISO — serviría para restaurar, pero lee esto:");
    for (const m of avisos) console.log(`   - ${m}`);
  } else {
    console.log(" VEREDICTO: APTA — este respaldo serviría para restaurar la base.");
  }
  if (temporalSeQuedo) {
    console.log(` ATENCIÓN: el temporal ${tmp} NO se pudo borrar y trae los tokens de Google. Bórralo a mano.`);
  }
  console.log(` Duración: ${Date.now() - inicio} ms`);
  console.log("========================================================");
  if (fallas.length > 0 || temporalSeQuedo) process.exitCode = 1;
}

main();
