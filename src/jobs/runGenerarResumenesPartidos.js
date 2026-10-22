// src/jobs/runGenerarResumenesPartidos.js
//
// Genera el resumen con IA de la pantalla de partido de la app (/match/:matchId) y lo guarda en
// match_summary_cache. El endpoint POST /summary/:matchId NO genera: solo lee lo que deja este job.
// Así el costo lo manda el calendario y no el tráfico, y nadie puede disparar generaciones con
// solo llamar al endpoint.
//
// Qué partidos: los de las competencias públicas (catálogo + selecciones) que empiezan en los
// próximos 7 días, programados (no pospuestos, cancelados, en curso ni terminados), con dos
// equipos o con nombre de evento. Las prácticas de F1 se saltan: no se indexan y nadie las busca.
// A cada uno se le (re)genera si no tiene resumen o si cambió su firma (horario, estado, posición
// y puntos de cada equipo, canal verificado o sus siguientes partidos).
//
// Disciplina de escrituras masivas:
//   Sin CONFIRM=1 NO se escribe nada: imprime qué partidos tocaría y por qué.
//   SOLO=2487575,2494072  -> además GENERA esos (llama al modelo) e imprime el prompt y el
//                            resumen completos, sin guardar. SOLO no mira la ventana de 7 días.
//   CONFIRM=1 MAX=5       -> genera y GUARDA como mucho 5.
//   CONFIRM=1             -> genera y guarda todos los que hagan falta.
//   Se pueden combinar: CONFIRM=1 SOLO=2487575 guarda solo ése.
//
// Si el modelo falla, NO se guarda nada para ese partido.
// No llama a initializeDatabase(): usa la conexión de src/db/database.js, y la tabla la crea el
// servidor al arrancar. No toca google_accounts ni calendarios. NO está en el scheduler.
// Ojo: leer la tabla de posiciones la guarda en league_standings_cache (12 h), igual que en el job
// de equipos. Es caché del proveedor, no contenido.
//
// Dos formas de correrlo:
//   - A mano (abajo). Solo en ese caso termina con process.exit.
//   - Importado: generarResumenesPartidos({ confirm, max, solo, pausaMs }). Importar este archivo
//     NO corre nada ni termina el proceso.
//
// Uso (en Render):
//   cd ~/project/src && node src/jobs/runGenerarResumenesPartidos.js
//   cd ~/project/src && SOLO=2487575 node src/jobs/runGenerarResumenesPartidos.js
//   cd ~/project/src && CONFIRM=1 MAX=5 node src/jobs/runGenerarResumenesPartidos.js

const { TheSportsDbProvider } = require("../providers/theSportsDb");
const { partidosFuturos, vistaDelPartido } = require("../routes/partidoPublico");
const { matchRepository } = require("../repositories/matchRepositorySqlite");
const { matchSummaryCacheRepository } = require("../repositories/matchSummaryCacheRepositorySqlite");
const {
  reunirDatosDePartido, armarPromptPartido, generarResumen, motivoParaRechazar, PALABRAS_PROMPT, PALABRAS_AVISO,
} = require("../services/resumenPartido");

const VENTANA_MS = 7 * 24 * 60 * 60 * 1000;
const ESTADOS_SIN_PREVIO = new Set(["postponed", "cancelled", "live", "finished"]);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ¿Este partido lleva resumen? Devuelve null si sí, o el motivo por el que no.
function motivoParaSaltar(match) {
  if (ESTADOS_SIN_PREVIO.has(String(match.status || "").toLowerCase())) return `estado ${match.status}`;
  const vista = vistaDelPartido(match);
  if (!vista.esVersus && !String(match.eventName || "").trim()) return "sin equipos ni nombre de evento";
  if (vista.indexable === false) return "práctica de F1";
  return null;
}

async function generarResumenesPartidos({ confirm = false, max = Infinity, solo = [], pausaMs = 1000 } = {}) {
  const CONFIRM = confirm;
  const MAX = max;
  const SOLO = solo.map(String);
  const ahora = Date.now();
  const provider = new TheSportsDbProvider();
  const contador = { llamadas: 0 };

  let candidatos;
  if (SOLO.length) {
    candidatos = [];
    for (const id of SOLO) {
      const m = await matchRepository.getByProviderMatchId(id);
      if (m) candidatos.push(m);
      else console.log(`⚠ No está en matches: ${id}`);
    }
  } else {
    const futuros = await partidosFuturos(new Date(ahora).toISOString());
    candidatos = futuros.filter((m) => {
      const t = Date.parse(m.currentStartUtc || m.scheduledStartUtc || "");
      return Number.isFinite(t) && t - ahora <= VENTANA_MS;
    });
  }

  console.log("========================================================");
  console.log(` RESÚMENES DE PARTIDO  (${CONFIRM ? "CONFIRM=1: SE GUARDA" : "ensayo: NO se guarda nada"})`);
  console.log(` Partidos a revisar: ${candidatos.length}${Number.isFinite(MAX) ? ` | MAX=${MAX}` : ""}${SOLO.length ? ` | SOLO=${SOLO.join(",")}` : " | ventana: próximos 7 días"}`);
  console.log("========================================================");

  const resumen = { saltados: 0, vigentes: 0, porGenerar: 0, generados: 0, guardados: 0, fallidos: 0, llamadasModelo: 0 };

  for (const match of candidatos) {
    const id = match.providerMatchId;
    const nombre = vistaDelPartido(match).nombre;
    const motivoSalto = motivoParaSaltar(match);
    if (motivoSalto) { resumen.saltados += 1; if (SOLO.length) console.log(`  · ${id} ${nombre}: se salta (${motivoSalto})`); continue; }

    const datos = await reunirDatosDePartido(match, provider, contador);
    const guardado = await matchSummaryCacheRepository.get(id);
    if (guardado && guardado.firma === datos.firma && !SOLO.length) { resumen.vigentes += 1; continue; }

    const motivo = !guardado ? "no tiene resumen" : "cambió su firma";
    resumen.porGenerar += 1;

    // Sin CONFIRM y sin SOLO: solo se lista. No se llama al modelo.
    if (!CONFIRM && !SOLO.length) { console.log(`  · ${id} ${nombre}: se generaría — ${motivo}`); continue; }
    if (CONFIRM && resumen.guardados >= MAX) { console.log(`  · ${id}: pendiente (se alcanzó MAX=${MAX})`); continue; }

    const prompt = armarPromptPartido(datos);
    let r;
    try {
      resumen.llamadasModelo += 1;
      r = await generarResumen(prompt);
    } catch (error) {
      r = { texto: null, motivo: error.message };
    }
    await dormir(pausaMs);

    if (r.texto) {
      const rechazo = motivoParaRechazar(r.texto, datos);
      if (rechazo) {
        // Con SOLO se imprime el texto rechazado completo: sin verlo no se distingue un rechazo
        // correcto de un falso positivo del validador.
        if (SOLO.length) console.log(`
──────── ${id} · ${nombre} · RECHAZADO
PROMPT ENVIADO:
${prompt}

TEXTO RECHAZADO (${rechazo}):
${r.texto}
`);
        r = { texto: null, motivo: rechazo };
      }
    }
    if (!r.texto) {
      resumen.fallidos += 1;
      console.log(`  ✗ ${id} ${nombre}: el modelo no dio un resumen usable (${r.motivo}). NO se guarda nada.`);
      continue;
    }
    resumen.generados += 1;
    if (r.palabras > PALABRAS_AVISO) {
      console.warn(`  ⚠ ${id} ${nombre}: ${r.palabras} palabras (el prompt pide hasta ${PALABRAS_PROMPT}). Se publica igual; es aviso para ver si es sistemático.`);
    }

    if (SOLO.length && !CONFIRM) {
      console.log(`\n──────── ${id} · ${nombre} · ${r.palabras} palabras · ${motivo}`);
      console.log("PROMPT ENVIADO:\n" + prompt);
      console.log("\nRESUMEN (no se guardó):\n" + r.texto + "\n");
      continue;
    }

    // Antes de guardar se vuelve a calcular la firma: si algo cambió mientras se generaba, el
    // resumen ya nació viejo y no se guarda.
    const actual = await matchRepository.getByProviderMatchId(id);
    const firmaAhora = actual ? (await reunirDatosDePartido(actual, provider, contador)).firma : null;
    if (firmaAhora !== datos.firma) {
      resumen.fallidos += 1;
      console.log(`  ✗ ${id}: el partido cambió mientras se generaba. NO se guarda.`);
      continue;
    }
    await matchSummaryCacheRepository.set({ providerMatchId: id, summary: r.texto, firma: datos.firma });
    resumen.guardados += 1;
    console.log(`  ✓ ${id} ${nombre}: guardado (${r.palabras} palabras) — ${motivo}`);
  }

  console.log("\n========================================================");
  console.log(` Saltados (pospuestos, en curso, prácticas de F1…): ${resumen.saltados}`);
  console.log(` Con resumen vigente (no se toca):                  ${resumen.vigentes}`);
  console.log(` Por generar:                                       ${resumen.porGenerar}`);
  console.log(` Generados: ${resumen.generados} | guardados: ${resumen.guardados} | fallidos: ${resumen.fallidos}`);
  console.log(` Llamadas al modelo: ${resumen.llamadasModelo} | a TheSportsDB (tablas): ${contador.llamadas}`);
  if (!CONFIRM) console.log(" Ensayo: no se escribió nada. Para guardar, CONFIRM=1 (y MAX=5 la primera vez).");
  console.log("========================================================");
  return resumen;
}

module.exports = { generarResumenesPartidos, motivoParaSaltar };

if (require.main === module) {
  generarResumenesPartidos({
    confirm: process.env.CONFIRM === "1",
    max: process.env.MAX ? Number(process.env.MAX) : Infinity,
    solo: String(process.env.SOLO || "").split(",").map((x) => x.trim()).filter(Boolean),
    pausaMs: Number(process.env.PAUSA_MS || 1000),
  }).then(() => process.exit(0)).catch((err) => {
    console.error("❌ Error en el job:", err.message);
    process.exit(1);
  });
}
