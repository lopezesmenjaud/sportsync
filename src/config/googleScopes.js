// Un solo lugar para los scopes de Calendar, para que server.js y scheduler.js no
// tengan cada uno su propia copia del string.
//
// Antes el chequeo era `.includes("https://www.googleapis.com/auth/calendar")` y eso
// era un cheque en blanco: ese string es PREFIJO de calendar.readonly, de
// calendar.events y del propio calendar.app.created, así que daba true con permisos
// que no alcanzan para escribir un evento. Aquí se compara por igualdad exacta.

// Solo alcanza los calendarios que creó la app.
const CALENDAR_SCOPE_APP_CREATED = "https://www.googleapis.com/auth/calendar.app.created";

// El amplio. Los usuarios que lo concedieron lo siguen trayendo en su token y tienen
// que seguir funcionando igual.
const CALENDAR_SCOPE_FULL = "https://www.googleapis.com/auth/calendar";

const CALENDAR_SCOPES_VALIDOS = [CALENDAR_SCOPE_APP_CREATED, CALENDAR_SCOPE_FULL];

// scopeString es el campo `scope` que devuelve Google: los scopes concedidos
// separados por espacios. Se parte por espacios y se compara uno por uno.
function hasCalendarScope(scopeString) {
  if (!scopeString) return false;
  return String(scopeString)
    .split(/\s+/)
    .some((s) => CALENDAR_SCOPES_VALIDOS.includes(s));
}

module.exports = {
  CALENDAR_SCOPE_APP_CREATED,
  CALENDAR_SCOPE_FULL,
  CALENDAR_SCOPES_VALIDOS,
  hasCalendarScope,
};
