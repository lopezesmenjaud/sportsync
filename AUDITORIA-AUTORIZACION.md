# Auditoría de autorización — `server.js`

Auditoría de solo lectura del control de acceso de los endpoints. Inventario completo, sin cambios de código.

## Contexto de base (aplica a casi todo)

- **No hay middleware de autenticación.** Solo `app.use(cors(...))` (línea 24) y `app.use(express.json())` (33). El `userId` = **correo del usuario** (se acuña en `/auth/google/callback:292` como `profile.email`) y viaja crudo del cliente. Ningún endpoint verifica que quien llama sea ese `userId`.
- **CORS ≠ autorización.** El `cors` limita a JS de otros orígenes en el navegador, pero **no protege nada** frente a `curl`/scripts/Postman: cualquiera puede pegarle a cualquier endpoint con el correo de la víctima.

## Inventario completo de `server.js`

| Método · Ruta | userId del cliente | L/E | Qué devuelve / modifica | Verifica identidad |
|---|---|---|---|---|
| GET `/` (247) | — | — | string de salud | no aplica |
| GET `/auth/google` (265) | — | — | redirect a OAuth | público (inicia login) |
| GET `/auth/google/callback` (276) | — (Google da el email) | **E** | upsert de la cuenta (tokens) | **SÍ: el `code` de OAuth (Google verifica al usuario)** |
| GET `/auth/google/status/:userId` (327) | **ruta** | L | `{connected, email, needsReauth, hasCalendarScope}` | **NO** |
| GET `/api/detect-country` (344) | — | L | país por IP | no aplica |
| GET `/api/broadcasting/:key/:country` (364) | — | L (+cache) | dónde ver la liga | no aplica |
| DELETE `/api/broadcasting/:key/:country` (441) | — | **E** | borra cache de broadcasting | **NO** (dato no-usuario) |
| GET `/api/leagues/:sport` (455) | — | L | ligas | no aplica |
| GET `/api/teams/:leagueId` (473) | — | L | equipos | no aplica |
| GET `/api/players/:leagueId` (537) | — | L | jugadores | no aplica |
| GET `/api/match/:matchId` (610) | **query `?userId=` (opcional)** | L | datos del partido + `userSide` | **NO** |
| GET `/api/tickets/:matchId` (628) | — | L | links de boletos | no aplica |
| POST `/api/nearby` (700) | **body (opcional)** | L (+cache) | partidos cercanos + `userSide` | **NO** |
| GET `/api/admin/stats` (1038) | — | L | métricas agregadas | header `x-admin-user` |
| GET `/api/admin/sync-status` (1121) | — | L | estado de sync por liga | header `x-admin-user` |
| GET `/api/admin/round-labels` (1185) | — | L | etiquetas de fase | header `x-admin-user` |
| PUT `/api/admin/round-labels` (1203) | — | **E** | escribe etiqueta (config global) | header `x-admin-user` |
| GET `/api/admin/cleanup-calendar` (1226) | — | **E** | borra eventos duplicados de **TODOS** | header `x-admin-user` |
| POST `/api/admin/resync-user` (1328) | body | **E** | recrea eventos de un usuario | **localhost-only (IP 127.0.0.1)** |
| POST `/api/consent` (1430) | **body** | **E** | escribe `email_consent` del usuario | **NO** |
| GET `/api/reminders/:userId` (1448) | **ruta** | L | `{minutes}` | **NO** |
| PUT `/api/reminders/:userId` (1458) | **ruta** + body | **E** | set `reminder_minutes` + **patch al Google Calendar del usuario** | **NO** |
| POST `/subscriptions` (1495) | **body** | **E** | crea suscripción + **inyecta eventos al Calendar del usuario** | **NO** |
| GET `/subscriptions/:userId` (1541) | **ruta** | L | suscripciones del usuario | **NO** |
| DELETE `/subscriptions/:id` (1550) | **`id` de sub (ruta)** | **E** | borra suscripción + **borra eventos del Calendar** | **NO** (ni ownership) |
| POST `/subscriptions/sync` (1613) | — | **E** | sync global a **TODOS** los calendarios | **NO** |
| GET `/matches/:userId` (1650) | **ruta** | L | partidos + `favorites` + `userSide` | **NO** |
| POST `/summary/:matchId` (1701) | — | L (+cache ai_summary) | resumen IA del partido | **NO** (dato no-usuario) |

## Grupo 1 — Exponen datos de un usuario a cualquiera que sepa/adivine su correo (lectura)

- **GET `/auth/google/status/:userId`** → revela si un correo tiene cuenta, su email, si necesita reconexión, y si otorgó scope de Calendar.
- **GET `/subscriptions/:userId`** → lista completa de ligas/equipos que sigue.
- **GET `/matches/:userId`** → sus partidos + `favorites` (nombres de sus equipos/ligas) + `userSide`.
- **GET `/api/reminders/:userId`** → su preferencia de recordatorio.
- **GET `/api/match/:matchId?userId=`** y **POST `/api/nearby`** (con userId) → permiten *probar* si un correo dado sigue a uno de los equipos (via `userSide`).

## Grupo 2 — Permiten MODIFICAR algo de otro usuario (los que más importan)

Ninguno verifica identidad ni ownership. Todos alcanzables con `curl` + el correo (o un id) de la víctima:

- **POST `/subscriptions`** ⚠️ **el más grave.** Con `{ userId: victima, sport, competitionKey/teamName }` crea una suscripción ajena y **dispara sync inmediato que inserta eventos en el Google Calendar de la víctima** (1512-1535). Exactamente el escenario que sospechabas.
- **DELETE `/subscriptions/:id`** ⚠️ El `id` es `INTEGER AUTOINCREMENT` (secuencial, adivinable). Borra la suscripción de cualquiera **y en background borra los eventos huérfanos de su Calendar** (1559+). Destructivo y sin ownership.
- **PUT `/api/reminders/:userId`** ⚠️ Cambia `reminder_minutes` de otro usuario **y le hace `calendarList.patch` a su calendario de Google** (via `applyCalendarDefaultReminders`).
- **POST `/api/consent`** Modifica las preferencias de correo (`email_consent`) de cualquier userId.
- **POST `/subscriptions/sync`** No apunta a un usuario, pero **cualquiera puede disparar un sync global** que escribe en los calendarios de todos (abuso de recurso / forzar sync masivo).
- **DELETE `/api/broadcasting/...`** Borra cache compartida (no es dato de usuario, pero es un write abierto).

## Grupo 3 — Ya protegidos, y con qué mecanismo

- **`/api/admin/stats`, `/sync-status`, `/round-labels` (GET/PUT), `/cleanup-calendar`** → guard `req.headers['x-admin-user'] === 'lopezesmenjaud@gmail.com'`, si no → 403.
  - ⚠️ **Guard débil:** el "secreto" es un **correo hardcodeado y público** en un header. Cualquiera que mande `x-admin-user: lopezesmenjaud@gmail.com` pasa. No es un token secreto — es efectivamente **bypasseable**. (Incluye `cleanup-calendar`, que borra eventos de TODOS.)
- **`POST /api/admin/resync-user`** → **localhost-only real:** exige IP remota `127.0.0.1`/`::1`/`::ffff:127.0.0.1`, si no → 403 "Forbidden (localhost-only)". Protección a nivel de red (solo desde el shell de Render). **Esta sí es sólida.**
- **`GET /auth/google/callback`** → autenticado de verdad por el **`code` de OAuth** (Google verifica al usuario). Es el único punto con identidad real hoy.

## Datos verdaderamente sensibles en respuestas

**No se filtran tokens ni la clave.** Ningún endpoint devuelve el `access_token`, el `refresh_token`, la `TOKEN_ENCRYPTION_KEY`, ni el string de `scope`:

- `/auth/google/status` devuelve `hasCalendarScope` (booleano derivado), no el scope ni tokens.
- `resync-user` (localhost) devuelve email + IDs de calendario + conteos, **sin tokens**.
- Los tokens se desencriptan en el objeto de `getByUserId`/`getAll`, pero **ningún endpoint público hace `res.json` de la fila cruda**.
- Lo que sí se expone es **metadata**: existencia de cuenta, correo, a quién sigue, favoritos, preferencia de recordatorio, y el booleano de scope.

## Mecanismo de sesión en el frontend

**No hay sesión real.** `frontend/src/auth.js`: el usuario se guarda en `localStorage['fanschedule_user'] = { userId, email, name }`, seteado desde el **parámetro `?user=` de la URL de redirect** del callback OAuth. `getUserId()` lee ese localStorage. **No hay cookie, ni JWT, ni token de sesión, ni validación en el server.** Al recargar, la app solo relee el blob de localStorage; el `userId` (correo) es una string que el cliente manda y el backend cree ciegamente.

- **Sobre qué construir:** hoy no existe ningún token de sesión que verificar → para auth real hay que emitir algo. Pero la **materia prima sí existe**: el flujo OAuth (`/auth/google/callback`) es el único punto donde Google verifica identidad y obtenemos el email de forma confiable. Hoy eso se tira (se redirige con el email en la URL, sin firmar nada). O sea: hay de dónde partir (OAuth), pero no hay sesión/token emitido ni verificado.

## resync admin localhost-only

**Sí, sigue localhost-only** (`server.js:1328-1335`): rechaza con 403 salvo IP `127.0.0.1`/`::1`/`::ffff:127.0.0.1`.

---

## Resumen de severidad

Lo urgente es el **Grupo 2** (escritura cross-user sin identidad), y dentro de él **POST `/subscriptions`** y **DELETE `/subscriptions/:id`** por su efecto directo sobre el Google Calendar de terceros, más **PUT `/api/reminders/:userId`**. El **guard admin por header `x-admin-user`** es una protección aparente pero bypasseable.
