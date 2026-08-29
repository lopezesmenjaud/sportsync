# FanSchedule — reglas del proyecto

Habla siempre en español mexicano, informal y directo. Julio NO es programador:
explica el problema en plano antes de proponer código.

## Estructura
Monorepo con dos deploys independientes:
- Backend Node/Express/SQLite en la raíz → Render (sportsync-awqq.onrender.com)
- Frontend React/Vite en `frontend/` → Vercel (fanschedule.com)
Ambos se versionan juntos. Repo: github.com/lopezesmenjaud/sportsync

## Render — ruta del repo (error recurrente, léelo)
En el Shell de Render el repo vive en `~/project/src`, NO en `~/project`.
Estructura anidada: dentro hay OTRA carpeta `src`.
- Todo comando arranca con `cd ~/project/src`. Usar `cd ~/project` truena con
  "Cannot find module 'dotenv'".
- Los heredocs usan `require('./src/services/...')`, con el `src/` extra.
- `$USER` ya viene seteada en el shell de Render. Para filtrar por usuario en un
  job usa `TARGET_USER`, nunca `USER`.

## Endpoints con guard de localhost
Varios endpoints internos usan `localhostOnly` (commit ab51779). Para llamarlos
desde el Shell de Render hay que pegarle a `http://127.0.0.1:$PORT/...`:
- NO a la URL pública: sale y regresa por el proxy de Render y da 403.
- `127.0.0.1`, NO `localhost`: el server hace `app.listen(PORT, "0.0.0.0")`, así
  que si `localhost` resuelve a IPv6 la conexión ni llega.
Comprobado con curl en ambas direcciones el 1 ago 2026.

## Vercel
Root Directory DEBE ser `frontend`. Si un deploy falla con "No Output Directory
named 'dist'", el Root Directory se reseteó a la raíz.

## Git — reglas duras
- NUNCA `git add -A` ni `git add .`. Siempre `git add <archivo>` explícito.
- `git status` antes de cada commit para confirmar que no se cuela nada.
- Mostrar el diff y esperar aprobación de Julio antes de commit y antes de push.
- Un cambio por commit, con mensaje descriptivo.

## Guardrail de Google OAuth
La verificación de Google OAuth está APROBADA. Lo que dispara re-verificación NO es
cambiar `GOOGLE_SCOPES`, es la CATEGORÍA del scope nuevo. Antes de tocar nada, ver en
la Cloud Console (Data Access) en cuál de los tres cajones cae:
- **Non-sensitive:** se puede agregar y salir a producción sin re-verificación, sin
  justificación y sin video. Comprobado el 28 ago 2026 con `calendar.app.created`:
  Google guardó y no apareció ningún aviso de revisión.
- **Sensitive o restricted:** ahí sí dispara re-verificación (semanas), y mientras
  dura, los usuarios nuevos ven "aplicación no verificada". Eso NO se toca sin
  decisión explícita de Julio.

Los scopes de Calendar configurados hoy:
- `calendar.app.created` — **non-sensitive**. Es el que se pide (`server.js`,
  `GOOGLE_SCOPES`). Solo alcanza los calendarios que la app creó.
- `auth/calendar` — **sensible, aprobado**. Ya NO se pide, pero se deja configurado
  para poder revertir sin esperar otra verificación. Los usuarios que lo concedieron
  lo siguen trayendo en su token; `src/config/googleScopes.js` acepta los dos.

Dos cosas que ya se comprobaron el 28 ago 2026 y NO hay que volver a investigar:
- **Un calendario creado bajo `auth/calendar` se sigue alcanzando con
  `calendar.app.created`.** Julio revocó el acceso desde su cuenta de Google,
  reconectó con el scope estrecho, y el calendario "FanSchedule" que ya existía
  conservó sus eventos viejos y recibió los nuevos (suscripción a NFL) en ese mismo
  calendario. No se creó uno nuevo. O sea: no hay que migrar ni recrear el calendario
  de nadie.
- **Los usuarios ya conectados NO tienen que reconectarse.** Su token viejo con
  `auth/calendar` sigue siendo válido, `hasCalendarScope` acepta los dos scopes, y
  van a pasar al permiso nuevo solos cuando les toque reconectar. No hay migración que
  correr ni aviso que mandar.

Arreglar la autorización del backend propio NO cuenta como tocar esto.

## Forma de trabajar (esto es lo que más importa)
- **Investigación de solo lectura ANTES de proponer.** Reportar hallazgos y la
  decisión clave que Julio tiene que tomar, y esperar. Ha funcionado cuatro veces
  y las cuatro destapó algo que habríamos roto.
- **Verificar con datos, no deducir.** Si una afirmación se puede comprobar
  corriendo algo, compruébala. Si Julio plantea un razonamiento, valídalo contra
  el código antes de implementar sobre él: ya pasó que su premisa era falsa y
  pararse a tiempo evitó el bug.
- **Grep exhaustivo de TODOS los llamadores** al cambiar la firma de una función,
  incluyendo scripts sueltos y src/jobs/. Así apareció un job que creaba eventos
  reales sin la etiqueta nueva, en silencio.
- **Escrituras masivas: dry-run obligatorio.** Sin CONFIRM=1 no se escribe nada.
  Luego CONFIRM=1 con TARGET_USER y MAX=5, verificar, y hasta el final el resto.
  Un job hace UNA cosa y se llama como lo que hace.
- **Antes de push:** `node --check` en cada archivo de backend tocado y
  `npm run build` en frontend/ si tocaste frontend.
- **Al validar un deploy:** en DevTools palomear "Disable cache" y confirmar que
  la petición sea 200 y NO 304 antes de concluir que algo está roto. Si hay un
  service worker vivo, "Disable cache" NO basta: hay que ir a Application →
  Service workers → Bypass for network. Se detecta mirando si cambió el nombre
  del bundle en la columna Initiator; si no cambió, estás viendo la versión vieja
  aunque el deploy ya haya terminado.
  Matiz importante: hoy `public/sw.js` existe pero NADIE lo registra, y
  `index.html:37` desregistra el que encuentre (con un comentario que dice "for
  development"). Así que esto solo aplica a quien arrastre un service worker de
  antes de ese código; para la mayoría no hay ninguno. No lo toques sin pedirlo:
  la app SÍ es PWA instalable (`public/manifest.json`, `display: standalone`).
- **Degradación limpia y orden de despliegue:** si un campo nuevo del backend no
  llega, el frontend no debe romperse. Y un cambio que el frontend necesita se
  despliega PRIMERO en el backend, tolerando ambas formas durante la transición.
- Decir cuándo algo es incertidumbre en vez de afirmarlo.

## Prioridad actual (ago 2026)
- La vulnerabilidad de autorización está **CERRADA** (3 ago, `ALLOW_LEGACY_USERID=false`,
  verificado en incógnito). Ya no bloquea nada. La auditoría original está en
  `AUDITORIA-AUTORIZACION.md`, pero es una foto del estado ANTERIOR: varios de sus
  renglones ya no describen el código de hoy.
- **Prioridad técnica actual:** parte 2 del arreglo del cleanup de
  `DELETE /subscriptions/:id` — calcular "huérfano" por usuario y no contra las
  suscripciones de todos.
- **El cuello de botella del proyecto YA NO es técnico.** Es conseguir usuarios:
  probadores fríos, estrategia de captación, redes sociales. Nada de eso es código.
  Así que al terminar una tarea, NO propongas ampliar el alcance técnico por inercia
  — la lista técnica nunca se va a vaciar y ya no es lo que decide si el proyecto
  avanza.

## Idioma: TODO en español, sin i18n
La app va entera en español. NO proponer detección por navegador, diccionarios de
strings ni librerías de i18n: sería maquinaria para un solo idioma. Decidido el
7 ago 2026, después de considerarlo y descartarlo. El momento de meter el
mecanismo es cuando exista una versión completa en inglés, no antes.

## Publicidad: de dónde puede salir un segmento

Se PUEDE segmentar publicidad con lo que la persona eligió dentro de la app
—deportes, ligas, equipos que sigue—, con su país o región, y con el contenido de
la página que está viendo. Es dato de primera mano y está declarado en la
Política de Privacidad.

NO se puede usar NADA que venga de las APIs de Google —el contenido del
calendario, sus eventos, sus otros calendarios— para elegir, segmentar ni medir
publicidad. Lo prohíbe la política de Uso Limitado de Google y pondría en riesgo
la verificación de OAuth, que ya está aprobada.

La regla corta: el segmento sale de lo que la persona nos dijo, nunca de lo que
leímos de su calendario. Si alguna vez se propone deducir intereses a partir de
eventos del calendario, la respuesta es no.

Y cuando se sirva por Ad Manager: las etiquetas que acompañan la petición de
anuncio (liga, equipo, país) NUNCA pueden llevar nada que identifique a la
persona — ni correo, ni userId.

## Deuda técnica conocida (no tocar sin pedirlo)
- **Rama legacy: NO barrerla todavía.** Con `ALLOW_LEGACY_USERID=false` ya no se
  ejecuta (el camino viejo de `requireUser`, `deleteById` en
  `subscriptionRepositorySqlite`, y los `legacyAnonymous` de `DELETE /subscriptions/:id`
  y `POST /subscriptions/sync`). Se queda a propósito: es el camino de revertir si
  algo sale mal cuando reconecten los tres usuarios que faltan. Se borra cuando los
  tres hayan reconectado bien, en su propio commit.
- `/matches/:userId` y el backfill hacen `matchRepository.getAll()`: cargan la
  tabla COMPLETA de partidos y filtran en JS, por petición y por usuario. Es el
  cuello de botella principal de escalabilidad.
- La tabla `matches` nunca se purga.
- La tabla `sessions` tampoco se purga: las vencidas y las revocadas se acumulan
  para siempre. Con 7 usuarios da igual; con miles no.
- El frontend llama a `/subscriptions/sync` (sync GLOBAL) al suscribirse, aunque
  `POST /subscriptions` ya trae un sync inmediato. Probablemente redundante.
- `GET /api/admin/cleanup-calendar` es un GET que borra datos. Cambiar a POST.
- Config de deportes hardcodeada en ~9 lugares; olvidar uno hace que los eventos
  nunca lleguen al calendario, en silencio.
- Doble conversión de timezone en /api/nearby (server.js:752 y 958).
- Si `currentStartUtc` y `scheduledStartUtc` son ambos null, se crea un evento en
  1970 sin avisar. Falta guard clause.
- Duración de evento fija en 2 h; corta para MLB.
- Node 24 antes de oct 2026.
