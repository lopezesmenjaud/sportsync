import { useState, useEffect, useRef } from 'react'
import Sidebar from '../components/Sidebar'
import CalendarConnectModal from '../components/CalendarConnectModal'
import { API_BASE } from '../config'
import { apiFetch } from '../api'
import { useEstadoGoogle, invalidarEstadoGoogle } from '../googleStatus'
import { getUser, getUserId, clearUser } from '../auth'

export default function Profile() {
  const user = getUser()
  const userId = getUserId()
  const { estado: google, cargando: googleCargando } = useEstadoGoogle()
  const [mostrarAviso, setMostrarAviso] = useState(false)
  const [subscriptions, setSubscriptions] = useState([])
  const [matchCount, setMatchCount] = useState(0)
  const [deletingId, setDeletingId] = useState(null)
  const [reminderMinutes, setReminderMinutes] = useState(30) // entero o null; se sobreescribe al cargar
  const [reminderMsg, setReminderMsg] = useState(null)       // { text, color } | null — feedback de guardado
  const reminderTimer = useRef(null)                         // limpia el mensaje de éxito tras ~3s

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  useEffect(() => {
    // El estado de Google ya no se pide aquí: lo da useEstadoGoogle, compartido con el gate de
    // App y el Sidebar.
    apiFetch(`/subscriptions/${userId}`)
      .then(res => res.json())
      .then(data => { if (data.ok) setSubscriptions(data.subscriptions) })
      .catch(() => {})

    apiFetch(`/matches/${userId}?timezone=${encodeURIComponent(timezone)}`)
      .then(res => res.json())
      .then(data => { if (data.ok) setMatchCount(data.matches?.length || 0) })
      .catch(() => {})

    apiFetch(`/api/reminders/${userId}`)
      .then(res => res.json())
      .then(data => { if (data && 'minutes' in data) setReminderMinutes(data.minutes) })
      .catch(() => {})
  }, [])

  const handleDelete = async (sub) => {
    if (!window.confirm(`¿Desuscribirte de "${sub.competitionName || sub.teamName || 'esta liga'}"?`)) return
    setDeletingId(sub.id)
    try {
      const res = await apiFetch(`/subscriptions/${sub.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.ok) setSubscriptions(prev => prev.filter(s => s.id !== sub.id))
    } catch (e) { console.error(e) }
    finally { setDeletingId(null) }
  }

  // Auto-guardado del recordatorio: guarda al cambiar, sin botón. El value del <select> siempre es
  // string; "null" -> null y el resto -> Number() (NO parseInt sobre "null").
  const handleReminderChange = async (e) => {
    const raw = e.target.value
    const next = raw === 'null' ? null : Number(raw)
    const prev = reminderMinutes
    if (reminderTimer.current) { clearTimeout(reminderTimer.current); reminderTimer.current = null }
    setReminderMinutes(next)
    setReminderMsg({ text: 'Guardando...', color: '#6b7280' })
    try {
      const res = await apiFetch(`/api/reminders/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes: next }),
      })
      if (!res.ok) throw new Error('bad status')
      const data = await res.json()
      if (data.applied === true) {
        setReminderMsg({ text: 'Guardado ✓', color: '#16a34a' })
      } else {
        setReminderMsg({ text: 'Guardado. Se aplicará cuando conectes tu calendario.', color: '#6b7280' })
      }
      reminderTimer.current = setTimeout(() => setReminderMsg(null), 3000)
    } catch {
      setReminderMinutes(prev) // revertir el select al valor anterior
      setReminderMsg({ text: 'No se pudo guardar', color: '#dc2626' })
    }
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
              {googleCargando || !google ? (
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

        {/* RECORDATORIOS */}
        <div style={sectionStyle}>
          <div style={labelStyle}>Recordatorios</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 14 }}>
            Te avisamos antes de que empiece cada partido.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <select
              value={reminderMinutes === null ? 'null' : String(reminderMinutes)}
              onChange={handleReminderChange}
              style={{ fontSize: 14, color: '#1C2430', background: '#faf9f7', border: '1px solid #e8e8e8', borderRadius: 10, padding: '10px 14px', outline: 'none', cursor: 'pointer' }}
            >
              <option value="60">1 hora antes</option>
              <option value="45">45 minutos antes</option>
              <option value="30">30 minutos antes</option>
              <option value="15">15 minutos antes</option>
              <option value="10">10 minutos antes</option>
              <option value="5">5 minutos antes</option>
              <option value="0">Al empezar</option>
              <option value="null">Sin recordatorio</option>
            </select>
            {reminderMsg && (
              <span style={{ fontSize: 13, color: reminderMsg.color }}>{reminderMsg.text}</span>
            )}
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
          {/* "Desconectar Google Calendar" se quitó: no hacía nada (no hay endpoint de
              desconexión). Con el calendario conectado no hay botón; el estado ya se ve arriba. */}
          {!googleCargando && google && !(google.connected && google.hasCalendarScope) && (
            <button
              onClick={() => setMostrarAviso(true)}
              style={{ width: '100%', background: '#F18006', border: 'none', borderRadius: 12, padding: '14px', fontSize: 14, fontWeight: 500, color: '#fff', cursor: 'pointer' }}
            >
              + Conectar Google Calendar
            </button>
          )}
          <button
            onClick={() => { clearUser(); window.location.href = '/' }}
            style={{ width: '100%', background: '#1C2430', border: 'none', borderRadius: 12, padding: '14px', fontSize: 14, fontWeight: 500, color: '#fff', cursor: 'pointer' }}
          >
            Cerrar sesión
          </button>
        </div>

      </div>

      {mostrarAviso && (
        <CalendarConnectModal
          onConnect={() => { invalidarEstadoGoogle(); window.location.href = `${API_BASE}/auth/google` }}
          onExplore={() => setMostrarAviso(false)}
          etiquetaSecundaria="Ahora no"
        />
      )}
    </div>
  )
}
