import { useState, useEffect } from 'react'
import { AVAILABLE_COUNTRIES } from '../data/broadcasters'
import { API_BASE } from '../config'

export default function WatchPanel({ sport, competitionKey, competitionName, isOpen }) {
  const [country, setCountry]                     = useState(null)
  const [loading, setLoading]                     = useState(false)
  const [changingCountry, setChangingCountry]     = useState(false)
  const [broadcasts, setBroadcasts]               = useState(null)
  const [fetched, setFetched]                     = useState(false)

  // Detectar país al abrir por primera vez
  useEffect(() => {
    if (!isOpen || country) return
    const saved = localStorage.getItem('fanschedule_country')
    if (saved) { setCountry(saved); return }
    fetch(`${API_BASE}/api/detect-country`)
      .then(res => res.json())
      .then(data => {
        const detected = data.ok && data.country ? data.country : 'Mexico'
        setCountry(detected)
        localStorage.setItem('fanschedule_country', detected)
      })
      .catch(() => {
        setCountry('Mexico')
        localStorage.setItem('fanschedule_country', 'Mexico')
      })
  }, [isOpen])

  // Cargar broadcasting cuando tenemos país
  useEffect(() => {
    if (!isOpen || !country || !competitionKey || fetched) return
    setLoading(true)
    setFetched(true)
    const name = encodeURIComponent(competitionName || competitionKey)
    fetch(`${API_BASE}/api/broadcasting/${competitionKey}/${encodeURIComponent(country)}?competitionName=${name}`)
      .then(res => res.json())
      .then(data => {
        if (data.ok) setBroadcasts(data.data)
      })
      .catch(() => setBroadcasts(null))
      .finally(() => setLoading(false))
  }, [isOpen, country, competitionKey])

  const handleChangeCountry = (newCountry) => {
    setCountry(newCountry)
    localStorage.setItem('fanschedule_country', newCountry)
    setChangingCountry(false)
    setBroadcasts(null)
    setFetched(false)
  }

  if (!isOpen) return null

  const hasAny = broadcasts && (
    broadcasts.freeTV?.length > 0 ||
    broadcasts.paidTV?.length > 0 ||
    broadcasts.streaming?.length > 0
  )

  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', padding: '16px 20px', background: '#1E3A5F' }}>

      {/* Encabezado */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: '#8899AA', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
          Dónde ver este partido
        </div>
        {!changingCountry && country && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#8899AA' }}>📍 {country}</span>
            <button
              onClick={() => setChangingCountry(true)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#10B1C7', padding: 0, fontWeight: 500 }}
            >
              Cambiar
            </button>
          </div>
        )}
      </div>

      {/* Selector de país */}
      {changingCountry && (
        <div style={{ marginBottom: 14 }}>
          <select
            defaultValue={country}
            onChange={e => handleChangeCountry(e.target.value)}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', fontSize: 13, color: '#FFFFFF', background: '#142238', outline: 'none', cursor: 'pointer' }}
          >
            {AVAILABLE_COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      )}

      {/* Cargando */}
      {loading && (
        <div style={{ fontSize: 13, color: '#8899AA', padding: '4px 0' }}>
          Buscando opciones para {competitionName} en {country}...
        </div>
      )}

      {/* Sin datos */}
      {!loading && fetched && !hasAny && country && (
        <div style={{ fontSize: 12, color: '#8899AA', lineHeight: 1.6 }}>
          No encontramos información de transmisión para {competitionName} en {country}.{' '}
          <button
            onClick={() => setChangingCountry(true)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#10B1C7', padding: 0 }}
          >
            ¿Cambiar país?
          </button>
        </div>
      )}

      {/* Las 3 secciones */}
      {!loading && hasAny && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {broadcasts.freeTV?.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 500, color: '#8899AA', textTransform: 'uppercase', letterSpacing: '0.6px' }}>TV abierta</span>
                <span style={{ fontSize: 10, background: 'rgba(6,214,160,0.1)', color: '#06D6A0', padding: '1px 7px', borderRadius: 10, fontWeight: 500 }}>Gratis</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {broadcasts.freeTV.map(ch => (
                  <span key={ch} style={{ background: '#142238', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: '5px 12px', fontSize: 12, color: '#FFFFFF', fontWeight: 500 }}>
                    {ch}
                  </span>
                ))}
              </div>
            </div>
          )}

          {broadcasts.paidTV?.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 500, color: '#8899AA', textTransform: 'uppercase', letterSpacing: '0.6px' }}>TV de paga</span>
                <span style={{ fontSize: 10, background: 'rgba(202,138,4,0.1)', color: '#a16207', padding: '1px 7px', borderRadius: 10, fontWeight: 500 }}>Requiere cable</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {broadcasts.paidTV.map(ch => (
                  <span key={ch} style={{ background: '#142238', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: '5px 12px', fontSize: 12, color: '#FFFFFF', fontWeight: 500 }}>
                    {ch}
                  </span>
                ))}
              </div>
            </div>
          )}

          {broadcasts.streaming?.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 500, color: '#8899AA', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Streaming</span>
                <span style={{ fontSize: 10, background: 'rgba(16,177,199,0.1)', color: '#10B1C7', padding: '1px 7px', borderRadius: 10, fontWeight: 500 }}>Contratable online</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {broadcasts.streaming.map(s => (
                  <a
                    key={s.name}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ background: 'rgba(16,177,199,0.06)', border: '1px solid rgba(16,177,199,0.25)', borderRadius: 20, padding: '5px 14px', fontSize: 12, color: '#10B1C7', fontWeight: 500, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                  >
                    ▶ {s.name} <span style={{ fontSize: 10, opacity: 0.6 }}>↗</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          <div style={{ fontSize: 10, color: '#8899AA', marginTop: 2 }}>
            La disponibilidad puede variar según tu proveedor.
          </div>
        </div>
      )}
    </div>
  )
}
