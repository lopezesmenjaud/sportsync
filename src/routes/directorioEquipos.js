// src/routes/directorioEquipos.js
//
// /equipos: el directorio de páginas de equipo. Sin él, desde fanschedule.com no había ningún
// camino a /equipo/:slug: la portada es la app de React y a un rastreador sin JavaScript no le
// entrega ni una liga. Este directorio es la puerta: se enlaza desde la barra y el pie de todas
// las páginas públicas y desde el pie de la portada.
//
// Lista EXACTAMENTE los equipos del sitemap (equiposConProximos, la misma función): los que
// tienen partidos próximos y pasan el piso de publicación (uno del catálogo, o dos o más si solo
// juega competencias de selecciones; ver pasaElPisoDePublicacion). Los demás llevan noindex y
// mandar ahí al visitante sería mandarlo a una página casi vacía.
//
// Agrupa por deporte y, dentro, por liga. Cada equipo va UNA vez, en la competencia que manda
// según la misma regla con que se etiqueta su suscripción (grupoDelEquipo).

const {
  ESTILOS,
  barra,
  pie,
  esc,
  SITIO,
  partidosFuturos,
  equiposConProximos,
  indiceEquipos,
  identidadDeEquipo,
  grupoDelEquipo,
  listasDeSeleccionesGuardadas,
  DEPORTES_DIRECTORIO,
  vistaDelPartido,
  instante,
} = require("./partidoPublico");

const ZONA = "America/Mexico_City";

const ESTILOS_DIRECTORIO = `
    .intro { margin: 0 0 12px; }
    .indice {
      margin: 0 0 28px;
      padding: 0;
      list-style: none;
      display: flex;
      flex-wrap: wrap;
      gap: 6px 14px;
      font-size: 15px;
    }
    .indice a { color: var(--naranja); text-decoration: none; }
    .indice a:hover, .indice a:focus { text-decoration: underline; }
    .deporte {
      margin: 32px 0 4px;
      font-size: 22px;
      line-height: 1.3;
    }
    .competencia {
      margin: 20px 0 10px;
      font-size: 17px;
      font-weight: 600;
      color: var(--gris);
      scroll-margin-top: 16px;
    }
    .equipos-lista {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 8px;
    }
    .equipo {
      border: 1px solid var(--borde);
      border-radius: 10px;
      padding: 10px 14px;
    }
    .equipo .renglon-titulo { margin-bottom: 2px; }
    .equipo .dato { margin: 0; font-size: 14px; }
    @media (min-width: 600px) {
      .equipos-lista { grid-template-columns: 1fr 1fr; }
    }
`;

// "sáb 18 oct, 7:00 p.m." — corto: aquí es un dato de apoyo, el detalle está en la página.
function fechaCorta(fecha) {
  return fecha.toLocaleString("es-MX", {
    timeZone: ZONA,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// Arma las secciones: [{ clave, nombre, competencias: [{ competencia, ancla, orden, equipos }] }].
async function armarDirectorio(ahora = Date.now()) {
  const partidos = await partidosFuturos(new Date(ahora).toISOString());
  const conProximos = equiposConProximos(partidos);
  const indice = await indiceEquipos();
  const gruposSelecciones = await listasDeSeleccionesGuardadas();

  // Partidos próximos por nombre base, ya en orden de fecha (partidosFuturos los da ordenados).
  const porBase = new Map();
  for (const match of partidos) {
    for (const base of [match.homeParticipantName, match.awayParticipantName]) {
      const limpio = String(base || "").trim();
      if (!limpio) continue;
      if (!porBase.has(limpio)) porBase.set(limpio, []);
      porBase.get(limpio).push(match);
    }
  }

  const deportes = new Map();
  for (const [slug, baseDelSitemap] of conProximos) {
    // Del índice salen el nombre público y TODAS sus competencias (no solo las de sus próximos
    // partidos), que es con lo que se decide su liga. Si por algo no está, se arma con lo mínimo.
    const equipo = indice.get(slug) || {
      slug,
      base: baseDelSitemap,
      nombre: identidadDeEquipo(baseDelSitemap).nombre,
      claves: [],
    };
    const proximos = porBase.get(equipo.base) || porBase.get(baseDelSitemap) || [];
    const grupo = grupoDelEquipo(equipo, gruposSelecciones) || {
      deporte: "otros",
      competencia: "Otras competencias",
      ancla: "otras",
      orden: 999,
    };

    if (!deportes.has(grupo.deporte)) deportes.set(grupo.deporte, new Map());
    const competencias = deportes.get(grupo.deporte);
    if (!competencias.has(grupo.ancla)) competencias.set(grupo.ancla, { ...grupo, equipos: [] });
    competencias.get(grupo.ancla).equipos.push({ equipo, proximos });
  }

  const ordenDeporte = (clave) => {
    const i = DEPORTES_DIRECTORIO.findIndex((d) => d.clave === clave);
    return i === -1 ? DEPORTES_DIRECTORIO.length : i;
  };
  const nombreDeporte = (clave) =>
    (DEPORTES_DIRECTORIO.find((d) => d.clave === clave) || { nombre: "Otros deportes" }).nombre;

  return [...deportes.entries()]
    .sort(([a], [b]) => ordenDeporte(a) - ordenDeporte(b))
    .map(([clave, competencias]) => ({
      clave,
      nombre: nombreDeporte(clave),
      competencias: [...competencias.values()]
        .sort((a, b) => a.orden - b.orden || a.competencia.localeCompare(b.competencia, "es"))
        .map((c) => ({
          ...c,
          equipos: c.equipos.sort((a, b) => a.equipo.nombre.localeCompare(b.equipo.nombre, "es")),
        })),
    }));
}

function renglonDeEquipo({ equipo, proximos }, competencia) {
  const n = proximos.length;
  const siguiente = proximos[0];
  let lineaSiguiente = "";
  if (siguiente) {
    const vista = vistaDelPartido(siguiente);
    const esLocal = siguiente.homeParticipantName === equipo.base;
    const rival = esLocal ? vista.nombreVisita : vista.nombreLocal;
    const fecha = instante(siguiente);
    const contra = rival ? (esLocal ? `vs ${rival}` : `en casa de ${rival}`) : vista.nombre;
    lineaSiguiente = `
            <p class="dato">Siguiente: ${esc(contra)}${fecha ? `, ${esc(fechaCorta(fecha))}` : ""}</p>`;
  }
  return `          <li class="equipo">
            <a class="renglon-titulo" href="/equipo/${esc(equipo.slug)}">${esc(equipo.nombre)}</a>
            <p class="dato">${esc(competencia)} · ${n} ${n === 1 ? "partido próximo" : "partidos próximos"}</p>${lineaSiguiente}
          </li>`;
}

function paginaDirectorio(deportes) {
  const competencias = deportes.flatMap((d) => d.competencias);
  const totalEquipos = competencias.reduce((s, c) => s + c.equipos.length, 0);

  const titulo = "Equipos: próximos partidos por deporte y liga";
  const nombres = competencias.map((c) => c.competencia);
  const descripcion = totalEquipos
    ? `Los ${totalEquipos} equipos con partidos próximos en FanSchedule, por deporte y liga: ${
        nombres.slice(0, 6).join(", ")
      }${nombres.length > 6 ? " y más" : ""}. Con cuántos partidos tiene cada uno y contra quién juega el siguiente.`
    : "Los equipos con partidos próximos en FanSchedule, por deporte y liga.";
  const urlCanonica = `${SITIO}/equipos`;

  const indiceHtml = competencias.length
    ? `      <ul class="indice">
${competencias.map((c) => `        <li><a href="#${esc(c.ancla)}">${esc(c.competencia)}</a></li>`).join("\n")}
      </ul>`
    : "";

  const secciones = deportes
    .map(
      (d) => `      <h2 class="deporte">${esc(d.nombre)}</h2>
${d.competencias
  .map(
    (c) => `      <h3 class="competencia" id="${esc(c.ancla)}">${esc(c.competencia)} (${c.equipos.length})</h3>
        <ul class="equipos-lista">
${c.equipos.map((e) => renglonDeEquipo(e, c.competencia)).join("\n")}
        </ul>`
  )
  .join("\n")}`
    )
    .join("\n");

  const vacio = totalEquipos
    ? ""
    : `      <section class="tarjeta">
        <p>Ahora mismo ningún equipo tiene partidos programados. En cuanto se publiquen los
        calendarios aparecen aquí.</p>
      </section>`;

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
    <style>${ESTILOS}${ESTILOS_DIRECTORIO}    </style>
  </head>
  <body>
${barra()}
    <main class="contenido">
      <h1>Equipos</h1>
      <p class="intro">Aquí están los equipos con partidos programados en FanSchedule. La página de
      cada uno muestra sus próximos partidos con la hora del centro de México, la competencia, si
      juega de local o de visitante y, cuando se sabe, por dónde se transmite. La lista se
      actualiza sola: los clubes aparecen en cuanto tienen un partido programado en alguna de las
      competencias de abajo, y las selecciones nacionales, cuando tienen por lo menos dos. Cada
      equipo sale de la lista cuando deja de cumplirlo.</p>
      <p class="dato">${totalEquipos} ${totalEquipos === 1 ? "equipo" : "equipos"} en ${
        competencias.length
      } ${competencias.length === 1 ? "competencia" : "competencias"}.</p>
${indiceHtml}
${secciones}${vacio}
    </main>
${pie()}
  </body>
</html>
`;
}

async function directorioEquiposHandler(req, res) {
  try {
    const deportes = await armarDirectorio();
    res.set("Cache-Control", "public, max-age=300, s-maxage=900, stale-while-revalidate=3600");
    res.set("Content-Type", "text/html; charset=utf-8");
    return res.send(paginaDirectorio(deportes));
  } catch (error) {
    console.error("[directorio-equipos] Error:", error.message);
    res.status(500);
    res.set("Content-Type", "text/plain; charset=utf-8");
    return res.send("No se pudo cargar el directorio de equipos.");
  }
}

module.exports = { directorioEquiposHandler, armarDirectorio };
