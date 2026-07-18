// src/jobs/runDiagnoseSubscriptions.js
//
// Diagnóstico SOLO LECTURA del matching suscripción -> evento de calendario.
// NO modifica nada: únicamente ejecuta SELECTs y los imprime.
//
// Contexto: usuarios reportan eventos en su calendario de ligas que NO siguen.
// Este script busca dónde se cuela el matching.
//
// La ruta de la DB viene de src/db/database.js (local vs /var/data según
// NODE_ENV), NO está hardcodeada.
//
// Uso:
//   Local:   node src/jobs/runDiagnoseSubscriptions.js
//   Render:  NODE_ENV=production node src/jobs/runDiagnoseSubscriptions.js

require("dotenv").config();

const { db } = require("../db/database");

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

// Nombre legible de un partido para los ejemplos.
function matchLabel(m) {
  if (!m || (m.sport == null && m.competitionKey == null && m.eventName == null)) {
    return "(match no encontrado en tabla matches)";
  }
  if (m.homeParticipantName && m.awayParticipantName) {
    return `${m.homeParticipantName} vs ${m.awayParticipantName}`;
  }
  return m.eventName || m.competitionName || "(sin nombre)";
}

// Trata null/"" como "sin valor".
function isEmpty(v) {
  return v == null || String(v).trim() === "";
}

async function main() {
  console.log("========================================================");
  console.log(" DIAGNÓSTICO DE SUSCRIPCIONES vs EVENTOS  (solo lectura)");
  console.log("========================================================\n");

  // ── 1) Todas las suscripciones ─────────────────────────────────────────
  console.log("1) TODAS LAS SUSCRIPCIONES");
  const subs = await all(
    "SELECT userId, sport, competitionKey, teamName FROM subscriptions ORDER BY userId, sport, competitionKey"
  );
  console.table(subs);
  console.log(`   Total suscripciones: ${subs.length}\n`);

  // ── 2) Eventos por usuario y liga (JOIN calendar_events + matches) ──────
  console.log("2) EVENTOS POR USUARIO Y LIGA  (de qué ligas tiene eventos cada usuario)");
  const eventsByLeague = await all(`
    SELECT
      ce.userId                         AS userId,
      m.sport                           AS sport,
      m.competitionKey                  AS competitionKey,
      m.competitionName                 AS competitionName,
      COUNT(*)                          AS eventos
    FROM calendar_events ce
    LEFT JOIN matches m ON m.providerMatchId = ce.providerMatchId
    GROUP BY ce.userId, m.sport, m.competitionKey
    ORDER BY ce.userId, eventos DESC
  `);
  console.table(eventsByLeague);
  console.log(`   Filas (combinaciones usuario/liga): ${eventsByLeague.length}\n`);

  // ── 3) Partidos con datos incompletos ──────────────────────────────────
  console.log("3) PARTIDOS CON DATOS INCOMPLETOS  (competitionKey o sport nulos/vacíos)");
  const incompleteMatches = await all(`
    SELECT
      COALESCE(NULLIF(TRIM(sport), ''), '(vacío/null)')  AS sport,
      SUM(CASE WHEN competitionKey IS NULL OR TRIM(competitionKey) = '' THEN 1 ELSE 0 END) AS sinCompetitionKey,
      SUM(CASE WHEN sport IS NULL OR TRIM(sport) = '' THEN 1 ELSE 0 END)                   AS sinSport,
      COUNT(*)                                                                              AS totalFilasAfectadas
    FROM matches
    WHERE competitionKey IS NULL OR TRIM(competitionKey) = ''
       OR sport IS NULL OR TRIM(sport) = ''
    GROUP BY COALESCE(NULLIF(TRIM(sport), ''), '(vacío/null)')
    ORDER BY totalFilasAfectadas DESC
  `);
  if (incompleteMatches.length === 0) {
    console.log("   (ningún partido con datos incompletos)\n");
  } else {
    console.table(incompleteMatches);
    console.log("");
  }

  // ── 4) DISCREPANCIAS: ligas con eventos a las que el usuario NO se suscribió ──
  console.log("4) DISCREPANCIAS  (ligas de las que el usuario tiene eventos pero NO sigue)");

  // competitionKeys suscritas y equipos seguidos, por usuario.
  const subscribedKeysByUser = new Map(); // userId -> Set(competitionKey)
  const teamsByUser = new Map();          // userId -> Set(teamName)
  for (const s of subs) {
    if (!subscribedKeysByUser.has(s.userId)) subscribedKeysByUser.set(s.userId, new Set());
    if (!teamsByUser.has(s.userId)) teamsByUser.set(s.userId, new Set());
    if (!isEmpty(s.competitionKey)) subscribedKeysByUser.get(s.userId).add(String(s.competitionKey));
    if (!isEmpty(s.teamName)) teamsByUser.get(s.userId).add(s.teamName);
  }

  const discrepancies = []; // { userId, sport, competitionKey, competitionName, eventos }
  const orphanOrNoKey = []; // eventos cuyo match no tiene competitionKey (o no existe)
  for (const row of eventsByLeague) {
    if (isEmpty(row.competitionKey)) {
      orphanOrNoKey.push(row);
      continue;
    }
    const subscribed = subscribedKeysByUser.get(row.userId) || new Set();
    if (!subscribed.has(String(row.competitionKey))) {
      discrepancies.push(row);
    }
  }

  if (discrepancies.length === 0) {
    console.log("   ✅ Ninguna discrepancia por competitionKey: cada usuario solo tiene eventos de ligas suscritas.");
  } else {
    console.log("   ⚠️ Un usuario tiene eventos de estas ligas SIN estar suscrito a ellas:");
    console.table(discrepancies);
    console.log("   NOTA: una suscripción por EQUIPO (competitionKey null) puede generar");
    console.log("   eventos legítimos en varias ligas. Equipos seguidos por usuario:");
    for (const [userId, teams] of teamsByUser.entries()) {
      if (teams.size > 0) console.log(`     - ${userId}: [${[...teams].join(", ")}]`);
    }
  }

  if (orphanOrNoKey.length > 0) {
    console.log("\n   (Aparte) Eventos cuyo match no tiene competitionKey o no existe en 'matches':");
    console.table(orphanOrNoKey);
  }
  console.log("");

  // ── 5) Ejemplos concretos por discrepancia ─────────────────────────────
  console.log("5) EJEMPLOS DE PARTIDOS EN LAS DISCREPANCIAS  (hasta 3 por caso)");
  if (discrepancies.length === 0) {
    console.log("   (sin discrepancias que ejemplificar)");
  } else {
    for (const d of discrepancies) {
      console.log(`\n   ▸ userId=${d.userId}  liga=${d.competitionKey} (${d.competitionName || "?"})  sport=${d.sport || "?"}  eventos=${d.eventos}`);
      const examples = await all(`
        SELECT ce.providerMatchId AS providerMatchId,
               m.eventName, m.homeParticipantName, m.awayParticipantName,
               m.competitionName, m.sport, m.competitionKey
        FROM calendar_events ce
        LEFT JOIN matches m ON m.providerMatchId = ce.providerMatchId
        WHERE ce.userId = ? AND m.competitionKey = ?
        LIMIT 3
      `, [d.userId, d.competitionKey]);
      const shaped = examples.map((m) => ({
        providerMatchId: m.providerMatchId,
        evento: matchLabel(m),
        sport: m.sport,
        competitionKey: m.competitionKey,
      }));
      console.table(shaped);
    }
  }

  console.log("\n========================================================");
  console.log(" FIN DEL DIAGNÓSTICO (no se modificó nada)");
  console.log("========================================================");
}

main()
  .then(() => {
    db.close();
    process.exit(0);
  })
  .catch((err) => {
    console.error("[diagnose] FALLÓ:", err.message);
    db.close();
    process.exit(1);
  });
