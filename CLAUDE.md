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
La verificación de Google OAuth está APROBADA. Cambiar `GOOGLE_SCOPES` o la
consent screen dispara re-verificación (semanas), y durante ese tiempo los
usuarios nuevos ven "aplicación no verificada". No tocar sin decisión explícita
de Julio. Arreglar la autorización del backend propio NO cuenta como tocar esto.

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
  la petición sea 200 y NO 304 antes de concluir que algo está roto.
- **Degradación limpia y orden de despliegue:** si un campo nuevo del backend no
  llega, el frontend no debe romperse. Y un cambio que el frontend necesita se
  despliega PRIMERO en el backend, tolerando ambas formas durante la transición.
- Decir cuándo algo es incertidumbre en vez de afirmarlo.

## Prioridad actual (ago 2026)
Arreglar la autorización. El userId es el correo del usuario, viaja en la URL y
los endpoints no verifican identidad — confirmado en producción. La auditoría
completa de los 28 endpoints está en `AUDITORIA-AUTORIZACION.md`. Es bloqueante
para la campaña de captación.

## Deuda técnica conocida (no tocar sin pedirlo)
- `/matches/:userId` y el backfill hacen `matchRepository.getAll()`: cargan la
  tabla COMPLETA de partidos y filtran en JS, por petición y por usuario. Es el
  cuello de botella principal de escalabilidad.
- La tabla `matches` nunca se purga.
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
