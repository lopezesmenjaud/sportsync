// src/jobs/runCompararSuscripcionesSelecciones.js
//
// Comparador SOLO LECTURA: ¿agregar las suscripciones de selecciones cambia el comportamiento de
// alguna suscripción que YA existe? Se corre ANTES de conectar la regla nueva.
//
// matchAppliesToSubscription alimenta la sincronización de calendarios, el backfill y la limpieza
// de abandonados; isInclusionReason decide lo que se ve en "Próximos partidos". El cambio tiene
// que ser una PURA ADICIÓN: para cada combinación partido × suscripción que existe hoy en
// producción, la regla nueva tiene que dar EXACTAMENTE lo mismo que la vieja. Cero diferencias.
//
// VIEJA = el código que está DESPLEGADO hoy (subscriptionMatchService.js, sin tocar).
// NUEVA = la vieja más la rama de selecciones, compuesta aquí EXACTAMENTE como se va a conectar:
//   matchAppliesToSubscription: después de la comprobación de deporte,
//     si esSuscripcionDeSelecciones(sub) -> casaConSuscripcionDeSelecciones(partido, sub).
//   isInclusionReason: después de la comprobación de deporte y de la rama de tenis, lo mismo.
// Si el job detecta que la rama ya está desplegada, lo dice: en ese caso ya no mide el "antes".
//
// DISCIPLINA:
//   - Su propia conexión a la base es { readonly: true }.
//   - Para cargar el predicado real hay que cargar subscriptionMatchService, que trae a
//     database.js por los repositorios. Aquí database.js se REEMPLAZA en memoria por uno que
//     truena si alguien intenta usarlo: nada de ese lado puede leer ni escribir, y nunca se llama
//     a initializeDatabase(). Los dos predicados no tocan la base; si algún día lo hicieran, el
//     job truena en vez de medir otra cosa.
//   - Cero llamadas al proveedor.
//
// Uso (en Render):
//   cd ~/project/src && NODE_ENV=production node src/jobs/runCompararSuscripcionesSelecciones.js

const path = require("path");
const Database = require("better-sqlite3");

// ── database.js falso, ANTES de cargar nada que lo requiera ──
const rutaDatabase = require.resolve("../db/database");
const prohibido = new Proxy({}, {
  get(_, prop) {
    throw new Error(`[comparador] Algo intentó usar database.js (${String(prop)}). Este job no deja tocar la base por ese lado.`);
  },
});
require.cache[rutaDatabase] = {
  id: rutaDatabase, filename: rutaDatabase, loaded: true,
  exports: { db: prohibido, betterDb: prohibido, initializeDatabase: () => { throw new Error("[comparador] initializeDatabase() está prohibido aquí."); } },
};

const { matchAppliesToSubscription: viejaAplica, isInclusionReason: viejaInclusion } = require("../services/subscriptionMatchService");
const { normalizeSport } = require("../services/syncService");
const {
  esSuscripcionDeSelecciones,
  casaConSuscripcionDeSelecciones,
  esClaveDeSuscripcionSelecciones,
  suscripciones: catorce,
} = require("../services/seleccionesConfederaciones");

const dbPath = process.env.NODE_ENV === "production"
  ? "/var/data/sportsync.db"
  : path.resolve(__dirname, "../../sportsync.db");

// ── La regla NUEVA, compuesta como se va a conectar ──
function nuevaAplica(match, sub) {
  if (!esSuscripcionDeSelecciones(sub)) return viejaAplica(match, sub);
  if (sub.sport && normalizeSport(sub.sport) !== normalizeSport(match.sport)) return false;
  return casaConSuscripcionDeSelecciones(match, sub);
}

function nuevaInclusion(match, sub) {
  if (!esSuscripcionDeSelecciones(sub)) return viejaInclusion(match, sub);
  if (normalizeSport(sub.sport) !== normalizeSport(match.sport)) return false;
  return casaConSuscripcionDeSelecciones(match, sub);
}

function main() {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const subs = db.prepare("SELECT * FROM subscriptions").all();
  const partidos = db.prepare("SELECT * FROM matches").all();
  db.close();

  console.log("========================================================");
  console.log(" SUSCRIPCIONES DE SELECCIONES: ¿PURA ADICIÓN?  (solo lectura)");
  console.log(` Base: ${dbPath}`);
  console.log("========================================================");
  console.log(`Suscripciones: ${subs.length}   Partidos en matches: ${partidos.length}`);

  // ¿La rama ya está desplegada? Un partido de Nations League contra "concacaf-varonil": la vieja
  // dice false (la clave no coincide), la nueva dice true.
  const prueba = { sport: "football", competitionKey: "5280", competitionName: "CONCACAF Nations League", homeParticipantName: "A", awayParticipantName: "B" };
  const subPrueba = { sport: "futbol", competitionKey: "concacaf-varonil", teamName: null };
  const yaDesplegada = viejaAplica(prueba, subPrueba) === true;
  console.log(yaDesplegada
    ? "⚠ La regla de selecciones YA está desplegada: esta corrida compara la nueva contra sí misma y no mide el antes."
    : "Regla desplegada: la VIEJA (sin selecciones). La comparación mide el antes contra el después.");

  // 1. Nadie debe tener hoy una suscripción con las claves nuevas.
  const conClaveNueva = subs.filter(s => esClaveDeSuscripcionSelecciones(s.competitionKey));
  const deSelecciones = subs.filter(esSuscripcionDeSelecciones);
  const nationalViejas = subs.filter(s => String(s.competitionKey || "").startsWith("national_"));
  console.log("\n1) SUSCRIPCIONES QUE YA USAN UNA DE LAS 14 CLAVES  (tiene que ser 0)");
  console.log(`   Con clave nueva: ${conClaveNueva.length}   (de ellas, por confederación sin teamName: ${deSelecciones.length})`);
  if (conClaveNueva.length) console.table(conClaveNueva.map(s => ({ id: s.id, sport: s.sport, competitionKey: s.competitionKey, teamName: s.teamName })));
  console.log(`   (Informativo) suscripciones viejas national_: ${nationalViejas.length}`);

  // 2. Todas las combinaciones.
  let combinaciones = 0;
  let aplicaSi = 0;
  const difAplica = [];
  const difInclusion = [];
  for (const s of subs) {
    for (const m of partidos) {
      combinaciones += 1;
      const va = viejaAplica(m, s), na = nuevaAplica(m, s);
      if (va) aplicaSi += 1;
      if (va !== na) difAplica.push({ sub: s.id, competitionKey: s.competitionKey, teamName: s.teamName, partido: m.providerMatchId, vieja: va, nueva: na });
      const vi = viejaInclusion(m, s), ni = nuevaInclusion(m, s);
      if (vi !== ni) difInclusion.push({ sub: s.id, competitionKey: s.competitionKey, teamName: s.teamName, partido: m.providerMatchId, vieja: vi, nueva: ni });
    }
  }
  console.log(`\n2) COMPARACIÓN: ${combinaciones.toLocaleString("es-MX")} combinaciones partido × suscripción`);
  console.log(`   (en ${aplicaSi.toLocaleString("es-MX")} de ellas la suscripción cubre al partido hoy)`);
  console.log(`   matchAppliesToSubscription — diferencias (tiene que ser 0): ${difAplica.length}`);
  console.log(`   isInclusionReason          — diferencias (tiene que ser 0): ${difInclusion.length}`);
  if (difAplica.length) { console.table(difAplica.slice(0, 30)); }
  if (difInclusion.length) { console.table(difInclusion.slice(0, 30)); }
  if (difAplica.length || difInclusion.length) {
    console.log("   🛑 PARA: la regla nueva cambia suscripciones que ya existen. No se conecta.");
  }

  // 3. Informativo: qué recibirían hoy las 14 suscripciones nuevas con lo que ya hay en matches.
  console.log("\n3) (Informativo) PARTIDOS QUE HOY RECIBIRÍA CADA SUSCRIPCIÓN NUEVA, con lo que ya hay en matches");
  console.table(catorce.map(c => {
    const sub = { sport: "futbol", competitionKey: c.clave, teamName: null };
    return { clave: c.clave, competencias: c.competencias.length, partidos: partidos.filter(m => nuevaAplica(m, sub)).length };
  }));
  console.log("   Es normal que salgan en 0: nadie sigue esas competencias y el sync no las ha bajado.");

  console.log("\nListo. No se escribió nada.");
}

// Se exportan las dos reglas para poder probarlas con datos armados a mano, sin base.
module.exports = { nuevaAplica, nuevaInclusion, viejaAplica, viejaInclusion };

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("❌ Error en el comparador:", err);
    process.exit(1);
  }
}
