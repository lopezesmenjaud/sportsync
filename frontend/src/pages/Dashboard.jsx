import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import { API_BASE } from '../config'
import { getUserId } from '../auth'

const SPORTS = [
  { emoji: '⚽', name: 'Fútbol',            sub: 'La Liga, Premier, Champions...', key: 'futbol'           },
  { emoji: '🏀', name: 'Basketball',        sub: 'NBA, Euroliga, WNBA...',         key: 'basketball'       },
  { emoji: '🏈', name: 'Fútbol americano',  sub: 'NFL, NCAA, CFL...',              key: 'futbol_americano' },
  { emoji: '🏎️', name: 'Automovilismo',     sub: 'F1, NASCAR, IndyCar...',        key: 'automovilismo'    },
  { emoji: '⚾', name: 'Baseball',           sub: 'MLB, Liga Mexicana...',          key: 'baseball'         },
  { emoji: '🎾', name: 'Tenis',             sub: 'ATP, WTA, Grand Slams...',       key: 'tenis'            },
  { emoji: '🥊', name: 'Combate',           sub: 'UFC, Boxeo, WWE...',             key: 'combate'          },
  { emoji: '🏉', name: 'Rugby',             sub: 'Six Nations, World Cup...',      key: 'rugby'            },
  { emoji: '🏒', name: 'Hockey',            sub: 'NHL, KHL...',                    key: 'hockey'           },
  { emoji: '🏐', name: 'Voleibol',          sub: 'FIVB, Liga italiana...',         key: 'voleibol'         },
  { emoji: '⛳', name: 'Golf',              sub: 'PGA, LPGA, LIV Golf...',        key: 'golf'             },
]

const SPORT_EMOJI = {
  futbol: '⚽', basketball: '🏀', futbol_americano: '🏈',
  automovilismo: '🏎️', baseball: '⚾', tenis: '🎾',
  combate: '🥊', rugby: '🏉', hockey: '🏒', voleibol: '🏐',
  golf: '⛳'
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [subscriptions, setSubscriptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState(null)
  const [googleStatus, setGoogleStatus] = useState({ connected: false, email: null, loading: true })
  const userId = getUserId()

  useEffect(() => {
    fetch(`${API_BASE}/subscriptions/${userId}`)
      .then(res => res.json())
      .then(data => { if (data.ok) setSubscriptions(data.subscriptions) })
      .catch(err => console.error('Error loading subscriptions:', err))
      .finally(() => setLoading(false))

    fetch(`${API_BASE}/auth/google/status/${userId}`)
      .then(res => res.json())
      .then(data => { if (data.ok) setGoogleStatus({ connected: data.connected, email: data.email, loading: false }) })
      .catch(() => setGoogleStatus(prev => ({ ...prev, loading: false })))
  }, [])

  const handleDelete = async (sub) => {
    const label = sub.teamName || `Liga ${sub.competitionKey}`
    if (!window.confirm(`¿Eliminar "${label}" de tus favoritos?`)) return
    setDeletingId(sub.id)
    try {
      const res = await fetch(`${API_BASE}/subscriptions/${sub.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.ok) setSubscriptions(prev => prev.filter(s => s.id !== sub.id))
    } catch (err) {
      console.error('Error deleting subscription:', err)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>

      <Sidebar activePath="/dashboard" />

      {/* Main */}
      <div style={{ flex: 1, background: '#faf9f7', padding: '32px 28px', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 500, color: '#111827' }}>Mis favoritos</h1>
            <p style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Tus ligas y equipos favoritos</p>
          </div>
          <button
            onClick={() => {}}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F18006', color: '#fff', border: 'none', borderRadius: 20, padding: '10px 20px', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
            + Agregar
          </button>
        </div>

        {/* Banner Google Calendar */}
        {!googleStatus.loading && !googleStatus.connected && (
          <div style={{
            background: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: 14,
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 24,
            gap: 16,
            flexWrap: 'wrap',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: '#FEF3E2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                📅
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>Conecta tu Google Calendar</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                  Tus partidos se sincronizarán automáticamente a tu calendario.
                </div>
              </div>
            </div>
            <button
              onClick={() => { window.location.href = `${API_BASE}/auth/google` }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: '#263140', color: '#fff', border: 'none', borderRadius: 20,
                padding: '9px 18px', fontSize: 12, fontWeight: 500, cursor: 'pointer', flexShrink: 0,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#fff"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#fff" fillOpacity=".7"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#fff" fillOpacity=".5"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#fff" fillOpacity=".8"/></svg>
              Conectar con Google
            </button>
          </div>
        )}

        {/* Suscripciones activas o empty state */}
        {loading ? (
          <div style={{ background: '#ffffff', borderRadius: 16, padding: '48px 28px', textAlign: 'center', marginBottom: 28 }}>
            <p style={{ fontSize: 13, color: '#6b7280' }}>Cargando tus favoritos...</p>
          </div>
        ) : subscriptions.length > 0 ? (
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 14 }}>
              Siguiendo
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {subscriptions.map((sub) => (
                <div key={sub.id} style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: '#FEF3E2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
                      {SPORT_EMOJI[sub.sport] || '🏆'}
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>
                        {sub.teamName || sub.competitionName || 'Liga completa'}
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                        {sub.sport} {sub.competitionKey ? `· ${sub.competitionName || sub.competitionKey}` : '· Todas las competiciones'}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ background: '#f0fdf4', color: '#16a34a', fontSize: 11, padding: '4px 10px', borderRadius: 20, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M13.5 4.5L6.5 11.5L2.5 7.5" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      Sincronizado
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(sub) }}
                      disabled={deletingId === sub.id}
                      style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: deletingId === sub.id ? 'wait' : 'pointer', fontSize: 14, color: '#9ca3af', padding: 0, flexShrink: 0 }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = '#ef4444'; e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = '#fef2f2' }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.color = '#9ca3af'; e.currentTarget.style.background = '#fff' }}
                      title="Eliminar suscripción"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ background: '#ffffff', border: '1px dashed #d1d5db', borderRadius: 16, padding: '48px 28px', textAlign: 'center', marginBottom: 28 }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: '#FEF3E2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 24 }}>📅</div>
            <h3 style={{ fontSize: 16, fontWeight: 500, color: '#111827', marginBottom: 8 }}>Aún no tienes favoritos</h3>
            <p style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.6, maxWidth: 320, margin: '0 auto 24px' }}>
              Elige tus ligas y equipos favoritos para que aparezcan automáticamente en tu Google Calendar.
            </p>
            <button style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#F18006', color: '#fff', border: 'none', borderRadius: 20, padding: '10px 24px', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
              Agregar favoritos
            </button>
          </div>
        )}

        {/* Grid de deportes */}
        <div style={{ fontSize: 13, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 16 }}>
          ¿Qué quieres seguir?
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
          {SPORTS.map((sport) => (
            <div key={sport.key}
              onClick={() => navigate(`/dashboard/${sport.key}`)}
              style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '20px 16px', textAlign: 'center', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = '#F18006'}
              onMouseLeave={e => e.currentTarget.style.borderColor = '#e5e7eb'}
            >
              <div style={{ fontSize: 32, marginBottom: 10 }}>{sport.emoji}</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>{sport.name}</div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, lineHeight: 1.4 }}>{sport.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
