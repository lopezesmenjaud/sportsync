// src/config/aiModel.js
// Modelo de Anthropic centralizado para TODA la app (resúmenes, broadcasting, venues
// de "Cerca de mí", etiquetas de ronda). Cambiar de modelo = setear ANTHROPIC_MODEL en
// el entorno del servicio; NO requiere cambio de código (Render reinicia el servicio al
// cambiar env vars). El fallback es el modelo vigente por defecto.
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

module.exports = { ANTHROPIC_MODEL };
