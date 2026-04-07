import { useState, useEffect } from 'react'
import Sidebar from '../components/Sidebar'
import { API_BASE } from '../config'
import { getUser, getUserId, clearUser } from '../auth'

export default function Profile() {
  const user = getUser()
  const userId = getUserId()
  const [google, setGoogle] = useState({ connected: false, email: null, loading: true })
  const [subscriptions, setSubscriptions] = useState([])
  const [matchCount, setMatchCount] = useState(0)
  const [deletingId, setDeletingId] = useState(null)
  const [emailNotif, setEmailNotif] = useState(() => localStorage.getItem('fanschedule_email_notif') === 'true')
  const [partnerNotif, setPartnerNotif] = useState(() => localStorage.getItem('fanschedule_partner_notif') === 'true')

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  useEffect(() => {
    fetch(`${API_BASE}/auth/google/status/${userId}`)
      .then(res => res.json())
      .then(data => { if (data.ok) setGoogle({ connected: data.connected, email: data.email, loading: false }) })
      .catch(() => setGoogle(prev => ({ ...prev, loading: false })))

    fetch(`${API_BASE}/subscriptions/${userId}`)
      .then(res => res.json())
      .then(data => { if (data.ok) setSubscriptions(data.subscriptions) })
      .catch(() => {})

    fetch(`${API_BASE}/matches/${userId}?timezone=${encodeURIComponent(timezone)}`)
      .then(res => res.json())
      .then(data => { if (data.ok) setMatchCount(data.matches?.length || 0) })
      .catch(() => {})
  }, [])

  const handleDelete = async (sub) => {
    if (!window.confirm(`¿Desuscribirte de "${sub.competitionName || sub.teamName || 'esta liga'}"?`)) return
    setDeletingId(sub.id)
    try {
      const res = await fetch(`${API_BASE}/subscriptions/${sub.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.ok) setSubscriptions(prev => prev.filter(s => s.id !== sub.id))
    } catch (e) { console.error(e) }
    finally { setDeletingId(null) }
  }

  const toggleEmail = () => {
    const next = !emailNotif
    setEmailNotif(next)
    localStorage.setItem('fanschedule_email_notif', String(next))
  }

  const togglePartner = () => {
    const next = !partnerNotif
    setPartnerNotif(next)
    localStorage.setItem('fanschedule_partner_notif', String(next))
  }

  const uniqueSports = [...new Set(subscriptions.map(s => s.sport))]

  const sectionStyle = { background: '#ffffff', border: '1px solid #e8e8e8', borderRadius: 16, padding: '24px', marginBottom: 20 }
  const labelStyle = { fontSize: 11, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 16 }
  const statCard = { flex: 1, background: '#faf9f7', border: '1px solid #e8e8e8', borderRadius: 12, padding: '20px 16px', textAlign: 'center' }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <Sidebar activePath="/profile" />
      <div style={{ flex: 1, background: '#faf9f7', padding: '32px 28px', overflowY: 'auto' }}>

        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 22, fontWeight: 500, color: '#1C2430' }}>Mi perfil</h1>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Tu cuenta y configuración</p>
        </div>

        {/* INFORMACIÓN */}
        <div style={sectionStyle}>
          <div style={labelStyle}>Información</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#F18006', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 600, color: '#fff', flexShrink: 0 }}>
              {(user?.name || user?.email || '?')[0].toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 500, color: '#1C2430' }}>{user?.name || 'Usuario'}</div>
              <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>{user?.email || 'Sin email'}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: '#6b7280' }}>
              Miembro desde {new Date().toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}
            </div>
            <div style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
              {google.loading ? (
                <span style={{ color: '#6b7280' }}>Verificando Calendar...</span>
              ) : google.connected ? (
                <><span style={{ color: '#16a34a', fontWeight: 500 }}>✓ Google Calendar conectado</span><span style={{ color: '#6b7280' }}> — {google.email}</span></>
              ) : (
                <span style={{ color: '#dc2626', fontWeight: 500 }}>✗ Google Calendar no conectado</span>
              )}
            </div>
          </div>
        </div>

        {/* ESTADÍSTICAS */}
        <div style={sectionStyle}>
          <div style={labelStyle}>Estadísticas</div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={statCard}>
              <div style={{ fontSize: 28, fontWeight: 600, color: '#F18006' }}>{matchCount}</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Partidos próximos</div>
            </div>
            <div style={statCard}>
              <div style={{ fontSize: 28, fontWeight: 600, color: '#F18006' }}>{subscriptions.length}</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Ligas suscritas</div>
            </div>
            <div style={statCard}>
              <div style={{ fontSize: 28, fontWeight: 600, color: '#F18006' }}>{uniqueSports.length}</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Deportes</div>
            </div>
          </div>
        </div>

        {/* MIS LIGAS */}
        <div style={sectionStyle}>
          <div style={labelStyle}>Mis ligas</div>
          {subscriptions.length === 0 ? (
            <div style={{ fontSize: 13, color: '#6b7280', textAlign: 'center', padding: '16px 0' }}>No tienes suscripciones activas</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {subscriptions.map(sub => (
                <div key={sub.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', border: '1px solid #e8e8e8', borderRadius: 10 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: '#1C2430' }}>
                      {sub.teamName || sub.competitionName || `Liga ${sub.competitionKey}`}
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                      {sub.sport}{sub.competitionName && sub.teamName ? ` · ${sub.competitionName}` : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(sub)}
                    disabled={deletingId === sub.id}
                    style={{ background: 'none', border: '1px solid #fecaca', borderRadius: 8, padding: '6px 14px', fontSize: 12, color: '#dc2626', cursor: deletingId === sub.id ? 'wait' : 'pointer' }}
                  >
                    {deletingId === sub.id ? '...' : 'Desuscribir'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* NOTIFICACIONES */}
        <div style={sectionStyle}>
          <div style={labelStyle}>Notificaciones</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 14, color: '#1C2430' }}>Emails de FanSchedule</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>Resúmenes semanales y actualizaciones</div>
              </div>
              <div onClick={toggleEmail} style={{ width: 44, height: 24, borderRadius: 12, background: emailNotif ? '#F18006' : '#d1d5db', cursor: 'pointer', position: 'relative', transition: 'background 0.2s' }}>
                <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: emailNotif ? 22 : 2, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }} />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 14, color: '#1C2430' }}>Ofertas de socios</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>Descuentos en boletos y merchandise</div>
              </div>
              <div onClick={togglePartner} style={{ width: 44, height: 24, borderRadius: 12, background: partnerNotif ? '#F18006' : '#d1d5db', cursor: 'pointer', position: 'relative', transition: 'background 0.2s' }}>
                <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: partnerNotif ? 22 : 2, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }} />
              </div>
            </div>
          </div>
        </div>

        {/* CONFIGURACIÓN */}
        <div style={sectionStyle}>
          <div style={labelStyle}>Configuración</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 14, color: '#1C2430' }}>Zona horaria</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>Detectada automáticamente</div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#1C2430', background: '#faf9f7', border: '1px solid #e8e8e8', borderRadius: 8, padding: '6px 12px' }}>
              {timezone}
            </div>
          </div>
        </div>

        {/* BOTONES */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
          {!google.loading && (
            google.connected ? (
              <button
                onClick={() => { if (window.confirm('¿Desconectar Google Calendar? Tus eventos NO se eliminarán del calendario.')) { /* TODO: endpoint de desconexión */ } }}
                style={{ width: '100%', background: '#fff', border: '1px solid #fecaca', borderRadius: 12, padding: '14px', fontSize: 14, fontWeight: 500, color: '#dc2626', cursor: 'pointer' }}
              >
                Desconectar Google Calendar
              </button>
            ) : (
              <button
                onClick={() => { window.location.href = `${API_BASE}/auth/google` }}
                style={{ width: '100%', background: '#F18006', border: 'none', borderRadius: 12, padding: '14px', fontSize: 14, fontWeight: 500, color: '#fff', cursor: 'pointer' }}
              >
                + Conectar Google Calendar
              </button>
            )
          )}
          <button
            onClick={() => { clearUser(); window.location.href = '/' }}
            style={{ width: '100%', background: '#1C2430', border: 'none', borderRadius: 12, padding: '14px', fontSize: 14, fontWeight: 500, color: '#fff', cursor: 'pointer' }}
          >
            Cerrar sesión
          </button>
        </div>

      </div>
    </div>
  )
}
