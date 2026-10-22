// src/services/consentimiento.js
//
// La lógica del consentimiento de correos que usan GET y POST /api/consent (server.js). Va aparte
// para poder probarla sin arrancar el servidor. No toca la base: arma la consulta y la interpreta.
//
// Dos permisos, cada uno con su valor (0/1), su versión (qué texto vio) y su fecha (cuándo lo
// eligió). Versión NULL = el modal viejo amarrado (ver src/data/textosConsentimiento.json).
//
// REGLA PARA EL DÍA QUE SE MANDE EL PRIMER CORREO (decidido por Julio, oct 2026):
//   - Novedades: vale emailFanschedule = 1 con CUALQUIER versión, incluida NULL. El botón del modal
//     viejo decía textualmente "Sí, quiero recibir novedades": para novedades el consentimiento es
//     claro.
//   - Ofertas de socios: SOLO emailPartners = 1 con versionSocios distinta de NULL. El modal viejo
//     se llevaba los socios en el mismo botón sin decirlo; ese "sí" no cuenta para mandar ofertas
//     hasta que la persona lo elija por separado (modal nuevo o perfil).

const TEXTOS = require("../data/textosConsentimiento.json");

// permiso del cuerpo -> sus columnas y su clave en el archivo de textos
const PERMISOS = {
  emailFanschedule: { clave: "novedades", version: "versionNovedades", fecha: "fechaNovedades" },
  emailPartners: { clave: "socios", version: "versionSocios", fecha: "fechaSocios" },
};
const COLUMNAS_NUEVAS = ["versionNovedades", "versionSocios", "fechaNovedades", "fechaSocios"];

function valorDePermiso(v) {
  if (v === true || v === 1) return 1;
  if (v === false || v === 0) return 0;
  return null;
}

// null si la versión sirve para ese permiso; si no, el motivo.
function motivoVersionInvalida(version, clave) {
  const v = TEXTOS.versiones && TEXTOS.versiones[version];
  if (!v) return `versión desconocida: ${version}`;
  if (v.aprobada !== true) return `versión no aprobada todavía: ${version}`;
  if (!Array.isArray(v.permisos) || !v.permisos.includes(clave)) return `la versión ${version} no aplica a ${clave}`;
  return null;
}

// Lee el cuerpo del POST. Devuelve { error } o { cambios: [{ permiso, valor, version }] }.
//   - Solo cuentan los permisos que vienen. Lo que no viene no se toca.
//   - Versión AUSENTE -> null: es el modal viejo (la app de antes no manda versiones). Se acepta a
//     propósito durante la transición, y null es justo lo que ese modal significa.
//   - Versión PRESENTE -> tiene que estar en textosConsentimiento.json, aprobada y aplicable a ese
//     permiso. Si no, error (400).
function interpretarCuerpo(body) {
  const b = body || {};
  const cambios = [];
  for (const [permiso, cols] of Object.entries(PERMISOS)) {
    if (!Object.prototype.hasOwnProperty.call(b, permiso) || b[permiso] === undefined) continue;
    const valor = valorDePermiso(b[permiso]);
    if (valor === null) return { error: `${permiso} tiene que ser true o false` };
    let version = null;
    if (Object.prototype.hasOwnProperty.call(b, cols.version) && b[cols.version] !== undefined && b[cols.version] !== null) {
      if (typeof b[cols.version] !== "string") return { error: `${cols.version} tiene que ser texto` };
      const motivo = motivoVersionInvalida(b[cols.version], cols.clave);
      if (motivo) return { error: motivo };
      version = b[cols.version];
    }
    cambios.push({ permiso, valor, version });
  }
  if (!cambios.length) return { error: "No vino ningún permiso" };
  return { cambios };
}

// El INSERT ... ON CONFLICT que escribe SOLO los permisos que vinieron, con su versión y su fecha.
// Si la fila no existe, se crea con los que vinieron; el otro queda en 0 sin versión ni fecha.
// consentDate solo se escribe al crear (es la PRIMERA respuesta). Los nombres de columna salen de
// PERMISOS (lista fija), nunca de la petición.
function armarEscritura(userId, cambios, ahora) {
  const fila = {
    emailFanschedule: 0, versionNovedades: null, fechaNovedades: null,
    emailPartners: 0, versionSocios: null, fechaSocios: null,
  };
  const actualizar = [];
  for (const c of cambios) {
    const cols = PERMISOS[c.permiso];
    fila[c.permiso] = c.valor;
    fila[cols.version] = c.version;
    fila[cols.fecha] = ahora;
    actualizar.push(`${c.permiso} = excluded.${c.permiso}`, `${cols.version} = excluded.${cols.version}`, `${cols.fecha} = excluded.${cols.fecha}`);
  }
  const sql = `INSERT INTO email_consent
      (userId, emailFanschedule, versionNovedades, fechaNovedades, emailPartners, versionSocios, fechaSocios, consentDate, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(userId) DO UPDATE SET ${actualizar.join(", ")}, updatedAt = excluded.updatedAt`;
  const params = [
    userId, fila.emailFanschedule, fila.versionNovedades, fila.fechaNovedades,
    fila.emailPartners, fila.versionSocios, fila.fechaSocios, ahora, ahora,
  ];
  return { sql, params };
}

// La fila de la base -> lo que contesta el GET. Tres estados sin adivinar:
//   respondio: false -> no hay fila (nunca contestó); permisos, versiones y fechas en null.
//   respondio: true  -> cada permiso true/false, con su versión (null = modal viejo) y su fecha.
function estadoDesdeFila(fila) {
  if (!fila) {
    return {
      respondio: false,
      emailFanschedule: null, versionNovedades: null, fechaNovedades: null,
      emailPartners: null, versionSocios: null, fechaSocios: null,
      consentDate: null, updatedAt: null,
    };
  }
  return {
    respondio: true,
    emailFanschedule: fila.emailFanschedule === 1,
    versionNovedades: fila.versionNovedades || null,
    fechaNovedades: fila.fechaNovedades || null,
    emailPartners: fila.emailPartners === 1,
    versionSocios: fila.versionSocios || null,
    fechaSocios: fila.fechaSocios || null,
    consentDate: fila.consentDate || null,
    updatedAt: fila.updatedAt || null,
  };
}

module.exports = { PERMISOS, COLUMNAS_NUEVAS, interpretarCuerpo, armarEscritura, estadoDesdeFila, motivoVersionInvalida };
