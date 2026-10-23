import { useEffect, useState } from 'react'
import { apiFetch } from '../api'

// Sección "Correos" del perfil: los dos permisos de correo, cada uno por separado.
//
// - Lee GET /api/consent: el estado de la persona y los TEXTOS aprobados (textosConsentimiento.json
//   en el backend). Los textos NO viven aquí: si la app tuviera su propia copia y algún día
//   difiriera, la versión guardada ya no diría lo que la persona leyó. Sin textos (backend viejo o
//   versión sin aprobar), la sección no se muestra.
// - Guarda con el POST parcial: mover un interruptor manda SOLO ese permiso, con su versión.
// - El interruptor cambia solo cuando el servidor confirma. Mientras guarda, ese renglón queda en
//   "Guardando…"; si falla, se queda donde estaba y el renglón lo dice. Nada se da por guardado
//   antes de tiempo (el modal viejo hacía lo contrario).
// - Tres estados por permiso: "Sí", "No" y "Sin elegir" (nunca contestó, en gris). Las fechas no
//   se muestran: son registro.

// permiso del POST -> clave de la etiqueta y nombre de su versión en el GET/POST
const PERMISOS = [
  { permiso: 'emailFanschedule', etiqueta: 'novedades', version: 'versionNovedades' },
  { permiso: 'emailPartners', etiqueta: 'socios', version: 'versionSocios' },
]

export default function SeccionCorreos({ sectionStyle, labelStyle }) {
  const [estado, setEstado] = useState(null)          // respuesta del GET, o null mientras carga
  const [guardando, setGuardando] = useState({})      // { emailFanschedule: true } mientras guarda
  const [errores, setErrores] = useState({})          // { emailPartners: 'No se guardó…' }

  useEffect(() => {
    apiFetch('/api/consent')
      .then(res => res.json())
      .then(data => { if (data && data.ok) setEstado(data) })
      .catch(() => {})
  }, [])

  // Sin respuesta o sin textos aprobados: no se pinta nada antes que pintar algo inventado.
  if (!estado || !estado.textos) return null
  const { textos } = estado

  // Guarda UN permiso con la versión indicada. El estado se toca solo si el servidor confirma.
  const guardar = async (permiso, valor, nombreVersion, version) => {
    if (guardando[permiso]) return
    setGuardando(g => ({ ...g, [permiso]: true }))
    setErrores(e => ({ ...e, [permiso]: null }))
    try {
      const res = await apiFetch('/api/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [permiso]: valor, [nombreVersion]: version }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data || !data.ok) throw new Error('no confirmado')
      setEstado(s => ({ ...s, respondio: true, [permiso]: valor, [nombreVersion]: version }))
    } catch {
      setErrores(e => ({ ...e, [permiso]: 'No se guardó. Inténtalo otra vez.' }))
    } finally {
      setGuardando(g => ({ ...g, [permiso]: false }))
    }
  }

  const reconfirmarSocios = estado.emailPartners === true && estado.versionSocios === null

  return (
    <div style={sectionStyle}>
      <div style={labelStyle}>{textos.perfil.titulo}</div>

      {!estado.respondio && (
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 14 }}>{textos.perfil.sinElegir}</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {PERMISOS.map(({ permiso, etiqueta, version }) => {
          const valor = estado[permiso]                  // true | false | null (sin elegir)
          const prendido = valor === true
          const ocupado = !!guardando[permiso]
          const palabra = ocupado ? 'Guardando…' : !estado.respondio ? 'Sin elegir' : prendido ? 'Sí' : 'No'
          const colorPalabra = ocupado || !estado.respondio ? '#9ca3af' : prendido ? '#16a34a' : '#1C2430'
          return (
            <div key={permiso} style={{ padding: '12px 14px', border: '1px solid #e8e8e8', borderRadius: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
                <div style={{ fontSize: 14, color: '#1C2430', lineHeight: 1.45 }}>{textos.etiquetas[etiqueta]}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: colorPalabra, minWidth: 64, textAlign: 'right' }}>{palabra}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={prendido}
                    aria-label={textos.etiquetas[etiqueta]}
                    disabled={ocupado}
                    onClick={() => guardar(permiso, !prendido, version, textos.version)}
                    style={{
                      width: 44, height: 24, borderRadius: 12, border: 'none', padding: 2, flexShrink: 0,
                      background: prendido ? '#F18006' : '#d1d5db',
                      cursor: ocupado ? 'wait' : 'pointer', opacity: ocupado ? 0.6 : 1,
                      display: 'flex', justifyContent: prendido ? 'flex-end' : 'flex-start',
                    }}
                  >
                    <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#ffffff', display: 'block' }} />
                  </button>
                </div>
              </div>

              {permiso === 'emailPartners' && reconfirmarSocios && (
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 10, lineHeight: 1.5 }}>
                  {textos.reconfirmacion.aviso}{' '}
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() => guardar('emailPartners', true, 'versionSocios', textos.reconfirmacion.version)}
                    style={{ background: 'none', border: 'none', padding: 0, fontSize: 12, fontWeight: 500, color: '#F18006', cursor: ocupado ? 'wait' : 'pointer', textDecoration: 'underline' }}
                  >
                    {textos.reconfirmacion.enlace}
                  </button>
                </div>
              )}

              {errores[permiso] && (
                <div style={{ fontSize: 12, color: '#dc2626', marginTop: 8 }}>{errores[permiso]}</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
