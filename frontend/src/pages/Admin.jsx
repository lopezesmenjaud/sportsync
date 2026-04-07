import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { API_BASE } from '../config'
import { getUserId } from '../auth'

const ADMIN_EMAIL = 'lopezesmenjaud@gmail.com'

export default function Admin() {
  const userId = getUserId()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (userId !== ADMIN_EMAIL) return
    fetch(`${API_BASE}/api/admin/stats`, {
      headers: { 'X-Admin-User': userId }
    })
      .then(res => res.json())
      .then(data => {
        if (data.ok) setStats(data)
        else setError(data.error)
      })
      .catch(() => setError('Error de conexión'))
      .finally(() => setLoading(false))
  }, [])

  if (userId !== ADMIN_EMAIL) return <Navigate to="/dashboard" replace />

  const card = { background: '#ffffff', border: '1px solid #e8e8e8', borderRadius: 16, padding: '24px', marginBottom: 20 }
  const label = { fontSize: 11, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 16 }
  const statBox = { flex: 1, background: '#faf9f7', border: '1px solid #e8e8e8', borderRadius: 12, padding: '20px 16px', textAlign: 'center' }

  return (
    <div style={{ background: '#faf9f7', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 500, color: '#1C2430' }}>Admin Dashboard</h1>
            <p style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Panel de administración de FanSchedule</p>
          </div>
          <a href="/dashboard" style={{ fontSize: 13, color: '#F18006', textDecoration: 'none' }}>← Volver al app</a>
        </div>

        {loading && <div style={{ textAlign: 'center', padding: 48, color: '#6b7280', fontSize: 13 }}>Cargando estadísticas...</div>}
        {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#dc2626' }}>{error}</div>}

        {stats && (
          <>
            {/* RESUMEN GENERAL */}
            <div style={card}>
              <div style={label}>Resumen general</div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={statBox}>
                  <div style={{ fontSize: 32, fontWeight: 600, color: '#F18006' }}>{stats.totalUsers}</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Total usuarios</div>
                </div>
                <div style={statBox}>
                  <div style={{ fontSize: 32, fontWeight: 600, color: '#F18006' }}>{stats.newUsersThisWeek}</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Nuevos esta semana</div>
                </div>
                <div style={statBox}>
                  <div style={{ fontSize: 32, fontWeight: 600, color: '#F18006' }}>{stats.syncedEvents}</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Eventos en Calendar</div>
                </div>
              </div>
            </div>

            {/* LIGAS MÁS POPULARES */}
            <div style={card}>
              <div style={label}>Ligas más populares</div>
              {stats.topLeagues.length === 0 ? (
                <div style={{ fontSize: 13, color: '#6b7280', textAlign: 'center', padding: '12px 0' }}>Sin datos</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {stats.topLeagues.map((l, i) => (
                    <div key={l.competitionKey} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', border: '1px solid #f0f0f0', borderRadius: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#F18006', width: 24 }}>{i + 1}.</span>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 500, color: '#1C2430' }}>{l.competitionName}</div>
                          <div style={{ fontSize: 11, color: '#6b7280' }}>{l.sport}</div>
                        </div>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1C2430' }}>{l.subscribers} {l.subscribers === 1 ? 'usuario' : 'usuarios'}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* DEPORTES */}
            <div style={card}>
              <div style={label}>Distribución por deporte</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {stats.sportDistribution.map(s => (
                  <div key={s.sport} style={{ background: '#faf9f7', border: '1px solid #e8e8e8', borderRadius: 10, padding: '12px 18px', textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 600, color: '#F18006' }}>{s.users}</div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{s.sport}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* USUARIOS */}
            <div style={card}>
              <div style={label}>Usuarios ({stats.users.length})</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e8e8e8' }}>
                      <th style={{ textAlign: 'left', padding: '8px 10px', color: '#6b7280', fontWeight: 500 }}>Email</th>
                      <th style={{ textAlign: 'left', padding: '8px 10px', color: '#6b7280', fontWeight: 500 }}>Registro</th>
                      <th style={{ textAlign: 'center', padding: '8px 10px', color: '#6b7280', fontWeight: 500 }}>Ligas</th>
                      <th style={{ textAlign: 'center', padding: '8px 10px', color: '#6b7280', fontWeight: 500 }}>Emails FS</th>
                      <th style={{ textAlign: 'center', padding: '8px 10px', color: '#6b7280', fontWeight: 500 }}>Emails Socios</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.users.map(u => (
                      <tr key={u.email} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '10px 10px', color: '#1C2430', fontWeight: 500 }}>{u.email}</td>
                        <td style={{ padding: '10px 10px', color: '#6b7280' }}>
                          {u.createdAtUtc ? new Date(u.createdAtUtc).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                        </td>
                        <td style={{ padding: '10px 10px', color: '#1C2430', textAlign: 'center', fontWeight: 500 }}>{u.leagueCount}</td>
                        <td style={{ padding: '10px 10px', textAlign: 'center' }}>
                          <span style={{ color: u.emailFanschedule ? '#16a34a' : '#dc2626', fontWeight: 500 }}>{u.emailFanschedule ? 'Sí' : 'No'}</span>
                        </td>
                        <td style={{ padding: '10px 10px', textAlign: 'center' }}>
                          <span style={{ color: u.emailPartners ? '#16a34a' : '#dc2626', fontWeight: 500 }}>{u.emailPartners ? 'Sí' : 'No'}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  )
}
