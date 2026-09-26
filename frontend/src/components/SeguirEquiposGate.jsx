import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { apiFetch } from '../api'
import { getUserId, isLoggedIn } from '../auth'
import { isPublicPath } from '../publicRoutes'
import { leerContextoSeguir, borrarContextoSeguir } from '../seguir'
import { useHayModalAbierto } from '../modalesEnCurso'

// Pantalla de "seguir al equipo por el que llegaste", para quien entró por una página pública.
//
// Sale SOLO si hay contexto guardado (seguir.js) y DESPUÉS de los modales que ya existen (correos
// y permiso de calendario). Sin contexto no hace nada: quien entra directo a la app ve lo mismo
// que antes. El contexto se borra en cuanto la pantalla se muestra.
//
// La suscripción se crea con el MISMO POST /subscriptions y el MISMO cuerpo que TeamPicker en
// "Todos los partidos" (competitionKey null). teamName es el nombre EXACTO de los partidos, que
// manda el backend: el apodo es solo para el texto del botón.
//
// "¿Ya lo sigue?" compara nombre de equipo Y deporte, nunca la etiqueta de competencia: el
// Bayern seguido desde la Bundesliga en la app y ofrecido desde una página de Champions es el
// mismo equipo. Es la misma comparación que hace POST /subscriptions para no duplicar.
export default function SeguirEquiposGate() {
  const { pathname } = useLocation()
  const hayOtroModal = useHayModalAbierto()

  // Se lee una vez al montar. saveUserFromUrl y capturarSeguirDeUrl ya corrieron antes del render.
  const [contexto] = useState(() => (isLoggedIn() ? leerContextoSeguir() : null))
  const [equipos, setEquipos] = useState(null)
  const [siguiendo, setSiguiendo] = useState([])   // teamName que ya sigue (antes o aquí)
  const [nuevos, setNuevos] = useState(0)          // cuántos siguió en esta pantalla
  const [guardando, setGuardando] = useState(null)
  const [error, setError] = useState(null)
  const [cerrada, setCerrada] = useState(false)

  useEffect(() => {
    if (!contexto) return
    let vivo = true
    Promise.all([
      apiFetch(`/api/seguir?contexto=${encodeURIComponent(contexto)}`).then((r) => r.json()),
      apiFetch(`/subscriptions/${getUserId()}`).then((r) => r.json()),
    ])
      .then(([ofrecer, subs]) => {
        if (!vivo) return
        if (!ofrecer?.ok || !Array.isArray(ofrecer.equipos) || !subs?.ok) return  // se reintenta en la siguiente carga
        if (ofrecer.equipos.length === 0) { borrarContextoSeguir(); return }        // nada que ofrecer
        const yaSigue = ofrecer.equipos
          .filter((e) => (subs.subscriptions || []).some((s) => s.teamName === e.teamName && s.sport === e.sport))
          .map((e) => e.teamName)
        setSiguiendo(yaSigue)
        setEquipos(ofrecer.equipos)
      })
      .catch(() => { /* sin red: el contexto sigue guardado hasta que caduque */ })
    return () => { vivo = false }
  }, [contexto])

  const visible = Boolean(equipos) && !cerrada && !hayOtroModal && !isPublicPath(pathname)

  // Se usa UNA vez: en cuanto se muestra, se borra.
  useEffect(() => { if (visible) borrarContextoSeguir() }, [visible])

  if (!visible) return null

  const seguir = async (equipo) => {
    if (guardando) return
    setGuardando(equipo.teamName)
    setError(null)
    try {
      // Mismo cuerpo que TeamPicker.jsx (handleConfirm) en "Todos los partidos".
      const res = await apiFetch('/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: getUserId(),
          sport: equipo.sport,
          competitionKey: null,
          competitionName: equipo.competitionName,
          teamName: equipo.teamName,
        }),
      })
      const data = await res.json()
      if (!data.ok) { setError(`No se pudo seguir a ${equipo.apodo}. Intenta de nuevo.`); return }
      setSiguiendo((prev) => [...prev, equipo.teamName])
      setNuevos((n) => n + 1)
    } catch {
      setError(`No se pudo seguir a ${equipo.apodo}. Revisa tu conexión.`)
    } finally {
      setGuardando(null)
    }
  }

  const cerrar = () => {
    // Sin esto, los partidos que ya estaban en la base no se agendan hasta la siguiente corrida
    // del scheduler: POST /subscriptions solo agenda partidos NUEVOS o que cambiaron. Rellena
    // solo a esta persona (no el /subscriptions/sync global de TeamPicker) y no se espera.
    if (nuevos > 0) {
      apiFetch('/subscriptions/rellenar', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
        .catch((e) => console.error('[seguir] rellenar:', e))
    }
    setCerrada(true)
  }

  const todosSeguidos = equipos.every((e) => siguiendo.includes(e.teamName))
  const etiquetaSalida = nuevos > 0 ? 'Listo' : todosSeguidos ? 'Continuar' : 'Ahora no'

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 2100 }}>
      <div style={{ background: '#ffffff', borderRadius: 20, padding: '36px 32px', maxWidth: 440, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 16 }}>📅</div>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: '#1C2430', marginBottom: 10 }}>
          {equipos.length > 1 ? '¿A quién quieres seguir?' : '¿Lo agregamos a tu calendario?'}
        </h2>
        <p style={{ fontSize: 14, color: '#666666', lineHeight: 1.5, marginBottom: 22 }}>
          Sus partidos entran solos a tu Google Calendar, y si cambian de horario se actualizan.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
          {equipos.map((equipo) => siguiendo.includes(equipo.teamName) ? (
            <div key={equipo.teamName} style={{ fontSize: 14, color: '#06D6A0', fontWeight: 500, padding: '12px 0' }}>
              ✓ Ya sigues a {equipo.apodo}
            </div>
          ) : (
            <button
              key={equipo.teamName}
              onClick={() => seguir(equipo)}
              disabled={Boolean(guardando)}
              style={{ width: '100%', background: '#F18006', border: 'none', borderRadius: 12, padding: '15px', fontSize: 15, fontWeight: 600, color: '#fff', cursor: guardando ? 'wait' : 'pointer', opacity: guardando === equipo.teamName ? 0.7 : 1 }}
            >
              {guardando === equipo.teamName ? 'Guardando...' : `Seguir ${equipo.apodo}`}
            </button>
          ))}
        </div>

        {error && <div style={{ fontSize: 13, color: '#b91c1c', marginBottom: 10 }}>{error}</div>}

        <button
          onClick={cerrar}
          style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: 13, cursor: 'pointer', textDecoration: 'underline', padding: 4 }}
        >
          {etiquetaSalida}
        </button>
      </div>
    </div>
  )
}
