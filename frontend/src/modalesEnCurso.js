import { useEffect, useSyncExternalStore } from 'react'

// Qué modales de App están abiertos o por decidirse, para que la pantalla de seguir equipos salga
// DESPUÉS de ellos y no encima. Cada modal avisa con useMarcarModal; SeguirEquiposGate pregunta
// con useHayModalAbierto. No cambia cuándo sale ninguno de los modales que ya existían: solo
// dicen si están abiertos.
//
// En el primer render todavía nadie avisó y esto dice "ninguno". No importa: la pantalla de
// seguir equipos no puede salir en el primer render, espera la respuesta del backend, y para
// entonces los efectos de los otros modales ya corrieron.

const abiertos = new Set()
const oyentes = new Set()

function avisar() {
  oyentes.forEach((f) => f())
}

function suscribir(f) {
  oyentes.add(f)
  return () => { oyentes.delete(f) }
}

export function useMarcarModal(id, abierto) {
  useEffect(() => {
    if (abierto) abiertos.add(id)
    else abiertos.delete(id)
    avisar()
    return () => { abiertos.delete(id); avisar() }
  }, [id, abierto])
}

export function useHayModalAbierto() {
  return useSyncExternalStore(suscribir, () => abiertos.size > 0)
}
