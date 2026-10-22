// src/services/resumenPartido.js
//
// Resumen escrito con IA de la pantalla de partido de la app (/match/:matchId). Lo usa SOLO el job
// runGenerarResumenesPartidos; el endpoint nunca genera, solo lee lo que dejó el job.
//
// Reemplaza el diseño de getSmartSummary (server.js), que recibía cuatro campos —equipos,
// competencia cruda, deporte en inglés y la fecha en UTC— y por eso inventaba. Éste recibe datos
// reales y el prompt le prohíbe salirse de ellos. Si un dato no existe, su renglón NO va en el
// prompt. Misma infraestructura y mismo modelo que los resúmenes de equipo (generarResumen).
//
// Datos, con estas reglas:
//   1. Tabla de posiciones SOLO de la competencia del partido. Si la competencia no tiene tabla
//      (Champions, por ejemplo), la posición de cada equipo entra marcada "en su liga" y SIN "qué
//      está en juego": eso habla de la próxima temporada y en un partido de copa se lee como
//      contradicción. Tampoco récord ni últimos cinco de su liga: se confundirían con esta copa.
//   2. Jornada solo cuando intRound es el número de jornada de una liga (1 a 60). Los códigos de
//      las copas y su etiqueta en palabras (roundLabelService, con IA) NO son dato y no entran.
//   3. Fecha y hora en texto y en hora del centro de México (fechaEnTexto), nunca UTC crudo.
//   4. Dónde verlo solo de dondeVerVerificado (tablas hechas a mano). Nada de broadcasting_cache.
//   5. Nada de los resúmenes de equipo ya generados: sería IA sobre IA.

const {
  vistaDelPartido,
  instante,
  fechaEnTexto,
  proximosDeEquipo,
  dondeVerVerificado,
  indiceEquipos,
  identidadDeEquipo,
} = require("../routes/partidoPublico");
const { obtenerTablaDePosiciones, filaDeEquipo, queEstaEnJuegoEnEspanol, tieneTabla } = require("./tablaPosiciones");
const { generarResumen, formaEnCuenta } = require("./resumenEquipo");
const COMPETENCIAS = require("../data/competencias.json").competencias;

const POR_CLAVE = new Map(COMPETENCIAS.map((c) => [String(c.clave), c]));
const conValor = (v) => v !== null && v !== undefined && String(v).trim() !== "";

// Cuántos partidos siguientes de cada equipo se le pasan (después de éste). UNO y no dos: con dos,
// siete de siete partidos de fútbol de la primera muestra pasaron de 140 palabras (151 a 177), y
// no era relleno: el último párrafo metía cuatro fixtures. Es además lo menos útil en un resumen de
// ESTE partido, y el calendario completo de cada equipo ya está en su página.
const PROXIMOS_POR_EQUIPO = 1;

// Lo que pide el prompt, y a partir de cuánto se avisa en el log. Pasarse NO tira el texto (tirar
// uno bueno cuesta una llamada y uno largo puede estar denso, no relleno): solo se avisa, para ver
// si es sistemático.
// 140 y no 100: con dos tablas de posiciones, canal verificado y los siguientes partidos de ambos
// equipos, 100 obliga a tirar datos. Lo que importa es la regla del relleno, no el número.
const PALABRAS_PROMPT = 140;
const PALABRAS_AVISO = 170;

// ── Validador de horas ──
//
// Una hora falsa vale mucho más que una llamada tirada: el texto se rechaza si menciona una hora
// que no está en los datos. Pero el modelo puede escribirla de muchas formas ("20:00", "7:05 p.m.",
// "a las 8", "a las ocho de la noche"), así que el validador:
//   - reconoce esas formas y las pasa a minutos del día (hora del centro de México);
//   - sin a.m./p.m. ni "de la noche", acepta si cuadra a cualquiera de las dos lecturas;
//   - lo que NO reconoce no lo rechaza: prefiere dejar pasar una forma rara antes que tirar textos
//     buenos. Lo que sí reconoce lo exige exacto: "a las 7" para un partido de las 7:05 es redondear.
const NUMEROS = {
  una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7,
  ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
};
const NUMERO = "(\\d{1,2}|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)";
const SUFIJO = "(?:\\s*(a|p)\\.?\\s*m\\.?|\\s+de\\s+la\\s+(mañana|tarde|noche|madrugada))?";
// "19:05", "7:05 p.m.", "07:05 p. m.", "7:05 de la noche"
const RE_RELOJ = new RegExp("\\b(\\d{1,2}):(\\d{2})" + SUFIJO, "giu");
// "a las 8", "a las 8 p.m.", "a la una", "a las ocho de la noche", "a las siete y cinco".
// Los minutos dichos con palabra o con número; una "y" suelta NO cierra la hora ("a las siete y
// cinco" no es "a las siete").
const MINUTOS = { cinco: 5, diez: 10, quince: 15, cuarto: 15, veinte: 20, veinticinco: 25, media: 30 };
const RE_LAS = new RegExp("\\blas?\\s+" + NUMERO +
  "(?:\\s+y\\s+(\\d{1,2}|cinco|diez|quince|cuarto|veinte|veinticinco|media))?" + SUFIJO +
  "(?=\\s*(?:horas|hrs|h\\b|en punto|[,.;)]|$)|\\s+(?:del|hora|tiempo|en)\\b)", "giu");

// Minutos del día que caben en lo escrito: uno si dice a.m./p.m. o la parte del día; dos si no.
function lecturas(hora, minutos, ampm, parte) {
  if (hora > 23 || minutos > 59) return [];
  if (hora > 12 || hora === 0) return [hora * 60 + minutos];
  const h12 = hora % 12;
  if (ampm === "a" || parte === "mañana" || parte === "madrugada") return [h12 * 60 + minutos];
  if (ampm === "p" || parte === "tarde" || parte === "noche") return [(h12 + 12) * 60 + minutos];
  return [h12 * 60 + minutos, (h12 + 12) * 60 + minutos];
}

// Las horas de los datos (la del partido y las de los siguientes), en minutos del día.
function horasDeLosDatos(datos) {
  const textos = [datos.fecha, ...datos.equipos.flatMap((e) => e.siguientes.map((s) => s.fecha))].filter(Boolean);
  const horas = new Set();
  for (const t of textos) {
    const m = /(\d{1,2}):(\d{2})\s*(a|p)\.?\s*m\.?/iu.exec(t);
    if (m) for (const x of lecturas(Number(m[1]), Number(m[2]), m[3].toLowerCase(), null)) horas.add(x);
  }
  return horas;
}

const aReloj = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

// Las horas que menciona el texto y NO están en los datos: [{ fragmento, interpretada }]. Vacío = bien.
function horasSinRespaldo(texto, datos) {
  const permitidas = horasDeLosDatos(datos);
  const malas = [];
  const revisar = (fragmento, posibles) => {
    if (!posibles.length) return;
    if (!posibles.some((p) => permitidas.has(p))) malas.push({ fragmento: fragmento.trim(), interpretada: posibles.map(aReloj).join(" o ") });
  };
  for (const m of texto.matchAll(RE_RELOJ)) {
    revisar(m[0], lecturas(Number(m[1]), Number(m[2]), m[3] && m[3].toLowerCase(), m[4] && m[4].toLowerCase()));
  }
  for (const m of texto.matchAll(RE_LAS)) {
    const crudo = m[1].toLowerCase();
    const hora = /^\d+$/.test(crudo) ? Number(crudo) : NUMEROS[crudo];
    if (!hora || hora > 12) continue; // "las 14" no es una hora dicha así; no se adivina
    const crudoMin = m[2] ? m[2].toLowerCase() : null;
    const minutos = !crudoMin ? 0 : /^\d+$/.test(crudoMin) ? Number(crudoMin) : MINUTOS[crudoMin];
    revisar(m[0], lecturas(hora, minutos, m[3] && m[3].toLowerCase(), m[4] && m[4].toLowerCase()));
  }
  return { malas, permitidas: [...permitidas].sort((a, b) => a - b).map(aReloj) };
}

// Motivo para NO publicar un texto, o null si está bien.
//   - Puntos suspensivos: el modelo corrigiéndose a media frase ("visitará... recibirá a Aston
//     Villa"). Eso no se publica.
//   - Una hora que no está en los datos. El motivo dice qué encontró y contra qué lo comparó, para
//     distinguir en el log un rechazo correcto de un falso positivo.
function motivoParaRechazar(texto, datos = null) {
  if (texto.includes("...") || texto.includes("…")) return "trae puntos suspensivos (el modelo se corrigió a media frase)";
  if (datos) {
    const { malas, permitidas } = horasSinRespaldo(texto, datos);
    if (malas.length) {
      const encontradas = malas.map((x) => `"${x.fragmento}" (= ${x.interpretada})`).join(", ");
      return `menciona una hora que no está en los datos: ${encontradas}; horas de los datos: ${permitidas.join(", ") || "ninguna"}`;
    }
  }
  return null;
}

// "Jornada 14" / "Semana 7", o null. Solo ligas del catálogo, y solo si intRound es un número de
// jornada: los códigos de fase de las copas y de la liguilla son 100 o más ("125", "150", "200").
function jornadaDelPartido(match) {
  const comp = POR_CLAVE.get(String(match.competitionKey || ""));
  if (!comp || comp.tipo !== "liga") return null;
  const n = Number(match.intRound);
  if (!Number.isInteger(n) || n < 1 || n > 60) return null;
  if (comp.sport === "futbol") return `Jornada ${n}`;
  if (comp.sport === "futbol_americano") return `Semana ${n}`;
  return null;
}

// La fila de tabla de un equipo para ESTE partido.
//   misma: true  -> es la tabla de la competencia del partido (todo vale: récord, forma, en juego).
//   misma: false -> es la de su liga nacional; solo posición y puntos, marcados con el nombre.
async function filaParaElPartido(base, match, indice, provider, contador) {
  const clavePartido = String(match.competitionKey || "");
  if (tieneTabla(clavePartido)) {
    const tabla = await obtenerTablaDePosiciones(clavePartido, provider, contador);
    const fila = filaDeEquipo(tabla, base);
    return fila ? { fila, total: tabla.standings.length, misma: true, liga: null } : null;
  }
  const equipo = indice.get(identidadDeEquipo(base).slug);
  for (const clave of (equipo && equipo.claves) || []) {
    if (String(clave) === clavePartido || !tieneTabla(clave)) continue;
    const tabla = await obtenerTablaDePosiciones(clave, provider, contador);
    const fila = filaDeEquipo(tabla, base);
    if (fila) {
      const comp = POR_CLAVE.get(String(clave));
      return { fila, total: tabla.standings.length, misma: false, liga: comp ? comp.nombrePublico : null };
    }
  }
  return null;
}

// "miércoles 28 de octubre": el día de un partido siguiente, sin año y SIN hora. La hora de los
// siguientes no hace falta en el resumen de este partido, y sin ella el modelo no la puede escribir
// mal: la única hora en los datos es la de este partido (y es la única que acepta el validador).
function diaEnTexto(fecha) {
  return fecha
    .toLocaleDateString("es-MX", { timeZone: "America/Mexico_City", weekday: "long", day: "numeric", month: "long" })
    .replace(",", "");
}

// "primero", "decimosexto", "último": el lugar en la tabla con palabra. Más de 20 (no pasa en las
// tablas de hoy) cae al número con ordinal.
const ORDINALES = [null, "primero", "segundo", "tercero", "cuarto", "quinto", "sexto", "séptimo",
  "octavo", "noveno", "décimo", "undécimo", "duodécimo", "decimotercero", "decimocuarto",
  "decimoquinto", "decimosexto", "decimoséptimo", "decimoctavo", "decimonoveno", "vigésimo"];
function lugarEnPalabras(lugar, total) {
  if (lugar === total && total > 1) return "último";
  return ORDINALES[lugar] || `${lugar}.º`;
}

// Los siguientes partidos de un equipo DESPUÉS de éste.
async function siguientesDe(base, match) {
  const fecha = instante(match);
  if (!fecha) return [];
  const desde = new Date(fecha.getTime() + 60 * 1000).toISOString();
  const partidos = await proximosDeEquipo(base, desde, PROXIMOS_POR_EQUIPO);
  const salida = [];
  for (const m of partidos) {
    const v = vistaDelPartido(m);
    const f = instante(m);
    const esLocal = m.homeParticipantName === base;
    const rival = esLocal ? v.nombreVisita : v.nombreLocal;
    if (!f || !rival) continue;
    // El verbo ya puesto ("recibe a", "visita a"). Con "local contra X" el modelo tenía que
    // convertirlo a verbo y se enredaba: "visitará... recibirá a Sassuolo".
    salida.push({ id: m.providerMatchId, fecha: diaEnTexto(f), verbo: esLocal ? "recibe a" : "visita a", rival, competencia: v.competencia });
  }
  return salida;
}

// "Canal 5, TUDN o ViX Premium" / "Azteca 7 y Canal 5 (TV abierta, gratis); en streaming: VIX".
function canalEnTexto(verificado) {
  if (!verificado) return null;
  const partes = [...(verificado.texto || [])];
  const streaming = (verificado.streaming || []).map((s) => s.name).filter(Boolean);
  if (streaming.length) partes.push(`en streaming: ${streaming.join(", ")}`);
  return partes.length ? partes.join("; ") : null;
}

// Todo lo que el prompt puede decir de un partido, ya resuelto. Lo que no se sabe queda en null.
async function reunirDatosDePartido(match, provider, contador = { llamadas: 0 }) {
  const vista = vistaDelPartido(match);
  const fecha = instante(match);
  const indice = await indiceEquipos();

  const datos = {
    providerMatchId: match.providerMatchId,
    esVersus: vista.esVersus,
    nombre: vista.nombre,
    local: vista.esVersus ? vista.nombreLocal : null,
    visita: vista.esVersus ? vista.nombreVisita : null,
    competencia: vista.competencia || null,
    jornada: jornadaDelPartido(match),
    fecha: fecha ? fechaEnTexto(fecha) : null,
    horario: match.currentStartUtc || match.scheduledStartUtc || null,
    estado: match.status || null,
    estadio: conValor(match.venueName) ? String(match.venueName).trim() : null,
    ciudad: conValor(match.city) ? String(match.city).trim() : null,
    pais: conValor(match.country) ? String(match.country).trim() : null,
    canal: canalEnTexto(dondeVerVerificado(match, match.competitionKey, "Mexico")),
    equipos: [],
  };

  if (vista.esVersus) {
    for (const [base, nombre, condicion] of [
      [match.homeParticipantName, vista.nombreLocal, "local"],
      [match.awayParticipantName, vista.nombreVisita, "visitante"],
    ]) {
      datos.equipos.push({
        nombre,
        condicion,
        tabla: await filaParaElPartido(base, match, indice, provider, contador),
        siguientes: await siguientesDe(base, match),
      });
    }
  }

  datos.firma = firmaDelPartido(datos);
  return datos;
}

// Se regenera solo si cambia algo de lo que el resumen afirma: horario, estado, posición y puntos
// de cada equipo, el canal verificado y los siguientes partidos (un "después visita a X" que ya
// no es cierto sería un dato falso).
function firmaDelPartido(d) {
  const partes = [d.horario || "", d.estado || "", d.canal || ""];
  for (const e of d.equipos) {
    const f = e.tabla && e.tabla.fila;
    partes.push(`${e.nombre}:${f ? `${f.intRank}/${f.intPoints}` : "-"}:${e.siguientes.map((s) => s.id).join(",")}`);
  }
  return partes.join("|");
}

function renglonesDeEquipo(e, competencia) {
  const r = [`${e.nombre} (${e.condicion}):`];
  const t = e.tabla;
  if (t && t.misma) {
    const f = t.fila;
    // "primero de 18" y no "1 de 18 equipos" ni "1.º de 18": con el número el modelo lo calcaba
    // ("líder con 1 de 18 equipos", "llega como 1.º de 18"). Con la palabra lo redacta. No se le pone
    // "líder": los datos son datos y los adjetivos los pone el modelo, con la regla de no inventar.
    // Difiere A PROPÓSITO de la etiqueta de resumenEquipo.js ("Posición: N de T equipos"): allá
    // funciona bien y hay cientos de resúmenes ya generados que se leen correctos; no se cambia algo
    // que está bien solo para que coincida.
    if (conValor(f.intRank) && t.total) r.push(`- Lugar en la tabla de ${competencia}: ${lugarEnPalabras(Number(f.intRank), Number(t.total))} de ${t.total}`);
    if ([f.intWin, f.intDraw, f.intLoss, f.intPlayed].every(conValor)) {
      r.push(`- Récord: ${f.intWin} ganados, ${f.intDraw} empatados, ${f.intLoss} perdidos en ${f.intPlayed} jugados`);
    }
    if (conValor(f.intPoints)) r.push(`- Puntos: ${f.intPoints}`);
    const forma = formaEnCuenta(f.strForm);
    if (forma) r.push(`- ${forma.partidos === 5 ? "Últimos cinco partidos" : `Últimos ${forma.partidos} partidos`}: ${forma.texto}`);
    const enJuego = queEstaEnJuegoEnEspanol(f.strDescription);
    if (enJuego) r.push(`- Qué está en juego esa posición: ${enJuego}`);
  } else if (t && t.liga) {
    const f = t.fila;
    if (conValor(f.intRank) && t.total) {
      r.push(`- Posición en su liga (${t.liga}, no en ${competencia}): ${f.intRank} de ${t.total}${conValor(f.intPoints) ? `, con ${f.intPoints} puntos` : ""}`);
    }
  }
  if (e.siguientes.length) {
    r.push("- Después de este partido:");
    for (const s of e.siguientes) r.push(`  - ${s.fecha}: ${s.verbo} ${s.rival}${s.competencia ? ` (${s.competencia})` : ""}`);
  }
  return r.length > 1 ? r : [];
}

// Sobre "líder": el modelo escribe "primero de 18 en la tabla" y no "es líder". Es la regla absoluta
// funcionando, no un defecto, y NO se le da permiso de concluirlo (decidido por Julio). Esa regla es
// lo que ha impedido en todo el proyecto que invente récords, rachas y rivalidades. Darle permiso de
// concluir una equivalencia le enseña que concluir a veces se vale, y la siguiente conclusión no la
// elegimos nosotros. "Primero de 18 en la tabla" es correcto y claro: preferimos rígido a abierto.
function armarPromptPartido(d) {
  const datos = [];
  if (d.esVersus) datos.push(`Partido: ${d.local} (local) contra ${d.visita} (visitante)`);
  else datos.push(`Evento: ${d.nombre}`);
  if (d.competencia) datos.push(`Competencia: ${d.competencia}`);
  if (d.jornada) datos.push(d.jornada);
  if (d.fecha) datos.push(`Fecha y hora: ${d.fecha} (hora del centro de México)`);
  if (d.estadio) datos.push(`Estadio: ${d.estadio}${d.ciudad ? `, ${d.ciudad}` : ""}${d.pais ? `, ${d.pais}` : ""}`);
  for (const e of d.equipos) {
    const r = renglonesDeEquipo(e, d.competencia);
    if (r.length) datos.push("", ...r);
  }
  if (d.canal) datos.push("", `Dónde verlo en México: ${d.canal}`);

  return [
    "Escribes el resumen previo de un partido en FanSchedule, un sitio en español de México que agenda partidos en Google Calendar.",
    "",
    "Escribe 1 o 2 párrafos sobre este partido usando ÚNICAMENTE los datos de abajo.",
    "",
    "REGLA ABSOLUTA: no afirmes nada que no esté en los datos. No inventes récords, posiciones, marcadores, rachas, lesiones, jugadores, entrenadores, apodos ni historia de los clubes. Si algo no viene en los datos, no lo menciones y no digas que falta: simplemente no hables de eso. El dato de los últimos cinco partidos es una cuenta, no un orden. Nunca digas 'viene de', 'arrastra', 'encadena' ni describas una secuencia; solo cuántos de cada resultado.",
    "La hora de ESTE partido escríbela exactamente como viene en los datos: no la recalcules ni la redondees.",
    "Nunca escribas una frase que sería igual de verdadera para cualquier otro partido. Si una oración se puede copiar tal cual al resumen de otro partido sin cambiarle nada, bórrala.",
    "Si una posición viene marcada \"en su liga\", es la de la liga nacional de ese equipo, no la de esta competencia: dilo así y no la mezcles con esta competencia.",
    "",
    "PROHIBIDO mencionar que falta un dato, o explicar de qué trata este resumen. Nunca escribas cosas como 'no se cuenta con datos de', 'no hay información sobre' ni 'este resumen se centra en'. Si no tienes posición ni récord, empieza directamente por quién juega, cuándo y dónde, como si nunca hubieras esperado otro dato.",
    "",
    "PROHIBIDO MENCIONAR, aunque creas saberlo:",
    "- Marcadores, de cualquier partido: ni de este, ni de los anteriores, ni de los enfrentamientos entre los dos.",
    "- Historial entre los dos equipos: quién ganó la última vez, el balance, cuántas veces se han enfrentado.",
    "- Lesiones, suspensiones, bajas, alineaciones y cualquier jugador por nombre.",
    "- Entrenadores, árbitro, clima, asistencia o aforo, momios o apuestas.",
    "- Rachas en orden (\"viene de tres victorias\"): los últimos cinco son una cuenta, no una secuencia.",
    "- Récord, posición o puntos en NFL, NBA, MLB y en la fase de liga de Champions, si no vienen en los datos.",
    "- \"Clásico\", \"rivalidad\", \"duelo histórico\" o cualquier contexto que no venga en los datos.",
    "- Canales de transmisión, si no vienen en los datos.",
    "- La fase del torneo en palabras (\"cuartos\", \"final\", \"fase de grupos\").",
    "",
    "DATOS",
    ...datos,
    "",
    "CÓMO ESCRIBIRLO",
    "Primer párrafo: quién recibe a quién, cuándo y dónde, y cómo llega cada equipo según los datos que tienes.",
    "Segundo párrafo, solo si hay dónde verlo o partidos siguientes: en qué canales se transmite en México y qué le sigue a cada equipo. Si no hay ninguno de esos datos, no escribas segundo párrafo.",
    "",
    "TONO",
    "Español de México, informativo y directo. Nada de lenguaje de porra: prohibido \"emocionante\", \"imperdible\", \"gran duelo\", \"no te lo pierdas\", \"duelo de alto voltaje\" y frases de relleno. Escribe como alguien que informa, no como quien vende.",
    "Sin títulos, sin viñetas, sin negritas. Solo párrafos.",
    `Hasta ${PALABRAS_PROMPT} palabras. No hay mínimo: si solo tienes la fecha y el estadio, el resumen va a salir de dos renglones y está bien. Prefiero cuarenta palabras con datos que cien con relleno.`,
  ].join("\n");
}

module.exports = {
  reunirDatosDePartido, armarPromptPartido, firmaDelPartido, jornadaDelPartido, generarResumen,
  motivoParaRechazar, horasSinRespaldo, PALABRAS_PROMPT, PALABRAS_AVISO,
};
