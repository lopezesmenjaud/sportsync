import { useState } from 'react'
import Sidebar from '../components/Sidebar'
import MatchCard from '../components/MatchCard'
import { API_BASE } from '../config'
import { geocodeCity } from '../utils/geocoding'

export default function TravelPlanner() {
  const [cityInput, setCityInput] = useState('')
  const [dateFrom, setDateFrom]   = useState('')
  const [dateTo, setDateTo]       = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [matches, setMatches]     = useState([])
  const [location, setLocation]   = useState(null)
  const [searched, setSearched]   = useState(false)

  const handleSearch = async () => {
    if (!cityInput.trim()) { setError('Escribe una ciudad destino.'); return }
    if (!dateFrom || !dateTo)  { setError('Selecciona las fechas de tu viaje.'); return }
    if (new Date(dateTo) < new Date(dateFrom)) { setError('La fecha de regreso debe ser después de la llegada.'); return }

    setLoading(true)
    setError(null)
    setSearched(true)

    try {
      const geo = await geocodeCity(cityInput.trim())
      const res = await fetch(`${API_BASE}/api/nearby`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: geo.lat, lon: geo.lon, city: geo.city, country: geo.country })
      })
      const data = await res.json()
      if (data.ok) {
        setLocation(data.location)
        // Filtrar por rango de fechas del viaje en frontend
        const from = new Date(dateFrom).getTime()
        const to   = new Date(dateTo + 'T23:59:59').getTime()
        const filtered = (data.matches || []).filter(m => {
          const t = new Date(m.currentStartUtc).getTime()
          return t >= from && t <= to
        })
        setMatches(filtered)
      } else {
        setError(data.error || 'No se pudo buscar la ciudad.')
      }
    } catch (e) {
      setError(e.message || 'Error de conexión con el servidor.')
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setSearched(false)
    setMatches([])
    setLocation(null)
    setError(null)
  }

  const groupByDate = (matches) => {
    const groups = {}
    matches.forEach(match => {
      const date = new Date(match.currentStartUtc)
      const key  = date.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Mexico_City' }).toUpperCase()
      if (!groups[key]) groups[key] = []
      groups[key].push(match)
    })
    return groups
  }

  const grouped = groupByDate(matches)

  // Fecha mínima = hoy
  const todayStr = new Date().toISOString().slice(0, 10)

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <Sidebar activePath="/travel" />
      <div style={{ flex: 1, background: '#faf9f7', padding: '32px 28px', overflowY: 'auto' }}>

        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 22, fontWeight: 500, color: '#111827' }}>Planear viaje</h1>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>¿Qué partidos hay mientras estás de viaje?</p>
        </div>

        {/* Formulario de búsqueda — siempre visible */}
        <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 16, padding: '24px', marginBottom: 28 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 12, alignItems: 'end' }}>

            {/* Ciudad */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 500, color: '#6b7280', marginBottom: 6 }}>Ciudad destino</div>
              <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, color: '#6b7280' }}>🌍</span>
                <input
                  value={cityInput}
                  onChange={e => setCityInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder="Ej: Madrid, Barcelona..."
                  style={{ border: 'none', outline: 'none', fontSize: 14, color: '#111827', flex: 1, background: 'transparent' }}
                />
              </div>
            </div>

            {/* Fecha llegada */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 500, color: '#6b7280', marginBottom: 6 }}>Llegada</div>
              <input
                type="date"
                value={dateFrom}
                min={todayStr}
                onChange={e => setDateFrom(e.target.value)}
                style={{ width: '100%', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 14px', fontSize: 14, color: '#111827', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            {/* Fecha regreso */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 500, color: '#6b7280', marginBottom: 6 }}>Regreso</div>
              <input
                type="date"
                value={dateTo}
                min={dateFrom || todayStr}
                onChange={e => setDateTo(e.target.value)}
                style={{ width: '100%', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 14px', fontSize: 14, color: '#111827', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            {/* Botón buscar */}
            <button
              onClick={handleSearch}
              disabled={loading}
              style={{ background: '#F18006', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 20px', fontSize: 14, fontWeight: 500, cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1, whiteSpace: 'nowrap' }}
            >
              {loading ? 'Buscando...' : 'Buscar partidos'}
            </button>
          </div>

          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 16px', marginTop: 14, fontSize: 13, color: '#dc2626' }}>
              {error}
            </div>
          )}
        </div>

        {/* Resultados */}
        {!searched ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: '#6b7280' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✈️</div>
            <div style={{ fontSize: 14, color: '#6b7280' }}>Ingresa tu destino y fechas para ver qué partidos hay durante tu estancia.</div>
          </div>
        ) : loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: '#6b7280', fontSize: 13 }}>Buscando partidos en {cityInput}...</div>
        ) : (
          <>
            {location && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 500, color: '#111827' }}>🌍 {location.city}, {location.country}</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{matches.length} partidos durante tu viaje</div>
                </div>
                <button onClick={handleReset} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 20, padding: '6px 16px', fontSize: 12, color: '#6b7280', cursor: 'pointer' }}>
                  Nueva búsqueda
                </button>
              </div>
            )}

            {matches.length === 0 ? (
              <div style={{ background: '#ffffff', border: '1px dashed #d1d5db', borderRadius: 16, padding: '48px 28px', textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 16 }}>🏟</div>
                <h3 style={{ fontSize: 16, fontWeight: 500, color: '#111827', marginBottom: 8 }}>Sin partidos en esas fechas</h3>
                <p style={{ fontSize: 13, color: '#6b7280' }}>No encontramos partidos en {location?.country} del {dateFrom} al {dateTo}.</p>
                <p style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>Intenta con otras fechas o sincroniza más ligas desde Mis favoritos.</p>
              </div>
            ) : (
              Object.entries(grouped).map(([date, dateMatches]) => (
                <div key={date} style={{ marginBottom: 28 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 12 }}>{date}</div>
                  {dateMatches.map(match => <MatchCard key={match.providerMatchId} match={match} />)}
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  )
}
