import { useEffect } from 'react'

// Carga del script de AdSense. ÚNICA fuente: nadie más debe inyectar adsbygoogle.js.
//
// Por qué no vive en index.html: AdSense rechazó el sitio (sept 2026) por "anuncios publicados
// por Google en pantallas sin contenido de publicadores". El script estaba en el <head> del
// index.html, que es la cáscara de TODAS las pantallas, así que arrancaba igual en el admin, en
// las pantallas de error y en cualquier pantalla mientras todavía estaba cargando.
//
// La regla de AdSense NO es pública contra privada: es CON contenido contra SIN contenido. Una
// pantalla con sesión iniciada y llena de información sí puede llevar anuncios; una vacía no.
// Por eso cada pantalla decide por su cuenta, con su propio estado, y solo dice que sí cuando el
// contenido YA está en pantalla — nunca mientras carga y nunca con la lista vacía.
//
// La propiedad del dominio NO depende de este script. La cubren dos de los tres métodos que
// AdSense acepta, y los dos son estáticos y visibles sin ejecutar JavaScript:
//   1. el <meta name="google-adsense-account"> de index.html
//   2. /ads.txt con el mismo ID de editor
// Por eso se puede sacar de la cáscara sin quedar desverificados.
const ID_EDITOR = 'ca-pub-8736805003532889'
const URL_SCRIPT = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + ID_EDITOR

// Marca en el <script> para reconocer el nuestro en el DOM.
const MARCA = 'data-fanschedule-ads'

// Una sola carga por sesión de navegación. Es una SPA: no hay recarga entre pantallas, así que
// basta una bandera de módulo. Al recargar la página el módulo se reevalúa y vuelve a false.
let yaSeCargo = false

export function cargarAnuncios() {
  if (yaSeCargo) return
  // Cinturón y tirantes: si por lo que sea el script ya está en el DOM (un remount raro, o
  // alguien lo volvió a meter en el HTML), no se duplica. Cargar adsbygoogle.js dos veces
  // ensucia la consola y no sirve de nada.
  if (document.querySelector('script[' + MARCA + ']')) {
    yaSeCargo = true
    return
  }

  const script = document.createElement('script')
  script.async = true
  script.src = URL_SCRIPT
  script.crossOrigin = 'anonymous'
  script.setAttribute(MARCA, '')
  document.head.appendChild(script)
  yaSeCargo = true
}

// Hook que usan las pantallas. `califica` es la respuesta a "¿esta pantalla tiene contenido real
// AHORA MISMO?". Se reevalúa en cada render, así que una pantalla que empieza cargando y termina
// con resultados pasa de false a true sola, y el script entra hasta ese momento.
//
// Ojo con lo que este hook NO puede hacer: una vez cargado, el script se queda vivo mientras no
// se recargue la página. Si alguien va de una pantalla con contenido a una sin él, no hay forma
// de "descargarlo". Lo que sí se garantiza es que nunca ARRANCA en una pantalla sin contenido,
// que es lo que AdSense señaló.
export function useAnuncios(califica) {
  useEffect(() => {
    if (califica) cargarAnuncios()
  }, [califica])
}
