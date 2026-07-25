// src/config/aiModel.js
// Config y helpers de Anthropic centralizados para TODA la app (resúmenes, broadcasting,
// venues de "Cerca de mí", etiquetas de ronda). Una sola fuente de verdad.
//
// - ANTHROPIC_MODEL: modelo vigente. Override con env ANTHROPIC_MODEL (Render reinicia el
//   servicio al cambiar env vars; sin cambio de código). Fallback = modelo vigente por defecto.
// - readAnthropicText: extrae el bloque de texto de la respuesta, robusto ante bloques de
//   "thinking" (claude-sonnet-5 devuelve content[0]=thinking, content[1]=text). Devuelve
//   { text, blockTypes } para que el caller loguee y NO cachee cuando no hay texto.
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

function readAnthropicText(data) {
  const blocks = data && Array.isArray(data.content) ? data.content : [];
  return {
    text: blocks.find((b) => b && b.type === "text")?.text,
    blockTypes: blocks.map((b) => b && b.type),
  };
}

module.exports = { ANTHROPIC_MODEL, readAnthropicText };
