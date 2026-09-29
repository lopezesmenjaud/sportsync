import { useState, useEffect } from 'react'
import { apiFetch } from '../api'

// Sección "Selecciones nacionales" del picker de fútbol.
//
// Dos cosas distintas desde cada casilla (confederación + rama), y la pantalla lo dice escrito:
//   - SEGUIR LA CONFEDERACIÓN: competitionKey "concacaf-varonil"... Solo partidos OFICIALES de sus
//     competencias. Los amistosos NO llegan por aquí.
//   - SEGUIR UNA SELECCIÓN: la suscripción de equipo de siempre. teamName = el `name` que manda
//     el endpoint, TAL CUAL ("Mexico", "Mexico Women"), competitionKey null, sport "futbol". Le
//     llegan TODOS sus partidos, amistosos incluidos.
//
// Dos reglas:
//   1. Lo que nunca va a traer nada no se muestra: la casilla con sinCompetencias (OFC femenil).
//      Sus selecciones sí se pueden seguir desde la lista de Oceanía.
//   2. Lo que está vacío HOY se dice: si la confederación no tiene partidos en los próximos 30
//      días (la ventana del sync), se avisa. La suscripción se queda y los partidos entran solos.
//
// Degradación limpia: si el backend todavía no manda partidosProximos / proximos30d, no se
// afirma nada sobre si hay partidos o no.

// Nombres en español y banderas, SOLO para mostrar. La llave es el nombre EXACTO del proveedor;
// lo que se guarda en la suscripción es siempre el `name` del endpoint, nunca este texto. Salen
// de la lista de la sección vieja (NATIONAL_TEAMS en LeaguePicker.jsx, apagada). Si una llave
// estuviera mal escrita, ese país simplemente se ve en inglés: no afecta lo que se guarda.
const NOMBRES_ES = {
  'Mexico': ['México', '🇲🇽'], 'USA': ['Estados Unidos', '🇺🇸'], 'Canada': ['Canadá', '🇨🇦'],
  'Costa Rica': ['Costa Rica', '🇨🇷'], 'Honduras': ['Honduras', '🇭🇳'], 'Guatemala': ['Guatemala', '🇬🇹'],
  'El Salvador': ['El Salvador', '🇸🇻'], 'Panama': ['Panamá', '🇵🇦'], 'Jamaica': ['Jamaica', '🇯🇲'],
  'Trinidad and Tobago': ['Trinidad y Tobago', '🇹🇹'], 'Cuba': ['Cuba', '🇨🇺'], 'Dominican Republic': ['Rep. Dominicana', '🇩🇴'],
  'Argentina': ['Argentina', '🇦🇷'], 'Brazil': ['Brasil', '🇧🇷'], 'Colombia': ['Colombia', '🇨🇴'],
  'Chile': ['Chile', '🇨🇱'], 'Peru': ['Perú', '🇵🇪'], 'Uruguay': ['Uruguay', '🇺🇾'],
  'Ecuador': ['Ecuador', '🇪🇨'], 'Paraguay': ['Paraguay', '🇵🇾'], 'Bolivia': ['Bolivia', '🇧🇴'],
  'Venezuela': ['Venezuela', '🇻🇪'], 'Spain': ['España', '🇪🇸'], 'France': ['Francia', '🇫🇷'],
  'Germany': ['Alemania', '🇩🇪'], 'Italy': ['Italia', '🇮🇹'], 'Portugal': ['Portugal', '🇵🇹'],
  'England': ['Inglaterra', '🏴󠁧󠁢󠁥󠁮󠁧󠁿'], 'Netherlands': ['Países Bajos', '🇳🇱'], 'Belgium': ['Bélgica', '🇧🇪'],
  'Croatia': ['Croacia', '🇭🇷'], 'Japan': ['Japón', '🇯🇵'], 'South Korea': ['Corea del Sur', '🇰🇷'],
  'Saudi Arabia': ['Arabia Saudita', '🇸🇦'], 'Australia': ['Australia', '🇦🇺'], 'Morocco': ['Marruecos', '🇲🇦'],
  'Nigeria': ['Nigeria', '🇳🇬'], 'Ghana': ['Ghana', '🇬🇭'], 'Egypt': ['Egipto', '🇪🇬'],
}

// "Mexico Women" se muestra como "México": la casilla ya dice que es la rama femenil.
function paraMostrar(nombreProveedor) {
  const base = nombreProveedor.endsWith(' Women') ? nombreProveedor.slice(0, -' Women'.length) : nombreProveedor
  const es = NOMBRES_ES[base]
  return es ? { nombre: es[0], bandera: es[1] } : { nombre: nombreProveedor, bandera: null }
}

// Para buscar sin que importen mayúsculas ni acentos: "mexico" encuentra "México".
function sinAcentos(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const MSG_SIN_PARTIDOS = 'Por ahora no hay partidos en los próximos 30 días. Cuando se acerquen, te llegan solos a tu calendario.'

// Dos formas de NO saber cuántos partidos hay, con mensajes distintos porque no son lo mismo:
//   "tope":  la búsqueda tardó más de lo esperado y sigue corriendo; todavía puede traer partidos.
//   "falla": no se pudo consultar al proveedor. No es que no haya partidos: no pudimos preguntar.
//            La suscripción queda guardada y el sync lo vuelve a intentar solo.
const MSG_SIN_DATOS = {
  tope:  'Estamos buscando sus partidos. Si hay en los próximos 30 días, van a llegar a tu calendario en unos minutos.',
  falla: 'No pudimos consultar sus partidos en este momento. Ya quedaste siguiéndola: lo volvemos a intentar solo en las próximas horas y, si hay partidos, llegan a tu calendario.',
}

function mensajeDePartidos(n) {
  if (n === 0) return { texto: MSG_SIN_PARTIDOS, tono: 'aviso' }
  if (typeof n === 'number' && n > 0) return { texto: `${n} partido${n === 1 ? '' : 's'} en los próximos 30 días. Van a tu calendario.`, tono: 'ok' }
  return null
}

export default function SeleccionesPicker({ userId, onSuscrito }) {
  const [casillas, setCasillas]           = useState(null)   // null = cargando
  const [errorCarga, setErrorCarga]       = useState(false)
  const [subPorClave, setSubPorClave]     = useState({})     // "concacaf-varonil" -> id de suscripción
  const [subPorEquipo, setSubPorEquipo]   = useState({})     // "Mexico" -> id de suscripción
  const [resultado, setResultado]         = useState({})     // clave -> { n: partidosProximos, sinDatos } del POST
  const [cambiando, setCambiando]         = useState(null)   // clave o "equipo:<name>" en curso
  const [error, setError]                 = useState(null)
  const [abierta, setAbierta]             = useState(null)   // clave cuya lista de selecciones está abierta
  const [listas, setListas]               = useState({})     // clave -> { equipos, completo } | { error: true }
  const [busqueda, setBusqueda]           = useState('')

  useEffect(() => {
    let vivo = true
    Promise.all([
      apiFetch('/api/selecciones/confederaciones').then(r => r.json()),
      apiFetch(`/subscriptions/${userId}`).then(r => r.json()),
    ])
      .then(([conf, subs]) => {
        if (!vivo) return
        if (!conf.ok || !Array.isArray(conf.suscripciones) || !subs.ok) throw new Error('respuesta incompleta')
        const claves = new Set(conf.suscripciones.map(s => s.clave))
        const porClave = {}, porEquipo = {}
        for (const s of subs.subscriptions || []) {
          if (s.sport !== 'futbol') continue
          if (!s.teamName && claves.has(s.competitionKey)) porClave[s.competitionKey] = s.id
          if (s.teamName && !s.competitionKey) porEquipo[s.teamName] = s.id
        }
        // Regla 1: la casilla que nunca trae nada no se muestra.
        setCasillas(conf.suscripciones.filter(s => !s.sinCompetencias))
        setSubPorClave(porClave)
        setSubPorEquipo(porEquipo)
      })
      .catch(err => {
        console.error('Error cargando selecciones:', err)
        if (vivo) { setCasillas([]); setErrorCarga(true) }
      })
    return () => { vivo = false }
  }, [userId])

  const etiqueta = (c) => `${c.nombre} ${c.rama}`

  // Seguir / dejar de seguir la CONFEDERACIÓN. Al seguir, el backend espera la bajada de sus
  // partidos (hasta 25 s) y contesta cuántos hay en los próximos 30 días. El botón queda
  // deshabilitado mientras tanto: el doble clic con varios segundos de espera es lo normal.
  const toggleConfederacion = async (c) => {
    if (cambiando) return
    setCambiando(c.clave)
    setError(null)
    const subId = subPorClave[c.clave]
    try {
      if (subId) {
        const res  = await apiFetch(`/subscriptions/${subId}`, { method: 'DELETE' })
        const data = await res.json()
        if (!data.ok) { setError(`No se pudo dejar de seguir ${etiqueta(c)}. Intenta de nuevo.`); return }
        setSubPorClave(prev => { const n = { ...prev }; delete n[c.clave]; return n })
        setResultado(prev => { const n = { ...prev }; delete n[c.clave]; return n })
      } else {
        const res  = await apiFetch('/subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, sport: 'futbol', competitionKey: c.clave, competitionName: etiqueta(c), teamName: null })
        })
        const data = await res.json()
        if (!data.ok || !data.subscription) { setError(`No se pudo seguir ${etiqueta(c)}. Intenta de nuevo.`); return }
        setSubPorClave(prev => ({ ...prev, [c.clave]: data.subscription.id }))
        // undefined = backend viejo (no manda el campo): no se afirma nada.
        if (data.partidosProximos !== undefined) setResultado(prev => ({ ...prev, [c.clave]: { n: data.partidosProximos, sinDatos: data.sinDatos || null } }))
        if (onSuscrito) await onSuscrito()
      }
    } catch (e) {
      console.error(e)
      setError(`No se pudo cambiar ${etiqueta(c)}. Revisa tu conexión.`)
    } finally {
      setCambiando(null)
    }
  }

  // Seguir / dejar de seguir una SELECCIÓN. Se guarda equipo.name tal cual viene del endpoint.
  const toggleEquipo = async (equipo, c) => {
    if (cambiando) return
    const marca = `equipo:${equipo.name}`
    setCambiando(marca)
    setError(null)
    const subId = subPorEquipo[equipo.name]
    const mostrar = paraMostrar(equipo.name).nombre
    try {
      if (subId) {
        const res  = await apiFetch(`/subscriptions/${subId}`, { method: 'DELETE' })
        const data = await res.json()
        if (!data.ok) { setError(`No se pudo dejar de seguir a ${mostrar}. Intenta de nuevo.`); return }
        setSubPorEquipo(prev => { const n = { ...prev }; delete n[equipo.name]; return n })
      } else {
        const res  = await apiFetch('/subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, sport: 'futbol', competitionKey: null, competitionName: etiqueta(c), teamName: equipo.name })
        })
        const data = await res.json()
        if (!data.ok || !data.subscription) { setError(`No se pudo seguir a ${mostrar}. Intenta de nuevo.`); return }
        setSubPorEquipo(prev => ({ ...prev, [equipo.name]: data.subscription.id }))
        if (onSuscrito) await onSuscrito()
      }
    } catch (e) {
      console.error(e)
      setError(`No se pudo cambiar a ${mostrar}. Revisa tu conexión.`)
    } finally {
      setCambiando(null)
    }
  }

  // La primera vez que alguien abre una lista, el backend arma las listas con ~43 llamadas al
  // proveedor y tarda unos segundos. Después queda en caché siete días.
  const abrirLista = async (c) => {
    if (abierta === c.clave) { setAbierta(null); return }
    setAbierta(c.clave)
    setBusqueda('')
    // Ya cargada y completa: no se vuelve a pedir. Incompleta o con error: se reintenta al reabrir.
    if (listas[c.clave] && !listas[c.clave].error && listas[c.clave].completo) return
    setListas(prev => ({ ...prev, [c.clave]: null }))
    try {
      const res  = await apiFetch(`/api/selecciones/${c.clave}/equipos`)
      const data = await res.json()
      if (!data.ok || !Array.isArray(data.equipos)) throw new Error('respuesta incompleta')
      setListas(prev => ({ ...prev, [c.clave]: { equipos: data.equipos, completo: data.completo !== false } }))
    } catch (e) {
      console.error(e)
      setListas(prev => ({ ...prev, [c.clave]: { error: true } }))
    }
  }

  const estadoDe = (c) => {
    if (!subPorClave[c.clave]) return null
    if (c.clave in resultado) {
      const { n, sinDatos } = resultado[c.clave]
      // null = desconocido. Sin motivo (backend a medio desplegar) se usa el de "tope", que no
      // afirma nada: solo dice que se está buscando.
      if (n === null) return { texto: MSG_SIN_DATOS[sinDatos] || MSG_SIN_DATOS.tope, tono: sinDatos === 'falla' ? 'aviso' : 'neutro' }
      return mensajeDePartidos(n)
    }
    return mensajeDePartidos(c.proximos30d)
  }

  const colorTono = { ok: '#06D6A0', aviso: '#b36b00', neutro: '#666666' }
  const boton = (activo, ocupado) => (activo
    ? { background: 'transparent', color: '#06D6A0', border: '1px solid #06D6A0', borderRadius: 20, padding: '6px 14px', fontSize: 12, fontWeight: 500, cursor: ocupado ? 'wait' : 'pointer', opacity: ocupado ? 0.7 : 1, flexShrink: 0 }
    : { background: '#F18006', color: '#fff', border: '1px solid #F18006', borderRadius: 20, padding: '6px 14px', fontSize: 12, fontWeight: 500, cursor: ocupado ? 'wait' : 'pointer', opacity: ocupado ? 0.7 : 1, flexShrink: 0 })

  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Selecciones nacionales</span>
      </div>

      <div style={{ background: '#ffffff', border: '0.5px solid #e8e8e8', borderRadius: 12, padding: '12px 16px', marginBottom: 12, fontSize: 13, color: '#1C2430', lineHeight: 1.6 }}>
        <div><strong>Seguir la confederación:</strong> solo sus partidos oficiales (Copa Oro, eliminatorias, Nations League…). Los amistosos no llegan por aquí.</div>
        <div><strong>Seguir una selección:</strong> todos sus partidos, amistosos incluidos.</div>
      </div>

      {error && <div role="alert" style={{ fontSize: 13, color: '#c0392b', marginBottom: 10 }}>{error}</div>}

      {casillas === null ? (
        <div style={{ fontSize: 13, color: '#666666', padding: '12px 0' }}>Cargando selecciones...</div>
      ) : errorCarga ? (
        <div style={{ fontSize: 13, color: '#666666', padding: '12px 0' }}>No pudimos cargar las selecciones. Recarga la página para intentar de nuevo.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {casillas.map(c => {
            const siguiendo = Boolean(subPorClave[c.clave])
            const ocupado   = cambiando === c.clave
            const estado    = estadoDe(c)
            const lista     = listas[c.clave]
            const estaAbierta = abierta === c.clave
            const visibles  = lista && lista.equipos
              ? lista.equipos.filter(e => {
                  if (!busqueda) return true
                  const q = sinAcentos(busqueda)
                  return sinAcentos(e.name).includes(q) || sinAcentos(paraMostrar(e.name).nombre).includes(q)
                })
              : []
            return (
              <div key={c.clave} style={{ background: siguiendo ? 'rgba(16,177,199,0.04)' : '#ffffff', border: `0.5px solid ${siguiendo ? '#10B1C7' : '#e8e8e8'}`, borderRadius: 12, padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(255,92,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0, border: '0.5px solid #ffe8b0' }}>🌎</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: '#1C2430' }}>{c.nombre} <span style={{ fontWeight: 400, color: '#666666' }}>{c.rama}</span></div>
                      <div style={{ fontSize: 11, color: '#666666', marginTop: 2 }}>{c.competencias.map(x => x.base).join(' · ')}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button onClick={() => abrirLista(c)} aria-expanded={estaAbierta} style={{ background: 'transparent', color: '#10B1C7', border: '1px solid #10B1C7', borderRadius: 20, padding: '6px 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                      {estaAbierta ? 'Ocultar selecciones' : 'Ver selecciones'}
                    </button>
                    <button onClick={() => toggleConfederacion(c)} disabled={Boolean(cambiando)} aria-pressed={siguiendo} style={boton(siguiendo, ocupado)}>
                      {ocupado ? (siguiendo ? '...' : 'Buscando partidos…') : siguiendo ? '✓ Siguiendo oficiales' : '+ Seguir partidos oficiales'}
                    </button>
                  </div>
                </div>

                {estado && <div style={{ fontSize: 12, color: colorTono[estado.tono], marginTop: 10 }}>{estado.texto}</div>}

                {estaAbierta && (
                  <div style={{ marginTop: 12, borderTop: '0.5px solid #e8e8e8', paddingTop: 12 }}>
                    {lista === null || lista === undefined ? (
                      <div style={{ fontSize: 13, color: '#666666' }}>Cargando selecciones… la primera vez tarda unos segundos.</div>
                    ) : lista.error ? (
                      <div style={{ fontSize: 13, color: '#666666' }}>No pudimos cargar las selecciones. Cierra y vuelve a abrir para intentar de nuevo.</div>
                    ) : (
                      <>
                        {!lista.completo && (
                          <div role="status" style={{ fontSize: 12, color: '#b36b00', marginBottom: 10 }}>
                            Esta lista está incompleta: el proveedor no contestó todas las consultas. Puede faltar alguna selección; intenta más tarde.
                          </div>
                        )}
                        <div style={{ background: '#f0f0f0', border: '0.5px solid #e8e8e8', borderRadius: 10, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                          <span style={{ fontSize: 14, color: '#666666' }}>🔍</span>
                          <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar selección: México, Brasil..." aria-label="Buscar selección" style={{ border: 'none', outline: 'none', fontSize: 14, color: '#1C2430', flex: 1, background: 'transparent' }} />
                        </div>
                        <div style={{ fontSize: 11, color: '#666666', marginBottom: 8 }}>
                          Al seguir una selección te llegan todos sus partidos, amistosos incluidos.
                        </div>
                        {visibles.length === 0 ? (
                          <div style={{ fontSize: 13, color: '#666666', padding: '8px 0' }}>{lista.equipos.length === 0 ? 'No hay selecciones en esta lista.' : 'Ninguna selección coincide con la búsqueda.'}</div>
                        ) : (
                          <div style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {visibles.map(e => {
                              const m = paraMostrar(e.name)
                              const sigueEquipo = Boolean(subPorEquipo[e.name])
                              const ocupadoEquipo = cambiando === `equipo:${e.name}`
                              return (
                                <div key={e.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 10px', borderRadius: 8, background: sigueEquipo ? 'rgba(16,177,199,0.06)' : 'transparent' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                                    {m.bandera
                                      ? <span style={{ fontSize: 20, width: 24, textAlign: 'center' }}>{m.bandera}</span>
                                      : e.badge ? <img src={e.badge} alt="" style={{ width: 24, height: 24, objectFit: 'contain' }} /> : <span style={{ width: 24 }} />}
                                    <span style={{ fontSize: 14, color: '#1C2430' }}>{m.nombre}</span>
                                  </div>
                                  <button onClick={() => toggleEquipo(e, c)} disabled={Boolean(cambiando)} aria-pressed={sigueEquipo} style={boton(sigueEquipo, ocupadoEquipo)}>
                                    {ocupadoEquipo ? '...' : sigueEquipo ? '✓ Siguiendo' : '+ Seguir'}
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
