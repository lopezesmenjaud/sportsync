import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import WatchPanel from '../components/WatchPanel'
import { API_BASE } from '../config'

export default function MatchDetail() {
  const { matchId } = useParams()
  const navigate = useNavigate()
  const [match, setMatch] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [summary, setSummary] = useState(null)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [tickets, setTickets] = useState(null)
  const [loadingTickets, setLoadingTickets] = useState(false)

  useEffect(() => {
    fetch(`${API_BASE}/api/match/${matchId}`)
      .then(res => res.json())
      .then(data => {
        if (data.ok) setMatch(data.match)
        else setError('Partido no encontrado')
      })
      .catch(() => setError('Error de conexión'))
      .finally(() => setLoading(false))
  }, [matchId])

  useEffect(() => {
    if (!match) return
    setLoadingSummary(true)
    fetch(`${API_BASE}/summary/${match.providerMatchId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }
    })
      .then(res => res.json())
      .then(data => setSummary(data.ok ? data.summary : (data.message || 'Resumen no disponible.')))
      .catch(() => setSummary('No se pudo generar el resumen.'))
      .finally(() => setLoadingSummary(false))

    setLoadingTickets(true)
    fetch(`${API_BASE}/api/tickets/${match.providerMatchId}`)
      .then(res => res.json())
      .then(data => { if (data.ok) setTickets(data) })
      .catch(() => {})
      .finally(() => setLoadingTickets(false))
  }, [match?.providerMatchId])

  if (loading) return (
    <div style={{ background: '#faf9f7', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#666666', fontSize: 14 }}>Cargando partido...</div>
    </div>
  )

  if (error || !match) return (
    <div style={{ background: '#faf9f7', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
      <div style={{ color: '#666666', fontSize: 14 }}>{error || 'Partido no encontrado'}</div>
      <button onClick={() => navigate('/upcoming')} style={{ background: '#f0f0f0', color: '#666666', border: 'none', borderRadius: 20, padding: '8px 20px', fontSize: 13, cursor: 'pointer' }}>
        ← Volver a partidos
      </button>
    </div>
  )

  const startDate = new Date(match.currentStartUtc)
  const timeStr = startDate.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City' })
  const dateStr = startDate.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Mexico_City' })
  const isTeamVsTeam = match.homeParticipantName && match.awayParticipantName
  const homeInitials = match.homeParticipantName?.split(' ').map(w => w[0]).join('').slice(0, 3) || '?'
  const awayInitials = match.awayParticipantName?.split(' ').map(w => w[0]).join('').slice(0, 3) || '?'

  return (
    <div style={{ background: '#faf9f7', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 20px' }}>

        {/* Back */}
        <button onClick={() => navigate(-1)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#666666', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 24, padding: 0 }}>
          ← Volver
        </button>

        {/* Card principal */}
        <div style={{ background: '#ffffff', border: '0.5px solid #e8e8e8', borderRadius: 20, overflow: 'hidden' }}>

          {/* Header */}
          <div style={{ padding: '20px 24px', borderBottom: '0.5px solid #e8e8e8', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: '#F18006', background: 'rgba(241,128,6,0.15)', border: '0.5px solid rgba(241,128,6,0.3)', padding: '4px 12px', borderRadius: 20 }}>
              ⚽ {match.competitionName}
            </span>
            <span style={{ fontSize: 13, color: '#666666' }}>
              {dateStr} · {timeStr} CDMX
            </span>
          </div>

          {/* VS o nombre de evento */}
          {isTeamVsTeam ? (
            <div style={{ padding: '32px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, flex: 1 }}>
                <div style={{ width: 64, height: 64, borderRadius: 16, background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 500, color: '#666666' }}>
                  {homeInitials}
                </div>
                <div style={{ fontSize: 16, fontWeight: 500, color: '#1C2430', textAlign: 'center' }}>{match.homeParticipantName}</div>
              </div>
              <div style={{ padding: '0 20px', fontSize: 24, fontWeight: 600, color: '#d1d5db' }}>vs</div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, flex: 1 }}>
                <div style={{ width: 64, height: 64, borderRadius: 16, background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 500, color: '#666666' }}>
                  {awayInitials}
                </div>
                <div style={{ fontSize: 16, fontWeight: 500, color: '#1C2430', textAlign: 'center' }}>{match.awayParticipantName}</div>
              </div>
            </div>
          ) : (
            <div style={{ padding: '32px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 500, color: '#1C2430', lineHeight: 1.4 }}>
                {match.eventName || match.competitionName}
              </div>
            </div>
          )}

          {/* Estadio */}
          {(match.venueName || match.city) && (
            <div style={{ textAlign: 'center', paddingBottom: 24 }}>
              {match.venueName && <div style={{ fontSize: 13, color: '#CCDDEE' }}>📍 {match.venueName}</div>}
              {match.city && <div style={{ fontSize: 12, color: '#666666', marginTop: 4 }}>{match.city}{match.country ? `, ${match.country}` : ''}</div>}
            </div>
          )}
        </div>

        {/* Dónde verlo */}
        <div style={{ background: '#ffffff', border: '0.5px solid #e8e8e8', borderRadius: 20, overflow: 'hidden', marginTop: 16 }}>
          <div style={{ padding: '16px 24px', fontSize: 13, fontWeight: 500, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.8px', borderBottom: '0.5px solid #e8e8e8' }}>
            📺 Dónde verlo
          </div>
          <WatchPanel
            sport={match.sport}
            competitionKey={match.competitionKey}
            competitionName={match.competitionName}
            isOpen={true}
          />
        </div>

        {/* Resumen IA */}
        <div style={{ background: '#ffffff', border: '0.5px solid #e8e8e8', borderRadius: 20, overflow: 'hidden', marginTop: 16, padding: '20px 24px' }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 14 }}>
            Resumen IA
          </div>
          <div style={{ background: 'rgba(16,177,199,0.06)', border: '0.5px solid rgba(16,177,199,0.15)', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 10, fontWeight: 500, color: '#10B1C7', marginBottom: 8 }}>✦ Generado por FanSchedule IA</div>
            {loadingSummary
              ? <div style={{ fontSize: 13, color: '#666666' }}>Generando resumen...</div>
              : <div style={{ fontSize: 13, color: '#CCDDEE', lineHeight: 1.7 }}>{summary}</div>
            }
          </div>
        </div>

        {/* Boletos */}
        <div style={{ background: '#ffffff', border: '0.5px solid #e8e8e8', borderRadius: 20, overflow: 'hidden', marginTop: 16, padding: '20px 24px' }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 14 }}>
            🎟 Boletos
          </div>
          {loadingTickets ? (
            <div style={{ fontSize: 13, color: '#666666' }}>Buscando boletos...</div>
          ) : tickets ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {tickets.ticketmasterEvents?.length > 0 ? (
                tickets.ticketmasterEvents.map((ev, i) => (
                  <a key={i} href={ev.url} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: 'rgba(16,177,199,0.06)', border: '1px solid rgba(16,177,199,0.2)', borderRadius: 10, textDecoration: 'none' }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: '#10B1C7' }}>{ev.name}</div>
                      <div style={{ fontSize: 11, color: '#666666', marginTop: 2 }}>
                        {ev.venue && `${ev.venue} · `}{ev.date}{ev.priceRange && ` · ${ev.priceRange}`}
                      </div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 500, color: '#10B1C7', flexShrink: 0 }}>Ticketmaster →</span>
                  </a>
                ))
              ) : (
                <a href={tickets.ticketmasterSearchUrl} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: 'rgba(16,177,199,0.06)', border: '1px solid rgba(16,177,199,0.2)', borderRadius: 10, textDecoration: 'none' }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#10B1C7' }}>Buscar en Ticketmaster</div>
                    <div style={{ fontSize: 11, color: '#666666', marginTop: 2 }}>{tickets.keyword}</div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 500, color: '#10B1C7', flexShrink: 0 }}>Buscar →</span>
                </a>
              )}
              <a href={tickets.stubhubUrl} target="_blank" rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: 'rgba(107,33,168,0.06)', border: '1px solid rgba(107,33,168,0.2)', borderRadius: 10, textDecoration: 'none' }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#a855f7' }}>Buscar en StubHub</div>
                  <div style={{ fontSize: 11, color: '#666666', marginTop: 2 }}>Reventa y segunda mano</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 500, color: '#a855f7', flexShrink: 0 }}>StubHub →</span>
              </a>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: '#666666' }}>No se pudieron cargar las opciones de boletos.</div>
          )}
        </div>

      </div>
    </div>
  )
}
