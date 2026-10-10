// src/services/resumenEquipo.js
//
// Resumen escrito con IA de una página pública de equipo (/equipo/:slug). Lo usa SOLO el job
// runGenerarResumenesEquipos; la página nunca genera, solo lee team_summary_cache.
//
// Misma infraestructura que el resumen de partidos (getSmartSummary en server.js): la API de
// Anthropic, ANTHROPIC_MODEL, readAnthropicText y process.env.ANTHROPIC_API_KEY. Pero NO su diseño
// de datos: aquel recibe cuatro campos y por eso inventa. Éste recibe datos reales y el prompt le
// prohíbe salirse de ellos. Si un dato no existe, su renglón NO va en el prompt.
//
// Datos:
//   - la tabla de posiciones del proveedor, solo Liga MX, La Liga y Premier (tablaPosiciones.js);
//   - los próximos partidos que la página ya muestra (proximosDeEquipo), con la misma fecha en
//     texto, el mismo rival y la misma competencia que ve la persona;
//   - el "dónde verlo" de la página (canalDelPartido), solo si es el MISMO en todos sus próximos
//     partidos: el canal de Liga MX es el del equipo LOCAL, así que el de un partido de visita es
//     otro y no se puede afirmar uno solo.

const {
  proximosDeEquipo,
  vistaDelPartido,
  instante,
  fechaEnTexto,
  canalDelPartido,
  firmaDePartidos,
} = require("../routes/partidoPublico");
const { obtenerTablaDePosiciones, filaDeEquipo, queEstaEnJuegoEnEspanol, tieneTabla } = require("./tablaPosiciones");
const { ANTHROPIC_MODEL, readAnthropicText } = require("../config/aiModel");
const COMPETENCIAS = require("../data/competencias.json");

const NOMBRE_PUBLICO = new Map(COMPETENCIAS.competencias.map((c) => [String(c.clave), c.nombrePublico]));
// strForm: W = victoria, D = empate, L = derrota. Se usa como CUENTA, nunca como secuencia.
const FORMA = { W: ["victoria", "victorias"], D: ["empate", "empates"], L: ["derrota", "derrotas"] };

const conValor = (v) => v !== null && v !== undefined && String(v).trim() !== "";

// Todo lo que el prompt puede decir de un equipo, ya resuelto. Ningún campo se inventa: lo que
// no se sabe queda en null y su renglón no se escribe.
async function reunirDatosDeEquipo(equipo, provider, contador, ahora = new Date()) {
  const partidos = await proximosDeEquipo(equipo.base, ahora.toISOString());

  // Tabla: la primera de sus ligas con tabla donde aparece con su nombre EXACTO de los partidos.
  let fila = null;
  let totalTabla = null;
  let ligaTabla = null;
  for (const clave of equipo.claves || []) {
    if (!tieneTabla(clave)) continue;
    const tabla = await obtenerTablaDePosiciones(clave, provider, contador);
    const encontrada = filaDeEquipo(tabla, equipo.base);
    if (encontrada) {
      fila = encontrada;
      totalTabla = tabla.standings.length;
      ligaTabla = String(clave);
      break;
    }
  }

  const proximos = [];
  for (const m of partidos) {
    const vista = vistaDelPartido(m);
    const fecha = instante(m);
    const esLocal = m.homeParticipantName === equipo.base;
    const rival = esLocal ? vista.nombreVisita : vista.nombreLocal;
    if (!fecha || !rival) continue;
    proximos.push({
      fecha: fechaEnTexto(fecha),
      condicion: esLocal ? "local" : "visitante",
      rival,
      competencia: vista.competencia,
      canal: canalDelPartido(vista),
    });
  }

  // Competencias: la de la tabla primero, luego las de sus próximos partidos, sin repetir.
  const competencias = [];
  if (ligaTabla && NOMBRE_PUBLICO.get(ligaTabla)) competencias.push(NOMBRE_PUBLICO.get(ligaTabla));
  for (const p of proximos) if (p.competencia && !competencias.includes(p.competencia)) competencias.push(p.competencia);

  // Dónde verlo: solo si TODOS sus próximos partidos tienen el mismo canal conocido.
  const canales = [...new Set(proximos.map((p) => p.canal))];
  const canal = canales.length === 1 && canales[0] ? canales[0] : null;

  return {
    equipo: equipo.nombre,
    competencias,
    fila,
    totalTabla,
    proximos,
    canal,
    firma: firmaDePartidos(partidos),
  };
}

// "LDWWD" -> { partidos: 5, texto: "2 victorias, 2 empates, 1 derrota" }.
//
// Es una CUENTA a propósito: no sabemos en qué orden manda el proveedor las letras (si la más
// reciente va primero o al final), y como secuencia el modelo la contaba como racha. La cuenta es
// la misma en cualquier orden. Los resultados en cero no se mencionan. Si trae una letra que no es
// W, D o L, null: no se cuenta a medias.
function formaEnCuenta(strForm) {
  const letras = String(strForm || "").trim().toUpperCase().split("").filter(Boolean);
  if (!letras.length || letras.some((l) => !FORMA[l])) return null;
  const partes = [];
  for (const l of ["W", "D", "L"]) {
    const n = letras.filter((x) => x === l).length;
    if (n > 0) partes.push(`${n} ${n === 1 ? FORMA[l][0] : FORMA[l][1]}`);
  }
  return { partidos: letras.length, texto: partes.join(", ") };
}

// El prompt, TAL CUAL lo definió Julio, con el bloque DATOS armado solo con lo que existe.
function armarPrompt(d) {
  const datos = [`Equipo: ${d.equipo}`];
  if (d.competencias.length) datos.push(`Competencia: ${d.competencias.join(" y ")}`);
  const f = d.fila;
  if (f && conValor(f.intRank) && d.totalTabla) datos.push(`Posición: ${f.intRank} de ${d.totalTabla} equipos`);
  if (f && [f.intWin, f.intDraw, f.intLoss, f.intPlayed].every(conValor)) {
    datos.push(`Récord: ${f.intWin} ganados, ${f.intDraw} empatados, ${f.intLoss} perdidos en ${f.intPlayed} jugados`);
  }
  if (f && conValor(f.intPoints)) datos.push(`Puntos: ${f.intPoints}`);
  const forma = f ? formaEnCuenta(f.strForm) : null;
  if (forma) {
    // Casi siempre son cinco; a principio de temporada pueden ser menos, y entonces se dice cuántos.
    const etiqueta = forma.partidos === 5 ? "Últimos cinco partidos" : `Últimos ${forma.partidos} partidos`;
    datos.push(`${etiqueta}: ${forma.texto}`);
  }
  // SOLO en español (src/data/tablaPosiciones.json). Si no hay traducción, el renglón no va.
  const enJuego = f ? queEstaEnJuegoEnEspanol(f.strDescription) : null;
  if (enJuego) datos.push(`Qué está en juego esa posición: ${enJuego}`);
  if (d.proximos.length) {
    datos.push("Próximos partidos:");
    for (const p of d.proximos) {
      datos.push(`- ${p.fecha} — ${p.condicion} contra ${p.rival}${p.competencia ? ` (${p.competencia})` : ""}`);
    }
  }
  if (d.canal) datos.push(`Dónde verlo en México: ${d.canal}`);

  return [
    "Escribes la ficha pública de un equipo en FanSchedule, un sitio en español de México que agenda partidos en Google Calendar.",
    "",
    "Escribe 2 o 3 párrafos sobre este equipo usando ÚNICAMENTE los datos de abajo.",
    "",
    "REGLA ABSOLUTA: no afirmes nada que no esté en los datos. No inventes récords, posiciones, marcadores, rachas, lesiones, jugadores, entrenadores, apodos ni historia del club. Si algo no viene en los datos, no lo menciones y no digas que falta: simplemente no hables de eso. El dato de los últimos cinco partidos es una cuenta, no un orden. Nunca digas 'viene de', 'arrastra', 'encadena' ni describas una secuencia; solo cuántos de cada resultado.",
    "Nunca escribas una frase que sería igual de verdadera para cualquier otro equipo. Si una oración se puede copiar tal cual a la ficha de otro equipo sin cambiarle nada, bórrala.",
    "",
    "PROHIBIDO mencionar que falta un dato, o explicar de qué trata esta ficha. Nunca escribas cosas como 'no se cuenta con datos de', 'no hay información sobre' ni 'esta ficha se centra en'. Si no tienes posición ni récord, empieza directamente por las competencias y el calendario, como si nunca hubieras esperado otro dato.",
    "",
    "DATOS",
    ...datos,
    "",
    "CÓMO ESCRIBIRLO",
    "Primer párrafo: cómo va el equipo según los datos que tienes. Si no hay posición ni récord, habla de en qué competencias está y cuántos partidos vienen.",
    "Segundo párrafo: qué viene, con el próximo rival y la fecha, y si juega en casa o fuera.",
    "Tercer párrafo, solo si hay dónde verlo: en qué canales se transmite en México. Si no hay ese dato, no escribas tercer párrafo.",
    "",
    "TONO",
    "Español de México, informativo y directo. Nada de lenguaje de porra: prohibido \"emocionante\", \"imperdible\", \"gran duelo\", \"no te lo pierdas\" y frases de relleno. Escribe como alguien que informa, no como quien vende.",
    "Sin títulos, sin viñetas, sin negritas. Solo párrafos.",
    "Hasta 160 palabras. No hay mínimo: si solo tienes el calendario, el resumen va a salir corto y está bien. Prefiero cien palabras con datos que ciento sesenta con relleno. No cierres con frases sobre el ritmo del calendario si no agregan un dato nuevo.",
  ].join("\n");
}

// Llama al modelo. Devuelve { texto, palabras } si contestó bien, o { texto: null, motivo }.
// Nunca regresa un texto de error como si fuera resumen: quien llama solo guarda `texto`.
async function generarResumen(prompt) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Falta ANTHROPIC_API_KEY en el entorno");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const cuerpo = await response.text().catch(() => "");
    return { texto: null, motivo: `Anthropic HTTP ${response.status}: ${cuerpo.slice(0, 200)}` };
  }

  const data = await response.json();
  const { text, stopReason } = readAnthropicText(data, "resumenEquipo");
  const texto = String(text || "").trim();
  if (!texto) return { texto: null, motivo: "la respuesta no trajo texto" };
  // Cortada por max_tokens = párrafo a la mitad. No se guarda.
  if (stopReason && stopReason !== "end_turn") return { texto: null, motivo: `respuesta cortada (${stopReason})` };
  return { texto, palabras: texto.split(/\s+/).filter(Boolean).length, motivo: null };
}

module.exports = { reunirDatosDeEquipo, armarPrompt, generarResumen, formaEnCuenta };
