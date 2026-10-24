// Entrada del build SSR (vite build --ssr). NO la carga el navegador: la usa solo
// scripts/generarPortada.mjs al compilar, para escribir el HTML de la portada.
//
// Genera LandingPage en su estado SIN datos: sin tarjetas y sin cinta, que es lo mismo que
// pinta el navegador antes de que lleguen los partidos. Por eso el HTML no puede quedarse
// anunciando un partido que ya se jugó.
//
// La regla de fast refresh no aplica: este archivo nunca lo carga el servidor de desarrollo.
/* eslint-disable react-refresh/only-export-components */
import { renderToString } from 'react-dom/server'
import LandingPage from './pages/LandingPage'

export { STORAGE_KEY } from './auth'

export function render() {
  return renderToString(<LandingPage />)
}
