import { useState, useEffect } from 'react'
import Sidebar from '../components/Sidebar'
import MatchCard from '../components/MatchCard'
import { API_BASE } from '../config'

export default function NearbyMatches() {
  const [loading, setLoading]       = useState(true)
  const [geoStatus, setGeoStatus]   = useState('asking') // asking | granted | denied
  const [cityInput, setCityInput]   = useState('')
  const [searching, setSearching]   = useState(false)
  const [matches, setMatches]       = useState([])
  const [location, setLocation]     = useState(null)
  const [error, setError]           = useState(null)

  // Pedir geolocalización al cargar
  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoStatus('denied')
      setLoading(false)
      return
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoStatus('granted')
        fetchNearby({ lat: pos.coords.latitude, lon: pos.coords.longitude })
      },
      (err) => {
        setGeoStatus('denied')
        setLoading(false)
      },
      { timeout: 10000 }
    )
  }, [])

  const fetchNearby = async (params) => {
    setSearching(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/nearby`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      })
      const data = await res.json()
      if (data.ok) {
        setLocation(data.location)
        setMatches(data.matches)
      } else {
        setError(data.error || 'No se pudo encontrar la ubicación.')
      }
    } catch {
      setError('Error de conexión con el servidor.')
    } finally {
      setLoading(false)
      setSearching(false)
    }
  }

  const handleManualSearch = () => {
    if (!cityInput.trim()) return
    setLoading(true)
    fetchNearby({ cityName: cityInput.trim() })
  }

  const groupByDate = (list) => {
    const groups = {}
    list.forEach(m => {
      const d = new Date(m.currentStartUtc)
      const key = d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Mexico_City' })
      if (!groups[key]) groups[key] = []
      groups[key].push(m)
    })
    return groups
  }

  const grouped = groupByDate(matches)

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <Sidebar activePath="/nearby" />

      <div style={{ flex: 1, background: '#faf9f7', padding: '32px 28px', overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 22, fontWeight: 500, color: '#111827' }}>Cerca de mí</h1>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
            {location
              ? `Partidos cerca de ${location.city}, ${location.country}`
              : 'Descubre qué partidos hay en tu zona'}
          </p>
        </div>

        {/* Estado: cargando geolocalización */}
        {loading && !searching && geoStatus === 'asking' && (
          <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 16, padding: '48px 28px', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📡</div>
            <div style={{ fontSize: 14, color: '#111827', marginBottom: 4 }}>Obteniendo tu ubicación...</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Permite el acceso a tu ubicación en el navegador.</div>
          </div>
        )}

        {/* Estado: buscando partidos */}
        {searching && (
          <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 16, padding: '48px 28px', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
            <div style={{ fontSize: 14, color: '#111827' }}>Buscando partidos cerca de ti...</div>
          </div>
        )}

        {/* Geolocalización rechazada: búsqueda manual */}
        {geoStatus === 'denied' && !location && !searching && (
          <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 16, padding: '24px', marginBottom: 28 }}>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 14 }}>
              No pudimos obtener tu ubicación. Escribe tu ciudad para buscar partidos cercanos.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, color: '#6b7280' }}>📍</span>
                <input
                  value={cityInput}
                  onChange={e => setCityInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleManualSearch()}
                  placeholder="Ej: Madrid, Ciudad de México, Londres..."
                  style={{ border: 'none', outline: 'none', fontSize: 14, color: '#111827', flex: 1, background: 'transparent' }}
                />
              </div>
              <button
                onClick={handleManualSearch}
                style={{ background: '#F18006', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                Buscar
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#dc2626' }}>
            {error}
          </div>
        )}

        {/* Ubicación detectada + botón cambiar (siempre visible si hay location) */}
        {location && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 500, color: '#111827' }}>📍 {location.city}, {location.country}</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                {searching
                  ? 'Buscando partidos...'
                  : `${matches.length} ${matches.length === 1 ? 'partido' : 'partidos'} en los próximos 30 días`}
              </div>
            </div>
            <button
              onClick={() => { setLocation(null); setMatches([]); setGeoStatus('denied'); setError(null) }}
              style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 20, padding: '6px 16px', fontSize: 12, color: '#6b7280', cursor: 'pointer' }}
            >
              Cambiar ubicación
            </button>
          </div>
        )}

        {/* Resultados */}
        {location && !searching && (
          <>
            {matches.length === 0 ? (
              <div style={{ background: '#ffffff', border: '1px dashed #d1d5db', borderRadius: 16, padding: '48px 28px', textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 16 }}>🏟️</div>
                <h3 style={{ fontSize: 16, fontWeight: 500, color: '#111827', marginBottom: 8 }}>Sin partidos cercanos</h3>
                <p style={{ fontSize: 13, color: '#6b7280' }}>
                  No encontramos partidos en {location.country} en los próximos 30 días.
                </p>
                <p style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
                  Suscríbete a más ligas desde Mis favoritos para ver más partidos.
                </p>
              </div>
            ) : (
              Object.entries(grouped).map(([date, dateMatches]) => (
                <div key={date} style={{ marginBottom: 24 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.8px', whiteSpace: 'nowrap' }}>{date}</span>
                    <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
                  </div>
                  {dateMatches.map(m => <MatchCard key={m.providerMatchId} match={m} />)}
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  )
}
