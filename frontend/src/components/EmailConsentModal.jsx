import { useState } from 'react'
import { apiFetch } from '../api'

// Modal de consentimiento de correos: dos permisos SEPARADOS (novedades y ofertas de socios).
//
// - Los textos llegan del servidor (GET /api/consent -> textos), tal cual están aprobados en
//   src/data/textosConsentimiento.json. Aquí no hay copia: si la hubiera y difiriera, la versión
//   guardada ya no diría lo que la persona leyó.
// - Las dos casillas empiezan APAGADAS, también para quien tiene permisos del modal viejo:
//   prellenar ese "sí" amarrado sería tratarlo como si lo hubiera elegido por separado.
// - Guardar con las dos apagadas ES contestar que no. "Ahora no" NO es contestar (lo maneja quien
//   abre el modal: pospone, y la persona sigue en "nunca contestó").
// - El modal NO se cierra hasta que el servidor confirma. Mientras guarda, el botón dice
//   "Guardando…" y no se puede volver a picar; si falla, se queda abierto y lo dice. Nada se da por
//   contestado si no quedó guardado (el modal viejo hacía lo contrario: .catch(() => {})).
export default function EmailConsentModal({ textos, onGuardado, onPosponer }) {
  const [novedades, setNovedades] = useState(false)
  const [socios, setSocios] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  const guardar = async () => {
    if (guardando) return
    setGuardando(true)
    setError(null)
    try {
      const res = await apiFetch('/api/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailFanschedule: novedades, versionNovedades: textos.version,
          emailPartners: socios, versionSocios: textos.version,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data || !data.ok) throw new Error('no confirmado')
      onGuardado()
    } catch {
      setError('No se pudo guardar. Inténtalo otra vez.')
      setGuardando(false)
    }
  }

  const casilla = (marcada, alCambiar, texto) => (
    <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', textAlign: 'left', padding: '12px 14px', border: '1px solid #e8e8e8', borderRadius: 12, cursor: guardando ? 'wait' : 'pointer' }}>
      <input
        type="checkbox"
        checked={marcada}
        disabled={guardando}
        onChange={e => alCambiar(e.target.checked)}
        style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0, accentColor: '#F18006' }}
      />
      <span style={{ fontSize: 14, color: '#1C2430', lineHeight: 1.5 }}>{texto}</span>
    </label>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 2000 }}>
      <div style={{ background: '#ffffff', borderRadius: 20, padding: '32px 28px', maxWidth: 460, width: '100%', textAlign: 'center' }}>

        <div style={{ fontSize: 32, marginBottom: 14 }}>📬</div>

        <h2 style={{ fontSize: 20, fontWeight: 600, color: '#1C2430', marginBottom: 10 }}>
          {textos.modal.titulo}
        </h2>

        <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.6, marginBottom: 18 }}>
          {textos.modal.explicacion}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
          {casilla(novedades, setNovedades, textos.etiquetas.novedades)}
          {casilla(socios, setSocios, textos.etiquetas.socios)}
        </div>

        <p style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.5, marginBottom: 20 }}>
          {textos.modal.nota}
        </p>

        {error && (
          <p style={{ fontSize: 13, color: '#dc2626', marginBottom: 12 }}>{error}</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            onClick={guardar}
            disabled={guardando}
            style={{ width: '100%', background: '#F18006', border: 'none', borderRadius: 12, padding: '14px', fontSize: 14, fontWeight: 500, color: '#fff', cursor: guardando ? 'wait' : 'pointer', opacity: guardando ? 0.7 : 1 }}
          >
            {guardando ? 'Guardando…' : textos.modal.guardar}
          </button>
          <button
            onClick={onPosponer}
            disabled={guardando}
            style={{ width: '100%', background: 'none', border: 'none', padding: '8px', fontSize: 14, fontWeight: 500, color: '#6b7280', cursor: guardando ? 'wait' : 'pointer' }}
          >
            {textos.modal.posponer}
          </button>
        </div>

      </div>
    </div>
  )
}
