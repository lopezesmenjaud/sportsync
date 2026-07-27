import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import MatchCard from '../components/MatchCard'
import { API_BASE } from '../config'
import { getUserId } from '../auth'
import { SPORT_EMOJI } from '../sportEmoji'

// Selección del filtro persistida por SESIÓN de navegador (se limpia al cerrar), mismo patrón
// que el gate de calendario (App.jsx usa sessionStorage con clave fanschedule_*).
const FILTER_STORAGE_KEY = 'fanschedule_upcoming_filter'

function loadSelectedIds() {
  try {
    const arr = JSON.parse(sessionStorage.getItem(FILTER_STORAGE_KEY) || '[]')
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export default function UpcomingMatches() {
  const navigate = useNavigate()
  const [matches, setMatches] = useState([])
  const [favorites, setFavorites] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterOpen, setFilterOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState(loadSelectedIds)
  const filterRef = useRef(null)
  const userId = getUserId()

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    fetch(`${API_BASE}/matches/${userId}?timezone=${encodeURIComponent(tz)}`)
      .then(res => res.json())
      .then(data => {
        if (data.ok) {
          setMatches(data.matches)
          // Degradación limpia: si el backend es viejo (Vercel adelante de Render) no manda
          // favorites → queda []. Sin favorites no se renderiza el filtro (más abajo).
          setFavorites(Array.isArray(data.favorites) ? data.favorites : [])
        }
      })
      .catch(err => console.error('Error loading matches:', err))
      .finally(() => setLoading(false))
  }, [])

  // Persistir la selección en sessionStorage cada vez que cambia.
  useEffect(() => {
    try { sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(selectedIds)) } catch { /* noop */ }
  }, [selectedIds])

  // Cerrar el panel al tocar FUERA de él (en móvil es lo que la gente espera). Cerrar NO limpia
  // la selección: el filtro sigue aplicado, solo se oculta el panel. El listener se registra solo
  // mientras el panel está abierto y se limpia al cerrar/desmontar (sin listeners colgados).
  useEffect(() => {
    if (!filterOpen) return
    const onPointerDown = (e) => {
      if (filterRef.current && !filterRef.current.contains(e.target)) setFilterOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [filterOpen])

  // El filtro SOLO existe si el backend mandó favoritos (deploy nuevo). Si no vino, el botón no
  // se renderiza, la lista se ve como hoy, y se IGNORA cualquier selección vieja en sessionStorage
  // (activeIds vacío = mostrar todo). Además se descartan ids que ya no están entre los favoritos.
  const filterSupported = favorites.length > 0
  const activeIds = filterSupported
    ? selectedIds.filter(id => favorites.some(f => f.id === id))
    : []

  const toggleId = (id) =>
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  const clearFilter = () => setSelectedIds([])

  // Unión: el partido se muestra si CUALQUIERA de sus inclusionReasonIds está seleccionado.
  // Nada seleccionado = todos. Campo ausente (backend viejo) se trata como [] sin romper.
  const filteredMatches = activeIds.length === 0
    ? matches
    : matches.filter(m =>
        Array.isArray(m.inclusionReasonIds) && m.inclusionReasonIds.some(id => activeIds.includes(id))
      )

  const groupByDate = (list) => {
    const sorted = [...list].sort((a, b) =>
      new Date(a.currentStartUtc) - new Date(b.currentStartUtc)
    )
    const groups = []
    const seen = new Map()
    sorted.forEach(match => {
      const date = new Date(match.currentStartUtc)
      const key = date.toLocaleDateString('es-MX', {
        weekday: 'long', day: 'numeric', month: 'long',
        timeZone: 'America/Mexico_City'
      }).toUpperCase()
      if (!seen.has(key)) {
        seen.set(key, [])
        groups.push([key, seen.get(key)])
      }
      seen.get(key).push(match)
    })
    return groups
  }

  const grouped = groupByDate(filteredMatches)

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <Sidebar activePath="/upcoming" />
      <div style={{ flex: 1, background: '#faf9f7', padding: '32px 28px', overflowY: 'auto' }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 500, color: '#111827' }}>Próximos partidos</h1>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Los partidos de tus equipos favoritos</p>
        </div>

        {/* Filtro por favoritos — solo si el backend mandó la lista (degradación limpia) */}
        {!loading && filterSupported && (
          <div ref={filterRef} style={{ marginBottom: 24, maxWidth: 360, width: '100%' }}>
            <button
              onClick={() => setFilterOpen(o => !o)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                width: '100%', background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 12,
                padding: '11px 16px', fontSize: 13, fontWeight: 500,
                color: activeIds.length > 0 ? '#F18006' : '#111827', cursor: 'pointer'
              }}
            >
              <span>
                {activeIds.length > 0 ? `Filtrar (${activeIds.length})` : 'Filtrar por favoritos'}
              </span>
              <span style={{ color: '#9ca3af', fontSize: 11 }}>{filterOpen ? '▲' : '▼'}</span>
            </button>

            {filterOpen && (
              <div style={{ marginTop: 8, background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #f3f4f6' }}>
                  <span style={{ fontSize: 11, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Tus favoritos</span>
                  <button
                    onClick={clearFilter}
                    disabled={activeIds.length === 0}
                    style={{
                      background: 'none', border: 'none', padding: 0, fontSize: 12, fontWeight: 500,
                      color: activeIds.length > 0 ? '#F18006' : '#d1d5db',
                      cursor: activeIds.length > 0 ? 'pointer' : 'default'
                    }}
                  >
                    Limpiar
                  </button>
                </div>
                <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                  {favorites.map(fav => {
                    const checked = activeIds.includes(fav.id)
                    return (
                      <div
                        key={fav.id}
                        onClick={() => toggleId(fav.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px',
                          cursor: 'pointer', borderTop: '1px solid #f9fafb', userSelect: 'none'
                        }}
                      >
                        <span style={{ width: 30, height: 30, borderRadius: 8, background: '#FEF3E2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                          {SPORT_EMOJI[fav.sport] || '🏆'}
                        </span>
                        <span style={{ flex: 1, fontSize: 14, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {fav.label}
                        </span>
                        <span style={{
                          width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                          border: checked ? '1px solid #F18006' : '1px solid #d1d5db',
                          background: checked ? '#F18006' : '#ffffff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                          {checked && (
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M13.5 4.5L6.5 11.5L2.5 7.5" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          )}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: '#6b7280', fontSize: 13 }}>Cargando partidos...</div>
        ) : matches.length === 0 ? (
          <div style={{ background: '#ffffff', border: '1px dashed #d1d5db', borderRadius: 16, padding: '48px 28px', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>📅</div>
            <h3 style={{ fontSize: 16, fontWeight: 500, color: '#111827', marginBottom: 8 }}>No hay partidos próximos</h3>
            <p style={{ fontSize: 13, color: '#6b7280' }}>Agrega más equipos o ligas para ver sus partidos aquí.</p>
          </div>
        ) : filteredMatches.length === 0 ? (
          <div style={{ background: '#ffffff', border: '1px dashed #d1d5db', borderRadius: 16, padding: '48px 28px', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>🔍</div>
            <h3 style={{ fontSize: 16, fontWeight: 500, color: '#111827', marginBottom: 8 }}>Sin partidos con este filtro</h3>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>
              No hay próximos partidos de los favoritos que seleccionaste.
            </p>
            <button
              onClick={clearFilter}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#F18006', color: '#fff', border: 'none', borderRadius: 20, padding: '10px 24px', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
            >
              Limpiar filtro
            </button>
          </div>
        ) : (
          grouped.map(([date, dateMatches]) => (
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
