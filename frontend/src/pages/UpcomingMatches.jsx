import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import MatchCard from '../components/MatchCard'
import { API_BASE } from '../config'
import { getUserId } from '../auth'

export default function UpcomingMatches() {
  const navigate = useNavigate()
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const userId = getUserId()

  useEffect(() => {
    fetch(`${API_BASE}/matches/${userId}`)
      .then(res => res.json())
      .then(data => { if (data.ok) setMatches(data.matches) })
      .catch(err => console.error('Error loading matches:', err))
      .finally(() => setLoading(false))
  }, [])

  const groupByDate = (matches) => {
    const groups = {}
    matches.forEach(match => {
      const date = new Date(match.currentStartUtc)
      const key = date.toLocaleDateString('es-MX', {
        weekday: 'long', day: 'numeric', month: 'long',
        timeZone: 'America/Mexico_City'
      }).toUpperCase()
      if (!groups[key]) groups[key] = []
      groups[key].push(match)
    })
    return groups
  }

  const grouped = groupByDate(matches)

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <Sidebar activePath="/upcoming" />
      <div style={{ flex: 1, background: '#faf9f7', padding: '32px 28px', overflowY: 'auto' }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 22, fontWeight: 500, color: '#111827' }}>Próximos partidos</h1>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Los partidos de tus equipos favoritos</p>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: '#6b7280', fontSize: 13 }}>Cargando partidos...</div>
        ) : matches.length === 0 ? (
          <div style={{ background: '#ffffff', border: '1px dashed #d1d5db', borderRadius: 16, padding: '48px 28px', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>📅</div>
            <h3 style={{ fontSize: 16, fontWeight: 500, color: '#111827', marginBottom: 8 }}>No hay partidos próximos</h3>
            <p style={{ fontSize: 13, color: '#6b7280' }}>Agrega más equipos o ligas para ver sus partidos aquí.</p>
          </div>
        ) : (
          Object.entries(grouped).map(([date, dateMatches]) => (
            <div key={date} style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 12, borderBottom: '1px solid #e5e7eb', paddingBottom: 8 }}>
                {date}
              </div>
              {dateMatches.map(match => (
                <MatchCard key={match.providerMatchId} match={match} showDate={false} />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
