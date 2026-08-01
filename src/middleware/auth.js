const { sessionRepository } = require("../repositories/sessionRepositorySqlite");
const { recordAuthUsage } = require("../services/authUsageTracker");

// Interruptor de la ventana de migración. Se lee UNA vez al arrancar (no por petición) y se
// registra en el log de arranque, así basta ver el log de un deploy para saber en qué modo
// corre. Ausente = true A PROPÓSITO: borrar la variable por accidente no debe dejar a los
// usuarios fuera en silencio. Se cierra con ALLOW_LEGACY_USERID=false en Render, lo cual
// reinicia el servicio — sin deploy de código, y revertir es cambiarla de vuelta.
const ALLOW_LEGACY_USERID =
  String(process.env.ALLOW_LEGACY_USERID ?? "true").trim().toLowerCase() !== "false";

function isLegacyAllowed() {
  return ALLOW_LEGACY_USERID;
}

function bearerToken(req) {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header.trim());
  return match ? match[1] : null;
}

// Mismas fuentes y mismo orden que hoy: parámetro de ruta → body → query.
function legacyUserId(req) {
  return (req.params && req.params.userId)
    || (req.body && req.body.userId)
    || (req.query && req.query.userId)
    || null;
}

// Etiqueta ESTABLE de la ruta ("GET /subscriptions/:userId"), no la URL concreta: evita que la
// tabla de medición se llene de una fila por usuario y que guarde correos.
function routeLabel(req) {
  return `${req.method} ${(req.route && req.route.path) || req.path}`;
}

function logLegacy(req, userId) {
  const ua = (req.headers["user-agent"] || "").slice(0, 80);
  console.warn(`[auth][legacy] endpoint=${routeLabel(req)} user=${userId || "(anónimo)"} ua="${ua}"`);
}

// Resuelve la identidad SIN decidir qué hacer con ella (eso depende de si el endpoint exige
// sesión o no). Devuelve 'session' | 'invalid-token' | 'no-token'.
async function resolveSession(req) {
  const token = bearerToken(req);
  if (!token) return { status: "no-token" };

  const row = await sessionRepository.findValid(token);
  if (!row) return { status: "invalid-token" };

  await sessionRepository.touchIfStale(row);
  return { status: "session", userId: row.userId };
}

/**
 * Endpoints que EXIGEN identidad.
 *
 * Un token inválido es 401 y NO cae a la forma vieja: si cayera, revocar una sesión no serviría
 * de nada — bastaría mandar un token basura para volver al modo permisivo. Un token malo es una
 * señal, no un pretexto.
 *
 * legacyAnonymous: solo para POST /subscriptions/sync, que hoy no lleva userId de ningún tipo.
 * Sin esta excepción, exigir un userId ahí lo rompería durante la ventana de migración, que es
 * justo lo que no puede pasar. Al cerrar el interruptor deja de aplicar y pasa a exigir sesión.
 */
function requireUser(options = {}) {
  const { legacyAnonymous = false } = options;

  return async function requireUserMiddleware(req, res, next) {
    try {
      const resolved = await resolveSession(req);

      if (resolved.status === "session") {
        req.auth = { userId: resolved.userId, source: "session" };
        recordAuthUsage("session", routeLabel(req));
        return next();
      }

      if (resolved.status === "invalid-token") {
        recordAuthUsage("invalid", routeLabel(req));
        return res.status(401).json({ ok: false, error: "Sesión inválida o expirada", code: "SESSION_INVALID" });
      }

      // Sin token → camino viejo, solo mientras la ventana esté abierta.
      if (!ALLOW_LEGACY_USERID) {
        return res.status(401).json({ ok: false, error: "Se requiere sesión", code: "SESSION_REQUIRED" });
      }

      const userId = legacyUserId(req);
      if (!userId && !legacyAnonymous) {
        return res.status(401).json({ ok: false, error: "Se requiere sesión", code: "SESSION_REQUIRED" });
      }

      req.auth = { userId: userId || null, source: "legacy" };
      recordAuthUsage("legacy", routeLabel(req));
      logLegacy(req, userId);
      return next();
    } catch (error) {
      console.error(`[auth] error resolviendo sesión: ${error.message}`);
      return res.status(500).json({ ok: false, error: "Error de autenticación" });
    }
  };
}

/**
 * Endpoints que funcionan CON y SIN identidad (/api/match/:matchId, /api/nearby).
 *
 * Se distinguen DOS casos que no son lo mismo:
 *
 * - SIN token → anónimo, 200 sin userSide. La página de un partido es pública (ruta
 *   /match/:matchId sin Protected en el frontend): un link compartido tiene que abrirse para
 *   quien no ha entrado nunca.
 *
 * - Token PRESENTE pero inválido o vencido → 401, igual que en requireUser. El cliente afirmó
 *   una identidad y esa identidad no sirve; hay que decírselo. Si aquí degradáramos a anónimo,
 *   un usuario con la sesión vencida vería /nearby cargando partidos SIN el pill de
 *   Local/Visitante y sin ningún aviso de reconectar: el fallo silencioso de siempre. La regla
 *   "token inválido = 401" aplica igual que en todos los demás.
 */
function optionalUser() {
  return async function optionalUserMiddleware(req, res, next) {
    try {
      const resolved = await resolveSession(req);

      if (resolved.status === "session") {
        req.auth = { userId: resolved.userId, source: "session" };
        recordAuthUsage("session", routeLabel(req));
        return next();
      }

      if (resolved.status === "invalid-token") {
        recordAuthUsage("invalid", routeLabel(req));
        return res.status(401).json({ ok: false, error: "Sesión inválida o expirada", code: "SESSION_INVALID" });
      }

      if (ALLOW_LEGACY_USERID) {
        const userId = legacyUserId(req);
        if (userId) {
          req.auth = { userId, source: "legacy" };
          recordAuthUsage("legacy", routeLabel(req));
          logLegacy(req, userId);
          return next();
        }
      }

      req.auth = { userId: null, source: "anonymous" };
      return next();
    } catch (error) {
      console.error(`[auth] error resolviendo sesión opcional: ${error.message}`);
      // Si el cliente MANDÓ un token y no pudimos verificarlo, no se degrada a anónimo: eso
      // devolvería 200 sin userSide y el usuario vería la página mal, sin enterarse. Se falla
      // fuerte. Sin token no hay nada que verificar y el endpoint sigue vivo como anónimo.
      if (bearerToken(req)) {
        return res.status(500).json({ ok: false, error: "No se pudo verificar la sesión" });
      }
      req.auth = { userId: null, source: "anonymous" };
      return next();
    }
  };
}

module.exports = { requireUser, optionalUser, isLegacyAllowed };
