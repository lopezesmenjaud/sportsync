# Restaurar la base de datos desde un respaldo

Esto es para el día en que la base de producción se dañó o se perdió y hay que regresarla a
como estaba en el último respaldo. Síguelo en orden y sin saltarte pasos.

> **Este procedimiento NO se ha ejecutado nunca en producción.** Lo que sí está probado es el
> ensayo (`runPruebaRestauracion.js`), que comprueba que un respaldo sirve sin tocar nada. Los
> pasos de parar y arrancar Render (4 y 7) están escritos a partir de cómo funciona Render, no de
> haberlos corrido. Si algo no se ve como dice aquí, detente y pregunta antes de seguir.

---

## Antes de empezar: qué se pierde

La base regresa al momento del respaldo. Los respaldos se hacen una vez al día (10:15 UTC, 4:15
en CDMX), así que **se pierde todo lo que pasó desde ese respaldo hasta ahora**, hasta 24 horas:

- **Usuarios nuevos** que se conectaron después: tendrán que volver a conectar su Google.
- **Suscripciones** que alguien agregó o quitó después: regresan a como estaban.
- **Sesiones**: quien inició sesión después tendrá que volver a entrar.
- **Eventos duplicados en Google Calendar.** La app decide qué partidos ya puso en el calendario
  de cada persona leyendo SOLO su propia base (`userBackfillService.js`, la tabla
  `calendar_events`); no le pregunta a Google. Los eventos que se crearon después del respaldo
  siguen en el Google Calendar de la gente, pero la base restaurada no sabe que existen, así que
  el siguiente sync los va a volver a crear: **la persona los verá dos veces**. El sync arranca
  solo 5 segundos después de que la app vuelve, así que no hay forma de evitarlo: se limpian
  después, con `runBorrarHuerfanos.js` (paso 8).
- **Suscripciones que la persona QUITÓ y que la restauración le revive (el riesgo más serio).**
  Si alguien se dio de baja de un equipo después del respaldo, la base restaurada lo tiene
  suscrito otra vez, y la app va a volver a meterle en su calendario los partidos nuevos de un
  equipo que quitó a propósito. No es un dato perdido: es la app pasando por encima de una
  decisión de la persona. Hay que encontrar a esas personas y quitarles esa suscripción
  (paso 8).

Si el problema es pequeño (un dato mal escrito, una tabla), **no restaures**: casi siempre sale
más barato arreglar ese dato. Restaurar es para cuando la base completa ya no sirve.

---

## Lo que NO debes hacer nunca

- **No copies el respaldo encima de `sportsync.db` con la app prendida.** La app tiene la base
  abierta y la seguiría escribiendo encima.
- **No dejes un `sportsync.db-wal` ni un `sportsync.db-shm` al lado de la base restaurada.**
  Esos dos archivos pertenecen a la base ANTERIOR: el `-wal` trae escrituras que todavía no
  entraban al `.db` viejo. Si se quedan junto a la base restaurada, SQLite intenta aplicar esas
  escrituras viejas sobre una base que no es la suya, y la puede corromper. El respaldo es una
  base completa por sí sola: no necesita ningún `-wal` ni `-shm`.
- **No borres la base vieja.** Se mueve a una carpeta aparte, por si hay que regresar.
- **No toques la carpeta `respaldos/`.** Solo se lee de ahí.

---

## Pasos

Todo lo que dice "en la Shell" es la Shell de Render del servicio web (dashboard de Render →
el servicio → Shell). Copia los comandos tal cual, una línea a la vez.

### 1. Elegir el respaldo

En la Shell:

```
ls -l /var/data/respaldos
```

Los nombres llevan fecha y hora UTC (`sportsync-2026-10-23T1015Z.db` = 23 oct 2026, 10:15 UTC).
Normalmente se usa **el más reciente**. Usa uno anterior solo si sabes que el daño ya venía
desde antes. Apunta el nombre exacto.

### 2. Ensayar ese respaldo (la app sigue prendida, no se toca nada)

En la Shell, cambiando el nombre por el que elegiste:

```
cd ~/project/src && NODE_ENV=production RESPALDO=sportsync-2026-10-23T1015Z.db node src/jobs/runPruebaRestauracion.js
```

Al final dice uno de tres veredictos:

- **`APTA`**: sigue.
- **`APTA CON AVISO`**: el respaldo sirve, pero su estructura no es idéntica a la de producción
  (normalmente porque un deploy agregó algo después del respaldo). Puedes seguir. **Copia y
  guarda la lista de diferencias que imprime**: si después de restaurar algo falla con
  "no such column" o "no such table", esa lista dice por qué.
- **`NO APTA`**: **no sigas** con ese respaldo. Prueba con el anterior, y si ninguno sale APTA,
  detente y pide ayuda.

(Si la base de producción está tan dañada que el ensayo ni siquiera puede leerla, el ensayo va a
salir NO APTA por eso y no por el respaldo. En ese caso pide ayuda antes de seguir.)

### 3. Apuntar cómo está corriendo hoy la app

Tres cosas, y las vas a necesitar en los pasos 4 y 7:

1. **El comando de arranque.** Dashboard de Render → el servicio → **Settings** →
   **Start Command**. Copia exactamente lo que dice (probablemente `npm start` o
   `node server.js`).
2. **El commit que está corriendo.** Dashboard de Render → el servicio → **Events**. El evento
   más reciente que dice **"Deploy live"** muestra un código corto (por ejemplo `13b058f`) y el
   mensaje del commit. Apunta ese código. Es el código que sabemos que funciona; la
   restauración se hace con ese, no con lo último que alguien haya subido a GitHub.
3. **Cómo está el Auto-Deploy hoy.** En **Settings** busca **Auto-Deploy** y apunta si dice
   **Yes** o **No**. No lo cambies tú: el deploy del paso 4 ("Deploy a specific commit") lo va a
   apagar de todos modos, solo, y así se queda apagado durante la restauración. En el paso 7 lo
   dejas otra vez como lo apuntaste aquí.

### 4. Apagar la app sin apagar el disco

No se puede usar "Suspend": con el servicio suspendido tampoco hay Shell, y sin Shell no se
puede cambiar el archivo. En lugar de eso se arranca el servicio con un programa mínimo que solo
contesta "en mantenimiento" y **no abre la base**.

En **Settings → Start Command**, reemplaza lo que hay por esto (una sola línea):

```
node -e "require('http').createServer((q,s)=>s.end('FanSchedule en mantenimiento')).listen(process.env.PORT,'0.0.0.0')"
```

(Contesta con 200 y no con un error a propósito: si Render tiene configurado un health check, un
error haría que diera el deploy por fallido.)

Guarda, y luego despliega **el mismo commit que apuntaste en el paso 3**, nunca "el último":
**Manual Deploy → Deploy a specific commit**, elige de la lista el código que apuntaste (o
pégalo), y confirma con **Deploy Commit**. No uses "Deploy latest commit": si alguien subió algo
a GitHub desde el último deploy, desplegarías código sin probar en plena emergencia.

Esto apaga el Auto-Deploy del servicio por sí solo. Es normal; se arregla en el paso 7.

Espera a que diga **Live**.

Comprueba que sí está apagada: abre https://sportsync-awqq.onrender.com en el navegador; debe
decir "FanSchedule en mantenimiento". Y en **Logs** ya no deben aparecer líneas `[scheduler]`.
Si aparecen, la app sigue viva: **no sigas**.

**Apunta la hora en que quedó apagada.** La vas a necesitar en el paso 8.

### 5. Mover la base vieja a un lado (con sus -wal y -shm)

En la Shell, una línea a la vez:

```
cd /var/data && ls -l
```

```
mkdir /var/data/base-anterior-$(date -u +%Y-%m-%dT%H%MZ) && ls -d /var/data/base-anterior-*
```

Apunta el nombre de la carpeta que acaba de aparecer y úsalo en la siguiente línea en lugar de
`CARPETA`:

```
mv /var/data/sportsync.db /var/data/sportsync.db-wal /var/data/sportsync.db-shm /var/data/CARPETA/
```

Si dice que `sportsync.db-wal` o `sportsync.db-shm` no existen, está bien: es que no había.
Los tres van juntos a la misma carpeta porque son de la misma base.

Comprueba que ya no queda ninguno al lado:

```
ls -l /var/data
```

**No debe aparecer ningún `sportsync.db`, ni `-wal`, ni `-shm`.** Solo carpetas.

### 6. Poner el respaldo como base

Cambiando el nombre por el que elegiste en el paso 1:

```
cp /var/data/respaldos/sportsync-2026-10-23T1015Z.db /var/data/sportsync.db && chmod 600 /var/data/sportsync.db
```

Comprueba:

```
ls -l /var/data
```

Debe aparecer **solo** `sportsync.db` (con `-rw-------`), sin `-wal` ni `-shm`. Y que el archivo
esté sano:

```
cd ~/project/src && node -e "const D=require('better-sqlite3');const d=new D('/var/data/sportsync.db',{readonly:true});console.log(d.pragma('integrity_check',{simple:true}));d.close()"
```

Debe imprimir `ok`. Si imprime otra cosa, **no arranques la app**: regresa la base vieja
(`mv` de vuelta desde la carpeta del paso 5) y pide ayuda.

Ese comando abre la base solo para leer, pero SQLite puede crear un `sportsync.db-shm` vacío al
lado. Ese sí es de esta base y no hace daño.

### 7. Volver a prender la app

En **Settings → Start Command**, pon de nuevo **exactamente** lo que apuntaste en el paso 3.
Guarda, y despliega otra vez **el mismo commit del paso 3**, igual que en el paso 4:
**Manual Deploy → Deploy a specific commit** → el código apuntado → **Deploy Commit**. Espera a
que diga **Live**.

Ahora el Auto-Deploy: Render lo apagó solo al desplegar un commit específico. Entra a
**Settings → Auto-Deploy** y **comprueba con tus ojos** en qué quedó. Déjalo exactamente como
lo apuntaste en el paso 3 (si estaba en Yes, ponlo en Yes y guarda). No supongas que quedó bien:
míralo.

Por qué importa: si se queda apagado, FanSchedule deja de desplegarse desde GitHub para
siempre, sin ningún aviso. Nadie se entera hasta que alguien note, semanas después, que un push
no surtió efecto.

### 8. Comprobar que quedó bien

En **Logs**, al arrancar deben aparecer, en este orden aproximado:

- `✅ Connected to SQLite database`
- varias líneas `✅ ... ready` (tablas listas)
- `[scheduler] Starting automatic sync scheduler...`
- `[scheduler] Scheduled Respaldo de la base — diario, 10:15`

Que no haya líneas con `Error` o `SQLITE_` justo al arrancar.

Luego, en una ventana de incógnito:

1. Abre https://fanschedule.com e inicia sesión con tu cuenta.
2. Revisa que aparezcan tus suscripciones.

#### 8a. Esperar antes de revisar calendarios

Antes de seguir tienen que cumplirse **las dos** cosas:

- Que hayan pasado **al menos 60 minutos desde la hora que apuntaste en el paso 4** (cuando la
  app quedó apagada). El job que borra duplicados no toca eventos de menos de 60 minutos
  (`MIN_EDAD_MINUTOS`, `runBorrarHuerfanos.js:51`), para no borrar uno que la app está
  creando en ese momento. Todos los duplicados que hay que borrar se crearon ANTES del paso 4,
  así que después de esa hora ya todos tienen edad suficiente.
- Que haya terminado el sync de arranque: en **Logs** ya no aparecen líneas `[scheduler]` nuevas
  durante unos minutos.

#### 8b. Ver cómo quedó el calendario de cada persona (no escribe nada)

En la Shell:

```
cd ~/project/src && node src/jobs/runAuditoriaCalendario.js
```

Al final imprime una tabla con **una fila por usuario**. Fíjate en dos columnas:

- **`huérfanos`**: eventos que están en el Google Calendar de esa persona pero que la base no
  conoce. Después de restaurar, son los **duplicados**.
- **`fantasmas`**: filas que la base cree que están en Google pero ya no están. Después de
  restaurar, son la pista de **quién se dio de baja** (8d).

Si algún usuario sale como "no medible", no se pudo revisar contra Google; apúntalo.

#### 8c. Borrar los duplicados

Para **cada** usuario con `huérfanos` mayor que cero, cambiando el correo, y una línea a la vez:

Primero el ensayo (no borra nada, solo dice qué borraría):

```
cd ~/project/src && TARGET_USER=correo@ejemplo.com node src/jobs/runBorrarHuerfanos.js
```

Luego solo 5:

```
cd ~/project/src && TARGET_USER=correo@ejemplo.com CONFIRM=1 MAX=5 node src/jobs/runBorrarHuerfanos.js
```

Si puedes, revisa con esa persona que en su calendario siga habiendo **un** evento por partido
(no cero). Luego el resto:

```
cd ~/project/src && TARGET_USER=correo@ejemplo.com CONFIRM=1 node src/jobs/runBorrarHuerfanos.js
```

Cómo sabe cuál borrar: de cada par repetido, el evento viejo (creado después del respaldo) no
tiene fila en la base y el nuevo (el que creó el sync al arrancar) sí. El job solo borra los que
no tienen fila, solo dentro del calendario FanSchedule, y solo si la descripción trae el link
`fanschedule.com/match/`, para no tocar nada que la persona haya creado a mano.

Si el ensayo dice **"descartados por ser recientes"** con un número mayor que cero, todavía no
pasaron los 60 minutos: espera y vuelve a correrlo.

Ojo: si alguien **se suscribió** a algo después del respaldo, la base restaurada no tiene esa
suscripción, así que esos eventos también salen como huérfanos y se borran. Esa persona tiene
que volver a suscribirse (ver "Antes de empezar").

#### 8d. Encontrar a quien se dio de baja y la restauración le revivió la suscripción

Cuando alguien se da de baja, la app borra de Google los eventos **futuros** que esa suscripción
cubría, y también sus filas en la base (`server.js`, `DELETE /subscriptions/:id`). Al
restaurar, las filas regresan pero los eventos de Google no. Eso es exactamente lo que la
auditoría llama **fantasma**. Así que **la lista de fantasmas es la lista de personas a quienes
probablemente hay que volver a quitarles una suscripción**.

Para cada usuario con `fantasmas` mayor que cero, mira de qué competencia son:

```
cd ~/project/src && TARGET_USER=correo@ejemplo.com node src/jobs/runAuditoriaCalendario.js
```

En la sección **"3b. FANTASMAS"** sale una tabla por competencia. Esa competencia (o un equipo
de ella) es, muy probablemente, la suscripción que la persona había quitado.

**No es prueba**, y por dos lados:

- **Puede sobrar gente:** un fantasma también aparece si la persona borró un evento a mano desde
  su propio calendario, o si ya existía antes del problema.
- **Puede faltar gente:** si al darse de baja esa suscripción no tenía partidos futuros, no se
  borró nada en Google y no queda ningún fantasma. Y si Google falló al borrar en ese momento,
  la app conservó la fila y el evento a propósito, así que tampoco hay fantasma. Una lista vacía
  NO garantiza que nadie se dio de baja.

Qué hacer: **contacta a cada persona de la lista** y pídele que confirme y que se dé de baja otra
vez desde la app. Hazlo el mismo día: mientras la suscripción siga viva, cada sync (el de tenis
corre cada 3 horas) le puede agregar partidos nuevos de ese equipo. Al darse de baja otra vez,
la app limpia sola esas filas (si el evento ya no está en Google, lo cuenta como borrado). No
hay un job para quitarle la suscripción a otra persona; no edites la base a mano.

### 9. Después

- **No borres** la carpeta `base-anterior-...` el mismo día. Déjala unos días por si hay que
  regresar.
- Cuando ya estés seguro, **sí bórrala**: trae los tokens de Google de todos los usuarios.
  ```
  rm -r /var/data/CARPETA
  ```
- Avísale a los usuarios que se conectaron después del respaldo (si sabes quiénes) que vuelvan a
  conectar su Google.

---

## Si algo sale mal a la mitad

- **Entre los pasos 4 y 6:** la base vieja está completa en la carpeta del paso 5. Para
  regresarla: borra el `sportsync.db` que copiaste (si alcanzaste a copiarlo), regresa con `mv`
  los tres archivos de esa carpeta a `/var/data/`, y sigue con el paso 7.
- **La app no arranca en el paso 7:** pon otra vez el comando de mantenimiento del paso 4 para
  poder usar la Shell sin que la app escriba, y pide ayuda. No pruebes otro respaldo a ciegas.
- **Render también guarda una foto del disco completo cada 24 h por 7 días** (Disk → Snapshots).
  Es el último recurso: esa foto se toma con la app escribiendo, así que el `sportsync.db` de
  ahí puede venir incompleto. Pero adentro trae la carpeta `respaldos/`, que sí es consistente.
