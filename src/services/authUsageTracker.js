const { db } = require("../db/database");

// Mide por qué camino entra cada petición durante la ventana de migración, para poder CERRAR la
// forma vieja con un dato y no con una corazonada.
//
// Por qué persistir y no solo contar en memoria: Render reinicia el servicio solo (deploys,
// spin-down). Un contador en memoria mostraría "0 peticiones legacy" cuando en realidad nació
// hace tres minutos — eso es adivinar disfrazado de medir.
//
// Costo: se acumula en memoria y se vuelca cada 60 s SOLO si hubo cambios. Máximo 1 ráfaga de
// writes por minuto mientras quede tráfico viejo, y CERO writes cuando llega a cero.
const FLUSH_INTERVAL_MS = 60 * 1000;

// clave `día|source|endpoint` → delta pendiente de volcar
const pending = new Map();

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

// source: 'session' | 'legacy' | 'invalid'
function recordAuthUsage(source, endpoint) {
  const key = `${utcDay()}|${source}|${endpoint}`;
  pending.set(key, (pending.get(key) || 0) + 1);
}

function flush() {
  if (pending.size === 0) return; // sin cambios → ni una escritura

  const snapshot = [...pending.entries()];
  pending.clear();
  const nowIso = new Date().toISOString();

  for (const [key, count] of snapshot) {
    const [day, source, endpoint] = key.split("|");
    db.run(
      `
      INSERT INTO auth_usage_daily (day, source, endpoint, count, updatedAtUtc)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(day, source, endpoint) DO UPDATE SET
        count = count + excluded.count,
        updatedAtUtc = excluded.updatedAtUtc
      `,
      [day, source, endpoint, count, nowIso],
      (err) => {
        if (err) {
          // Si el volcado falla, el delta REGRESA al acumulador: mejor contar de más en el
          // siguiente intento que perder la cuenta y cerrar la puerta vieja a ciegas.
          console.error(`[authusage] volcado falló para ${key}: ${err.message}`);
          pending.set(key, (pending.get(key) || 0) + count);
        }
      }
    );
  }
}

// unref() para que este timer nunca mantenga vivo el proceso por su cuenta.
const flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
if (typeof flushTimer.unref === "function") flushTimer.unref();

// Volcado al apagar. Render reinicia el servicio solo (deploys, spin-down) y sin esto se perderían
// hasta 60 s de cuentas. Con tráfico legacy escaso, perder unas cuantas peticiones podría mostrar
// un CERO que no es real y llevar a cerrar ALLOW_LEGACY_USERID antes de tiempo.
//
// OJO: registrar un manejador de SIGTERM/SIGINT ANULA el apagado por defecto de Node, así que hay
// que salir a mano o Render se queda esperando hasta el SIGKILL. flush() es síncrono por debajo
// (better-sqlite3), así que las escrituras terminan antes del exit. Se sale de inmediato, igual
// que hoy sin manejador: esto añade el volcado, no cambia la semántica del apagado.
function flushAndExit(signal) {
  try {
    flush();
  } catch (err) {
    console.error(`[authusage] volcado en ${signal} falló: ${err.message}`);
  }
  process.exit(0);
}

process.once("SIGTERM", () => flushAndExit("SIGTERM"));
process.once("SIGINT", () => flushAndExit("SIGINT"));

module.exports = { recordAuthUsage, flush };
