// src/config/aiModel.js
// Config y helpers de Anthropic centralizados para TODA la app (resúmenes, broadcasting,
// venues de "Cerca de mí", etiquetas de ronda). Una sola fuente de verdad.
//
// - ANTHROPIC_MODEL: modelo vigente. Override con env ANTHROPIC_MODEL (Render reinicia el
//   servicio al cambiar env vars; sin cambio de código). Fallback = modelo vigente por defecto.
// - readAnthropicText: extrae el bloque de texto de la respuesta, robusto ante bloques de
//   "thinking" (claude-sonnet-5 devuelve content[0]=thinking, content[1]=text). Devuelve
//   { text, blockTypes, stopReason, outputTokens } para que el caller loguee y NO cachee cuando
//   no hay texto.
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

// La observabilidad vive AQUÍ, en el helper compartido, y no en cada llamador: los cuatro sitios
// que hablan con Anthropic pasan por esta función, así que los cuatro empiezan a reportar de
// inmediato. En un día sabemos por medición cuáles se truncan, en vez de por sospecha.
//
// etiqueta: qué sitio llama ("nearby", "summary", "broadcasting", "roundLabel"). Sin ella las
// cuatro líneas saldrían idénticas y no se sabría cuál falló, que es justo lo que se quiere medir.
// Tiene default para que un llamador futuro que la olvide no rompa nada.
function readAnthropicText(data, etiqueta = "?") {
  const blocks = data && Array.isArray(data.content) ? data.content : [];
  const stopReason   = data?.stop_reason ?? null;
  const outputTokens = data?.usage?.output_tokens ?? null;

  if (data && data.type === "error") {
    // El cuerpo de error de la API llega aquí ya parseado cuando el llamador no comprueba el
    // status (tres de los cuatro no lo hacen). Los HTTP 400 de agosto 2026 eran saldo de créditos
    // en cero y la API lo decía en texto plano en este cuerpo, que se tiraba sin leer. Costó dos
    // días de investigación.
    console.error(`[anthropic:${etiqueta}] ERROR de la API: ${data.error?.type || "?"} — ${data.error?.message || "(sin mensaje)"}`);
  } else if (stopReason && stopReason !== "end_turn") {
    // stop_reason distinto de end_turn = la respuesta NO terminó sola. "max_tokens" es
    // truncamiento: el texto viene cortado a la mitad y cualquier JSON dentro queda ilegible, sin
    // que se lance ningún error. Este campo no se miraba en NINGÚN punto del backend, y era
    // exactamente el que explicaba por qué "Cerca de mí" perdía tandas enteras de venues.
    console.warn(`[anthropic:${etiqueta}] stop_reason=${stopReason} salida=${outputTokens} tokens — la respuesta no terminó sola`);
  }

  return {
    text: blocks.find((b) => b && b.type === "text")?.text,
    blockTypes: blocks.map((b) => b && b.type),
    stopReason,
    outputTokens,
  };
}

module.exports = { ANTHROPIC_MODEL, readAnthropicText };
