// src/services/reglaTemporadas.js
//
// Decide qué temporadas de una liga pedirle al proveedor, y las pide. Lo usa syncLeague.
// Es un módulo PURO: no toca la base ni sabe de caché; recibe la lista de temporadas y una
// función para pedir una temporada. Así se puede probar solo, sin base.
//
// LA REGLA (la misma que midió runCompararReglaTemporadas.js: 0 de 15,695 combinaciones donde
// traiga menos que la vieja, y completitud 0):
//   1. Recorrer las MISMAS variantes que adivina getSeasonVariants, en el MISMO orden, saltando
//      las que no están en la lista del proveedor. Detenerse en la primera con partidos.
//   2. Si ninguna trajo nada: probar las temporadas de la lista que NO son variantes y cuyo año
//      mayor es este año o después ("2027" de la clasificación a la Copa Africana, "2030" de las
//      eliminatorias del siguiente ciclo), de la más nueva a la más vieja, hasta la primera con
//      partidos.
//   3. El respaldo (eventsnextleague) NO se corre aquí: syncLeague lo corre siempre que el paso 1
//      no trajo nada, y suma lo que traiga.
//
// SIN LISTA (lista null: la llamada falló o vino vacía) se porta EXACTAMENTE como la regla de
// antes: prueba todas las variantes. Falla del lado seguro: una caída del proveedor nunca
// convierte el ahorro en un apagón.
//
// NO hay "guarda" (pedir siempre la variante principal) ni "reintento de lista": decidido el
// 28 sep 2026. Un partido que el sync deja de traer no se borra de ningún calendario, así que lo
// único en juego con una lista vieja es un retraso de a lo más la vigencia de la caché.

function anioMayor(temporada) {
  const anios = String(temporada).match(/\d{4}/g);
  return anios ? Math.max(...anios.map(Number)) : null;
}

/**
 * @param {object}   p
 * @param {string[]} p.variantes       las de getSeasonVariants, en su orden
 * @param {string[]|null} p.lista      temporadas del proveedor; null = no hay lista (regla vieja)
 * @param {number}   p.anioActual      para el paso 2
 * @param {(temporada: string) => Promise<object[]>} p.pedirTemporada
 *        pide UNA temporada ya recortada a la ventana del sync. Si lanza, se registra y se sigue
 *        con la siguiente, igual que antes.
 * @param {(msg: string) => void} [p.log]
 * @returns {Promise<{ eventos: object[], camino: "variante"|"extra"|"ninguno", temporada: string|null, llamadas: number }>}
 *   camino "variante": lo encontró el paso 1. "extra": el paso 2. "ninguno": ni uno ni otro
 *   (syncLeague corre el respaldo en los casos "extra" y "ninguno").
 */
async function buscarPorTemporadas({ variantes, lista, anioActual, pedirTemporada, log = () => {} }) {
  let llamadas = 0;

  async function probar(temporada) {
    llamadas += 1;
    try {
      return await pedirTemporada(temporada);
    } catch (error) {
      log(`season "${temporada}" failed: ${error.message}`);
      return [];
    }
  }

  const enLista = lista ? new Set(lista) : null;

  // Paso 1: las variantes de siempre, en su orden. Sin lista, todas (regla vieja).
  for (const temporada of variantes) {
    if (enLista && !enLista.has(temporada)) continue;
    const eventos = await probar(temporada);
    if (eventos.length > 0) return { eventos, camino: "variante", temporada, llamadas };
  }

  // Paso 2: solo con lista. Sin lista no hay de dónde sacar temporadas extra.
  if (lista) {
    const extras = lista
      .filter(t => !variantes.includes(t))
      .filter(t => { const a = anioMayor(t); return a !== null && a >= anioActual; })
      .reverse();
    for (const temporada of extras) {
      const eventos = await probar(temporada);
      if (eventos.length > 0) return { eventos, camino: "extra", temporada, llamadas };
    }
  }

  return { eventos: [], camino: "ninguno", temporada: null, llamadas };
}

module.exports = { buscarPorTemporadas, anioMayor };
