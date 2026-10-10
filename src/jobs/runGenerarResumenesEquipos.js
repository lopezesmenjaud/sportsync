// src/jobs/runGenerarResumenesEquipos.js
//
// Genera el resumen con IA de las páginas públicas de equipo (/equipo/:slug) y lo guarda en
// team_summary_cache. La página NUNCA genera: está en el CDN, tiene que contestar rápido y el primer
// visitante puede ser Googlebot. Solo lee lo que deja este job.
//
// Qué equipos: los del índice de la página pública que tienen al menos un partido próximo (los
// que no tienen llevan noindex y no se les escribe nada). A cada uno se le (re)genera si no tiene
// resumen, si el que tiene pasó de 7 días, o si cambiaron sus próximos partidos (la firma).
//
// Disciplina de escrituras masivas:
//   Sin CONFIRM=1 NO se escribe nada: imprime qué equipos tocaría y por qué.
//   SOLO=chivas,dallas-cowboys   -> además GENERA esos (llama al modelo) e imprime el resumen
//                                   completo y el prompt, sin guardar. Para revisarlos antes.
//   CONFIRM=1 MAX=5              -> genera y GUARDA como mucho 5.
//   CONFIRM=1                    -> genera y guarda todos los que hagan falta.
//   Se pueden combinar: CONFIRM=1 SOLO=chivas guarda solo ése.
//
// Si el modelo falla, NO se guarda nada para ese equipo (su página sigue sin resumen).
// No llama a initializeDatabase(): usa la conexión de src/db/database.js, igual que los demás jobs
// que escriben, y las tablas ya las creó el servidor al arrancar.
//
// Uso (en Render):
//   cd ~/project/src && SOLO=chivas,barcelona,dallas-cowboys node src/jobs/runGenerarResumenesEquipos.js
//   cd ~/project/src && CONFIRM=1 MAX=5 node src/jobs/runGenerarResumenesEquipos.js
//   cd ~/project/src && CONFIRM=1 node src/jobs/runGenerarResumenesEquipos.js

const { TheSportsDbProvider } = require("../providers/theSportsDb");
const { indiceEquipos, proximosDeEquipo, firmaDePartidos, resumenVigente } = require("../routes/partidoPublico");
const { teamSummaryCacheRepository } = require("../repositories/teamSummaryCacheRepositorySqlite");
const { reunirDatosDeEquipo, armarPrompt, generarResumen } = require("../services/resumenEquipo");

const CONFIRM = process.env.CONFIRM === "1";
const MAX = process.env.MAX ? Number(process.env.MAX) : Infinity;
const SOLO = String(process.env.SOLO || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
const PAUSA_MS = Number(process.env.PAUSA_MS || 1000);

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const ahora = new Date();
  const provider = new TheSportsDbProvider();
  const contador = { llamadas: 0 };

  const indice = await indiceEquipos();
  let equipos = [...indice.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  if (SOLO.length) {
    const faltan = SOLO.filter((s) => !indice.has(s));
    if (faltan.length) console.log(`⚠ Estos slugs no están en el índice de equipos: ${faltan.join(", ")}`);
    equipos = equipos.filter((e) => SOLO.includes(e.slug));
  }

  console.log("========================================================");
  console.log(` RESÚMENES DE EQUIPO  (${CONFIRM ? "CONFIRM=1: SE GUARDA" : "ensayo: NO se guarda nada"})`);
  console.log(` Equipos a revisar: ${equipos.length}${Number.isFinite(MAX) ? ` | MAX=${MAX}` : ""}${SOLO.length ? ` | SOLO=${SOLO.join(",")}` : ""}`);
  console.log("========================================================");

  const resumen = { sinProximos: 0, vigentes: 0, porGenerar: 0, generados: 0, guardados: 0, fallidos: 0, llamadasModelo: 0 };

  for (const equipo of equipos) {
    const partidos = await proximosDeEquipo(equipo.base, ahora.toISOString());
    if (!partidos.length) { resumen.sinProximos += 1; continue; }

    const firma = firmaDePartidos(partidos);
    const guardado = await teamSummaryCacheRepository.get(equipo.slug);
    if (resumenVigente(guardado, firma, ahora.getTime()) && !SOLO.length) { resumen.vigentes += 1; continue; }

    const motivo = !guardado ? "no tiene resumen"
      : guardado.firma !== firma ? "cambiaron sus próximos partidos"
      : "pasó de 7 días";
    resumen.porGenerar += 1;

    // Sin CONFIRM y sin SOLO: solo se lista. No se llama al modelo.
    if (!CONFIRM && !SOLO.length) {
      console.log(`  · ${equipo.slug} (${equipo.nombre}): se generaría — ${motivo}`);
      continue;
    }
    if (CONFIRM && resumen.guardados >= MAX) {
      console.log(`  · ${equipo.slug}: pendiente (se alcanzó MAX=${MAX})`);
      continue;
    }

    const datos = await reunirDatosDeEquipo(equipo, provider, contador, ahora);
    const prompt = armarPrompt(datos);
    let r;
    try {
      resumen.llamadasModelo += 1;
      r = await generarResumen(prompt);
    } catch (error) {
      r = { texto: null, motivo: error.message };
    }
    await dormir(PAUSA_MS);

    if (!r.texto) {
      resumen.fallidos += 1;
      console.log(`  ✗ ${equipo.slug}: el modelo no dio un resumen usable (${r.motivo}). NO se guarda nada.`);
      continue;
    }
    resumen.generados += 1;

    if (SOLO.length && !CONFIRM) {
      console.log(`\n──────── ${equipo.slug} (${equipo.nombre}) · ${r.palabras} palabras · ${motivo}`);
      console.log("PROMPT ENVIADO:\n" + prompt);
      console.log("\nRESUMEN (no se guardó):\n" + r.texto + "\n");
      continue;
    }

    // Antes de guardar se vuelve a calcular la firma: si un partido arrancó mientras se generaba,
    // el resumen ya nació viejo y no se guarda.
    const firmaAhora = firmaDePartidos(await proximosDeEquipo(equipo.base, new Date().toISOString()));
    if (firmaAhora !== datos.firma) {
      resumen.fallidos += 1;
      console.log(`  ✗ ${equipo.slug}: sus próximos partidos cambiaron mientras se generaba. NO se guarda.`);
      continue;
    }
    await teamSummaryCacheRepository.set({ slug: equipo.slug, teamName: equipo.base, summary: r.texto, firma: datos.firma });
    resumen.guardados += 1;
    console.log(`  ✓ ${equipo.slug}: guardado (${r.palabras} palabras) — ${motivo}`);
  }

  console.log("\n========================================================");
  console.log(` Sin próximos partidos (no se escribe): ${resumen.sinProximos}`);
  console.log(` Con resumen vigente (no se toca):     ${resumen.vigentes}`);
  console.log(` Por generar:                           ${resumen.porGenerar}`);
  console.log(` Generados: ${resumen.generados} | guardados: ${resumen.guardados} | fallidos: ${resumen.fallidos}`);
  console.log(` Llamadas al modelo: ${resumen.llamadasModelo} | a TheSportsDB (tablas): ${contador.llamadas}`);
  if (!CONFIRM) console.log(" Ensayo: no se escribió nada. Para guardar, CONFIRM=1 (y MAX=5 la primera vez).");
  console.log("========================================================");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("❌ Error en el job:", err.message);
  process.exit(1);
});
