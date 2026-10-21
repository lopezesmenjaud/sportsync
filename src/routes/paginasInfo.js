// src/routes/paginasInfo.js
//
// Páginas informativas públicas: /acerca, /contacto, /privacy y /terms. Se sirven desde Express,
// igual que /equipo, para que un buscador sin JavaScript reciba el texto completo. Cuando eran
// componentes de React, Googlebot recibía el index.html vacío de la app: cero palabras y el
// título genérico de la portada.
//
// Usan el mismo estilo, la misma barra y el mismo pie que las páginas de partido y de equipo.
//
// /privacy y /terms son TEXTO LEGAL. Se movieron palabra por palabra desde los componentes de
// React (PrivacyPolicy.jsx y TermsOfService.jsx, ya borrados) y se comprobó contra lo que esos
// componentes renderizaban. Cualquier cambio al texto es un cambio a la política: se actualiza
// también la fecha de "Última actualización".
//
// 20 oct 2026: se corrigieron las frases de las dos páginas que daban por hecho que el sitio ya
// muestra anuncios (todavía no los muestra). Ahora dicen que FanSchedule usa Google AdSense, que
// es cierto hoy: el script de AdSense se carga en seis pantallas de la app. Las cookies NO se
// condicionan a que haya anuncios, porque no sabemos si el script las deja aunque no se vean.
// También se corrigió de dónde salen los anuncios: frontend/src/ads.js solo carga el script
// estándar con el ID de editor y no le pasa nada del usuario (ni suscripciones ni país), así que
// la política dice que los elige Google. Si algún día se le mandan etiquetas (Ad Manager), esto se
// vuelve a cambiar ANTES de mandarlas.

const { ESTILOS, barra, pie, esc, SITIO } = require("./partidoPublico");

// Lo que estas páginas necesitan y las de partido no: texto corrido, con encabezados, listas y
// enlaces dentro del párrafo. Va aparte de ESTILOS para no cambiar el HTML de las otras páginas.
const ESTILOS_TEXTO = `
    .texto h2 {
      margin: 28px 0 10px;
      font-size: 20px;
      line-height: 1.3;
    }
    .texto p { margin: 0 0 14px; }
    .texto ul { margin: 0 0 14px; padding-left: 20px; }
    .texto li { margin: 0 0 8px; }
    .texto a { color: var(--naranja); }
    .texto code {
      font-family: ui-monospace, Consolas, monospace;
      font-size: 14px;
      background: rgba(28, 36, 48, 0.08);
      padding: 2px 6px;
      border-radius: 4px;
    }
    .texto .dato { margin-bottom: 20px; }
    .texto .cierre {
      margin-top: 32px;
      font-weight: 600;
    }
`;

const PAGINAS = {
  acerca: {
    ruta: "/acerca",
    titulo: "Acerca de FanSchedule",
    descripcion:
      "FanSchedule pone los partidos de tus equipos en tu Google Calendar, con la hora del centro de México. Gratis y sin tarjeta. Qué puedes seguir, de dónde salen los datos y quién lo hizo.",
    cuerpo: `      <h1>Acerca de FanSchedule</h1>
      <p>FanSchedule pone los partidos de tus equipos en tu Google Calendar. Eliges a quién sigues una vez, y de ahí en adelante sus partidos se agendan solos, con la hora del centro de México. Si les cambian el horario, el evento se actualiza. Te avisa antes de cada uno.</p>
      <p>Es gratis y no pide tarjeta.</p>

      <h2>Cómo funciona</h2>
      <p>Conectas tu cuenta de Google y le das permiso para tu calendario. FanSchedule crea un calendario nuevo, llamado "FanSchedule", y solo escribe ahí. No toca tus otros calendarios y ni siquiera pide permiso para verlos.</p>
      <p>Eliges tus ligas, tus equipos o tus deportistas, y ya. No hay que volver a entrar: los partidos aparecen en el calendario que ya usas, junto a lo demás de tu día.</p>
      <p>Cada evento trae en el título si tu equipo juega de local o de visitante, y adentro los dos equipos, la competencia, el estadio y el link a la página de ese partido.</p>

      <h2>Qué puedes seguir</h2>
      <p>Fútbol: Liga MX, La Liga, Premier League, Champions League y varias decenas de ligas más.</p>
      <p>Fútbol de selecciones, varonil y femenil. Puedes seguir una confederación, y te llegan solo sus partidos oficiales, o seguir una selección, y te llegan todos, amistosos incluidos.</p>
      <p>NFL completa, NBA, MLB y Fórmula 1.</p>
      <p>Tenis por categoría —Grand Slams, Masters 1000, Copa Davis, Laver Cup— o siguiendo a un jugador.</p>
      <p>Y cuando sigues un equipo eliges si quieres todos sus partidos o solo los de una competencia.</p>

      <h2>Recordatorios a tu medida</h2>
      <p>En tu perfil decides cuánto antes quieres el aviso: una hora, 45, 30, 15, 10 o 5 minutos antes, justo cuando empieza, o ninguno. Por omisión son 30 minutos.</p>

      <h2>Partidos cerca de ti</h2>
      <p>Si lo tuyo es ir al estadio, la pantalla "Cerca de mí" te muestra los partidos que se juegan en tu ciudad en los próximos 30 días. Compartes tu ubicación o escribes la ciudad a mano.</p>
      <p>Un límite que conviene que sepas: solo busca ligas del país donde estás. Un partido de Champions o de la selección no aparece ahí, aunque se juegue cerca.</p>

      <h2>Planea tu viaje</h2>
      <p>Escribes el destino y las fechas y ves qué partidos hay durante tu estancia. Funciona dentro de los próximos 30 días, que es hasta donde alcanza nuestra información, y con la misma regla de arriba: ligas del país al que vas.</p>

      <h2>Boletos</h2>
      <p>En cada partido te dejamos lista la búsqueda en Ticketmaster y StubHub. No vendemos boletos ni ganamos nada con ellos: es un atajo para que no tengas que teclear el nombre del partido a mano.</p>

      <h2>Dónde verlo</h2>
      <p>En algunos partidos te decimos por dónde se transmite en México. Para la Liga MX, la selección mexicana y el tenis lo tengo revisado a mano. Para el resto es una sugerencia de inteligencia artificial y puede equivocarse.</p>

      <h2>Quién lo hizo</h2>
      <p>Lo hice yo, Julio López. No hay empresa ni equipo detrás: soy una persona que se cansó de enterarse de los partidos cuando ya habían terminado, y que terminó programando la solución.</p>
      <p>Por eso puedo contestarte yo mismo si escribes, y por eso casi todo lo que tiene FanSchedule salió de que alguien lo pidió.</p>

      <h2>De dónde salen los datos</h2>
      <p>Los calendarios de partidos vienen de TheSportsDB, y los de tenis de Live Tennis API. Los horarios se convierten a la hora del centro de México.</p>
      <p>Usamos inteligencia artificial para cuatro cosas: escribir el resumen de cada equipo y de cada partido, sugerir por dónde se transmite un partido, ubicar en qué ciudad se juega para "Cerca de mí", y poner la etiqueta de la fase de un torneo, como "Cuartos" o "Final".</p>
      <p>Los resúmenes de equipo se escriben únicamente con los datos que ya tenemos: no inventan récords ni resultados. Los de partido todavía no funcionan así —ahí el modelo escribe con lo que sabe por su cuenta—, así que tómalos como contexto y no como dato. Lo estoy cambiando.</p>
      <p>Si ves un dato mal, escríbeme y lo corrijo.</p>

      <h2>Qué no hacemos</h2>
      <p>FanSchedule no manda correos. No vende boletos. No publica resultados en vivo.</p>

      <h2>Tus datos</h2>
      <p>FanSchedule solo escribe en tu calendario los partidos de los equipos que tú elegiste. No vendemos ni compartimos tu información. Puedes quitarnos el permiso a tu calendario cuando quieras desde tu cuenta de Google. El detalle completo está en la <a href="/privacy">política de privacidad</a>.</p>

      <p class="cierre"><a href="/contacto">¿Dudas o sugerencias? Escríbeme.</a></p>
`,
  },

  contacto: {
    ruta: "/contacto",
    titulo: "Contacto",
    descripcion:
      "Escríbele a Julio López, quien hizo FanSchedule: si algo no funciona, si ves un dato equivocado o si quieres seguir un equipo o una liga que todavía no está.",
    cuerpo: `      <h1>Contacto</h1>
      <p>Escríbeme a <a href="mailto:julio.lopez@fanschedule.com">julio.lopez@fanschedule.com</a>. Contesto yo.</p>
      <p>Si algo no funciona, si ves un dato equivocado, o si te gustaría seguir un equipo o una liga que todavía no está, ése es el camino. Casi todo lo que tiene FanSchedule salió de que alguien lo pidió.</p>
`,
  },

  privacy: {
    ruta: "/privacy",
    titulo: "Política de privacidad",
    descripcion:
      "Qué datos recopila FanSchedule, cómo los usa, con quién los comparte y cómo puedes eliminarlos. Los datos de tu Google Calendar no se usan para publicidad.",
    cuerpo: `      <h1>Política de privacidad</h1>
      <p class="dato">Última actualización: 20 de octubre de 2026</p>
      <p>
      En FanSchedule respetamos tu privacidad. Esta página explica qué información recopilamos,
      cómo la usamos y qué control tienes sobre ella.
      </p>
      <section>
      <h2>1. Qué datos recopilamos</h2>
      <ul>
      <li><strong>Nombre y correo</strong> de tu cuenta de Google, obtenidos vía OAuth cuando inicias sesión.</li>
      <li><strong>Ligas y equipos favoritos</strong> que seleccionas dentro de la app.</li>
      <li><strong>Consentimiento de email marketing</strong>: si aceptaste recibir novedades del producto o comunicaciones de partners.</li>
      <li><strong>Eventos sincronizados</strong> a tu Google Calendar: identificadores y metadatos de los partidos que añadimos.</li>
      </ul>
      </section>
      <section>
      <h2>2. Cómo usamos los datos</h2>
      <ul>
      <li>Para <strong>sincronizar los partidos</strong> de tus ligas y equipos en tu Google Calendar.</li>
      <li>Para <strong>enviarte novedades del producto</strong> y comunicaciones de partners, únicamente si diste tu consentimiento.</li>
      <li>Para mostrarte <strong>información relevante de deportes</strong> (próximos partidos, eventos cercanos, planificador de viajes).</li>
      <li><strong>No le mandamos tus datos a Google para la publicidad.</strong> Los anuncios de Google AdSense los elige Google, no FanSchedule, y no le pasamos tus deportes, ligas ni equipos, ni tu país o región (ver sección 7).</li>
      </ul>
      </section>
      <section>
      <h2>3. Con quién compartimos datos</h2>
      <p>
      Para que FanSchedule funcione, enviamos cierta información a estos servicios:
      </p>
      <ul>
      <li><strong>Google Calendar</strong>: con tu autorización, creamos y actualizamos en tu propio calendario los eventos de los partidos que eliges.</li>
      <li><strong>OpenStreetMap / Nominatim</strong>: en las funciones "Cerca de mí" y "Planear viaje", tu navegador envía tu ubicación (coordenadas) o el nombre de una ciudad a este servicio para determinar a qué ciudad corresponde.</li>
      <li><strong>Anthropic (Claude)</strong>: enviamos datos de los partidos (equipos, estadios) y la ciudad que consultas, para generar la información de "dónde ver", "eventos cercanos" y resúmenes de partidos. No enviamos tu nombre ni tu correo.</li>
      <li><strong>ip-api.com</strong>: cuando abres la app, enviamos tu dirección IP a este servicio para detectar tu país automáticamente. No almacenamos tu IP.</li>
      <li><strong>Google AdSense</strong>: FanSchedule usa Google AdSense, el servicio de publicidad de Google. Google y sus socios pueden usar cookies o identificadores similares en tu navegador para mostrar y medir anuncios.</li>
      </ul>
      <p>
      También obtenemos información de las siguientes fuentes, a las que no les enviamos tus datos personales — solo consultas sobre partidos y eventos:
      </p>
      <ul>
      <li><strong>TheSportsDB</strong>: fuente de datos de partidos, equipos y ligas.</li>
      <li><strong>Ticketmaster</strong>: información de boletos para los partidos.</li>
      </ul>
      <p>
      <strong>No vendemos tus datos a terceros.</strong> Solo compartimos lo estrictamente necesario
      con los servicios anteriores para que FanSchedule funcione.
      </p>
      </section>
      <section>
      <h2>4. Datos de Google y Uso Limitado</h2>
      <p>
      El uso y la transferencia que hace FanSchedule de la información recibida de las APIs de Google
      se ajustará a la Política de Datos de Usuario de los Servicios de la API de Google, incluyendo
      los requisitos de Uso Limitado (Limited Use). En concreto, los datos de tu Google Calendar:
      </p>
      <ul>
      <li>se usan únicamente para crear y actualizar los eventos de los partidos que tú eliges;</li>
      <li>no se utilizan con fines publicitarios;</li>
      <li>no se venden ni se transfieren a terceros, salvo lo estrictamente necesario para operar la app o cuando la ley lo exija;</li>
      <li>no son leídos por ninguna persona, salvo que tú lo autorices expresamente o sea requerido por ley.</li>
      </ul>
      <p>
      Esto también vale para la publicidad de Google AdSense que usa FanSchedule: no compartimos
      los datos de tu Google Calendar con Google AdSense, con anunciantes ni con ningún tercero con
      fines publicitarios, y no los usamos para elegir ni segmentar los anuncios que veas. Los
      anuncios los elige Google, con el contenido de la página y con la información que Google ya
      tenga de ti; FanSchedule no le manda tus suscripciones ni tus datos, y nunca información de tu
      calendario.
      </p>
      </section>
      <section>
      <h2>5. Medidas de protección de datos</h2>
      <p>
      Aplicamos las siguientes medidas para proteger tu información, en particular
      los datos sensibles asociados a tu cuenta de Google:
      </p>
      <ul>
      <li><strong>Cifrado en tránsito</strong>: toda la comunicación entre tu navegador, FanSchedule y las APIs de Google se realiza mediante conexiones cifradas HTTPS/TLS.</li>
      <li><strong>Cifrado de credenciales en reposo</strong>: los tokens de acceso y actualización de Google que autorizan la sincronización con tu calendario se almacenan cifrados con AES-256-GCM, un algoritmo de cifrado autenticado. Las claves de cifrado se gestionan mediante variables de entorno del servidor y nunca se incluyen en el código fuente ni en el repositorio.</li>
      <li><strong>Sin registro de credenciales</strong>: los tokens de acceso no se escriben en registros (logs), ni completos ni parciales, y no se exponen en ninguna respuesta de la aplicación ni en su interfaz.</li>
      <li><strong>Sin acceso humano a tu calendario</strong>: la creación y actualización de eventos es un proceso totalmente automatizado. Ninguna persona de FanSchedule lee, revisa ni accede al contenido de tu Google Calendar.</li>
      <li><strong>Minimización de datos</strong>: solicitamos únicamente los permisos necesarios para el funcionamiento del servicio y almacenamos solo los datos indispensables para operarlo. No almacenamos tu ubicación precisa ni datos de pago. Para mostrarte información relevante podemos registrar tu país o región aproximada, deducidos de tu dirección IP, que no guardamos. Las coordenadas que usa "Cerca de mí" se envían en el momento y no se almacenan.</li>
      <li><strong>Acceso restringido</strong>: las funciones administrativas del servicio están limitadas y las operaciones sensibles solo pueden ejecutarse desde el propio servidor, no de forma remota.</li>
      <li><strong>Revocación en cualquier momento</strong>: puedes retirar el acceso de FanSchedule a tu cuenta de Google cuando quieras desde la configuración de seguridad de tu cuenta de Google, sin necesidad de contactarnos.</li>
      </ul>
      </section>
      <section>
      <h2>6. Cómo eliminamos tus datos</h2>
      <p>
      Puedes cerrar sesión en cualquier momento desde la app. Si quieres eliminar por completo
      tu cuenta y todos los datos asociados, escríbenos a
      <a href="mailto:julio.lopez@fanschedule.com">julio.lopez@fanschedule.com</a>
      y procesaremos tu solicitud.
      </p>
      </section>
      <section>
      <h2>7. Cookies, almacenamiento y publicidad</h2>
      <p>
      Usamos <code>localStorage</code> del navegador para mantener tu sesión
      iniciada y recordar tus preferencias (deportes, equipos, consentimiento de email).
      </p>
      <p>
      FanSchedule usa Google AdSense, el servicio de publicidad de Google. Google —como proveedor
      externo— y sus socios pueden usar cookies o identificadores similares
      en tu navegador para mostrar y medir anuncios, incluidos anuncios basados en tus visitas
      anteriores a este o a otros sitios. El script de Google se carga dentro de nuestras páginas y
      puede ver el contenido de la pantalla en la que está; en algunas pantallas, ese contenido
      incluye los partidos de los equipos que sigues.
      </p>
      <p>
      Puedes desactivar la publicidad personalizada cuando quieras desde la Configuración de
      anuncios de tu cuenta de Google, en
      <a href="https://www.google.com/settings/ads" target="_blank" rel="noopener noreferrer">google.com/settings/ads</a>.
      También puedes desactivar el uso de cookies publicitarias de terceros en
      <a href="https://www.aboutads.info" target="_blank" rel="noopener noreferrer">www.aboutads.info</a>,
      o bloquear y borrar cookies desde la configuración de tu navegador. Nada de eso te impide
      usar FanSchedule.
      </p>
      <p>
      Los anuncios que veas en FanSchedule <strong>NO</strong> se eligen con información de tu Google Calendar
      (ver sección 4).
      </p>
      </section>
      <section>
      <h2>8. Menores de edad</h2>
      <p>
      FanSchedule no está dirigido a menores de 13 años y no recopilamos a sabiendas datos de menores de esa edad.
      </p>
      </section>
      <section>
      <h2>9. Cambios a esta política</h2>
      <p>
      Podemos actualizar esta política ocasionalmente. Si hacemos cambios importantes, actualizaremos
      la fecha de "última actualización" en la parte superior de esta página.
      </p>
      </section>
      <section>
      <h2>10. Contacto</h2>
      <p>
      Si tienes dudas sobre esta política o quieres ejercer tus derechos sobre tus datos,
      escríbenos a <a href="mailto:julio.lopez@fanschedule.com">julio.lopez@fanschedule.com</a>.
      </p>
      </section>
`,
  },

  terms: {
    ruta: "/terms",
    titulo: "Términos del Servicio",
    descripcion:
      "Las condiciones de uso de FanSchedule: tu cuenta, uso aceptable, datos deportivos de terceros, la integración con Google Calendar, el plan gratuito y la publicidad.",
    cuerpo: `      <h1>Términos del Servicio</h1>
      <p class="dato">Última actualización: 20 de octubre de 2026</p>
      <p>
      Bienvenido a FanSchedule. Estos Términos del Servicio ("Términos") regulan el uso de la
      aplicación y el sitio web fanschedule.com ("el Servicio"). Al usar FanSchedule, aceptas
      estos Términos. Si no estás de acuerdo, por favor no uses el Servicio.
      </p>
      <section>
      <h2>1. Qué es FanSchedule</h2>
      <p>
      FanSchedule es una aplicación que te permite seguir tus ligas y equipos favoritos y
      sincronizar automáticamente los partidos en tu Google Calendar. También ofrece funciones
      complementarias como información de dónde ver los partidos, eventos cercanos y planificación
      de viajes.
      </p>
      </section>
      <section>
      <h2>2. Tu cuenta</h2>
      <p>
      Para usar FanSchedule inicias sesión con tu cuenta de Google. Eres responsable de mantener
      la seguridad de tu cuenta de Google y de la actividad que ocurra a través de ella. Debes
      proporcionar información veraz y usar el Servicio conforme a estos Términos.
      </p>
      </section>
      <section>
      <h2>3. Uso aceptable</h2>
      <p>
      Te comprometes a no usar FanSchedule para fines ilegales ni de forma que pueda dañar,
      deshabilitar o sobrecargar el Servicio. En particular, no debes intentar acceder sin
      autorización a nuestros sistemas o a los de terceros, ni usar medios automatizados para
      extraer datos del Servicio, ni interferir con su funcionamiento normal.
      </p>
      </section>
      <section>
      <h2>4. Datos deportivos y de terceros</h2>
      <p>
      La información de partidos, equipos, ligas, boletos y ubicaciones proviene de fuentes de
      terceros (incluyendo TheSportsDB, Ticketmaster, OpenStreetMap y otros). Hacemos un esfuerzo
      razonable para mostrar información precisa y actualizada, pero no garantizamos que los
      horarios, fechas, sedes o cualquier otro dato sean exactos o estén libres de errores.
      Verifica siempre la información oficial antes de tomar decisiones (por ejemplo, comprar
      boletos o planear un viaje).
      </p>
      </section>
      <section>
      <h2>5. Integración con Google Calendar</h2>
      <p>
      Con tu autorización, FanSchedule crea y actualiza eventos en tu Google Calendar. Tú
      controlas esta conexión y puedes revocarla en cualquier momento desde la configuración de
      tu cuenta de Google. El manejo de los datos de Google se rige por nuestra
      <a href="/privacy">Política de Privacidad</a> y por la Política de
      Datos de Usuario de los Servicios de la API de Google.
      </p>
      </section>
      <section>
      <h2>6. Planes gratuitos y de pago</h2>
      <p>
      FanSchedule ofrece y seguirá ofreciendo un plan gratuito. En el futuro podremos introducir
      funciones o planes de pago opcionales ("premium") además del plan gratuito. Cualquier
      función de pago se te cobrará únicamente si la contratas de forma expresa, y te informaremos
      de sus condiciones y precios antes de que la actives. El plan gratuito seguirá disponible
      con independencia de que existan opciones de pago.
      </p>
      <p>
      FanSchedule es gratuito y usa Google AdSense, el servicio de publicidad de Google. Al usar el
      servicio aceptas que se muestren anuncios de terceros dentro del sitio. La forma en que esos anuncios usan cookies
      y datos se explica en nuestra
      <a href="/privacy">Política de Privacidad</a>.
      </p>
      </section>
      <section>
      <h2>7. Disponibilidad del Servicio</h2>
      <p>
      Hacemos lo posible por mantener FanSchedule disponible y funcionando, pero el Servicio se
      ofrece "tal cual" y "según disponibilidad". Podemos modificar, suspender o discontinuar el
      Servicio (total o parcialmente) en cualquier momento, sin que ello genere responsabilidad
      hacia ti.
      </p>
      </section>
      <section>
      <h2>8. Limitación de responsabilidad</h2>
      <p>
      En la medida permitida por la ley, FanSchedule no será responsable por daños indirectos,
      incidentales o consecuentes derivados del uso o la imposibilidad de usar el Servicio,
      incluyendo pérdidas ocasionadas por información deportiva inexacta, eventos de calendario
      incorrectos o interrupciones del Servicio. Tu uso de FanSchedule es bajo tu propio riesgo.
      </p>
      </section>
      <section>
      <h2>9. Propiedad intelectual</h2>
      <p>
      FanSchedule, su nombre, logotipo y el software que lo compone son propiedad de sus
      creadores. Los nombres de ligas, equipos y competiciones pertenecen a sus respectivos
      titulares y se usan únicamente con fines informativos.
      </p>
      </section>
      <section>
      <h2>10. Terminación</h2>
      <p>
      Puedes dejar de usar FanSchedule en cualquier momento y solicitar la eliminación de tu
      cuenta conforme a nuestra
      <a href="/privacy">Política de Privacidad</a>. Podemos suspender o
      terminar tu acceso al Servicio si incumples estos Términos.
      </p>
      </section>
      <section>
      <h2>11. Cambios a estos Términos</h2>
      <p>
      Podemos actualizar estos Términos ocasionalmente. Si hacemos cambios importantes,
      actualizaremos la fecha de "última actualización" en la parte superior de esta página. El
      uso continuado del Servicio tras los cambios implica tu aceptación de los mismos.
      </p>
      </section>
      <section>
      <h2>12. Contacto</h2>
      <p>
      Si tienes dudas sobre estos Términos, escríbenos a
      <a href="mailto:julio.lopez@fanschedule.com">julio.lopez@fanschedule.com</a>.
      </p>
      </section>
`,
  },
};

function paginaInfo({ ruta, titulo, descripcion, cuerpo }) {
  const urlCanonica = `${SITIO}${ruta}`;
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(titulo)} | FanSchedule</title>
    <meta name="description" content="${esc(descripcion)}" />
    <link rel="canonical" href="${esc(urlCanonica)}" />

    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="FanSchedule" />
    <meta property="og:title" content="${esc(titulo)}" />
    <meta property="og:description" content="${esc(descripcion)}" />
    <meta property="og:url" content="${esc(urlCanonica)}" />
    <meta property="og:image" content="${SITIO}/og-image.png" />
    <meta property="og:locale" content="es_MX" />
    <style>${ESTILOS}${ESTILOS_TEXTO}    </style>
  </head>
  <body>
${barra()}
    <main class="contenido texto">
${cuerpo}    </main>
${pie()}
  </body>
</html>
`;
}

// Las cuatro son texto fijo: cambian solo con un deploy. Se arman una vez al cargar el módulo.
const HTML = Object.fromEntries(Object.entries(PAGINAS).map(([clave, p]) => [clave, paginaInfo(p)]));

function handlerDe(clave) {
  return (req, res) => {
    res.set("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
    res.set("Content-Type", "text/html; charset=utf-8");
    return res.send(HTML[clave]);
  };
}

module.exports = {
  acercaHandler: handlerDe("acerca"),
  contactoHandler: handlerDe("contacto"),
  privacyHandler: handlerDe("privacy"),
  termsHandler: handlerDe("terms"),
  // Las rutas, para el sitemap: salen de la misma lista, así una página nueva no se queda fuera.
  RUTAS_INFO: Object.values(PAGINAS).map((p) => p.ruta),
};
