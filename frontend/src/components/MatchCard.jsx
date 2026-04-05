import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import WatchPanel from './WatchPanel'
import { API_BASE } from '../config'

export default function MatchCard({ match, showDate = true }) {
  const navigate = useNavigate()
  const [summary, setSummary]               = useState(null)
  const [loadingSummary, setLoadingSummary]  = useState(false)
  const [summaryOpen, setSummaryOpen]        = useState(false)
  const [watchOpen, setWatchOpen]            = useState(false)
  const [ticketsOpen, setTicketsOpen]        = useState(false)
  const [tickets, setTickets]               = useState(null)
  const [loadingTickets, setLoadingTickets]  = useState(false)

  const handleSummaryToggle = async () => {
    const opening = !summaryOpen
    setSummaryOpen(opening)
    if (opening && !summary && !loadingSummary) {
      setLoadingSummary(true)
      try {
        const res  = await fetch(`${API_BASE}/summary/${match.providerMatchId}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }
        })
        const data = await res.json()
        setSummary(data.ok ? data.summary : (data.message || 'Resumen no disponible.'))
      } catch {
        setSummary('No se pudo generar el resumen en este momento.')
      } finally {
        setLoadingSummary(false)
      }
    }
  }

  const handleTicketsToggle = async () => {
    const opening = !ticketsOpen
    setTicketsOpen(opening)
    if (opening && !tickets && !loadingTickets) {
      setLoadingTickets(true)
      try {
        const res  = await fetch(`${API_BASE}/api/tickets/${match.providerMatchId}`)
        const data = await res.json()
        if (data.ok) setTickets(data)
      } catch { /* ignore */ }
      finally { setLoadingTickets(false) }
    }
  }

  const startDate    = new Date(match.currentStartUtc)
  const timeStr      = startDate.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City' })
  const dateStr      = startDate.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Mexico_City' })
  const homeInitials = match.homeParticipantName?.split(' ').map(w => w[0]).join('').slice(0, 3) || '?'
  const awayInitials = match.awayParticipantName?.split(' ').map(w => w[0]).join('').slice(0, 3) || '?'

  return (
    <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 16, overflow: 'hidden', marginBottom: 12 }}>

      {/* Header */}
      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #e5e7eb' }}>
        <span style={{ fontSize: 11, fontWeight: 500, color: '#F18006', background: '#FEF3E2', padding: '3px 10px', borderRadius: 20 }}>
          ⚽ {match.competitionName}
        </span>
        <span style={{ fontSize: 12, color: '#6b7280' }}>
          {showDate ? `${dateStr} · ` : ''}{timeStr} CDMX
        </span>
      </div>

      {/* Equipos */}
      <div style={{ padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flex: 1 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: '#374151' }}>
            {homeInitials}
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#111827', textAlign: 'center' }}>{match.homeParticipantName}</div>
        </div>
        <div style={{ padding: '0 16px', fontSize: 20, fontWeight: 500, color: '#d1d5db' }}>vs</div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flex: 1 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: '#374151' }}>
            {awayInitials}
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#111827', textAlign: 'center' }}>{match.awayParticipantName}</div>
        </div>
      </div>

      {/* Estadio */}
      {match.venueName && (
        <div style={{ fontSize: 12, color: '#6b7280', textAlign: 'center', paddingBottom: 14 }}>
          📍 {match.venueName}
        </div>
      )}

      {/* Panel: Donde verlo */}
      <WatchPanel
        sport={match.sport}
        competitionKey={match.competitionKey}
        competitionName={match.competitionName}
        isOpen={watchOpen}
      />

      {/* Panel: Resumen IA */}
      {summaryOpen && (
        <div style={{ borderTop: '1px solid #e5e7eb', padding: '16px 20px' }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 12 }}>
            Resumen IA
          </div>
          <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 10, fontWeight: 500, color: '#263140', marginBottom: 8 }}>✦ Generado por FanSchedule IA</div>
            {loadingSummary
              ? <div style={{ fontSize: 13, color: '#6b7280' }}>Generando resumen...</div>
              : <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.7 }}>{summary}</div>
            }
          </div>
        </div>
      )}

      {/* Panel: Boletos */}
      {ticketsOpen && (
        <div style={{ borderTop: '1px solid #e5e7eb', padding: '16px 20px' }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 12 }}>
            Boletos
          </div>
          {loadingTickets ? (
            <div style={{ fontSize: 13, color: '#6b7280', padding: '8px 0' }}>Buscando boletos...</div>
          ) : tickets ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Ticketmaster */}
              {tickets.ticketmasterEvents?.length > 0 ? (
                tickets.ticketmasterEvents.map((ev, i) => (
                  <a key={i} href={ev.url} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10, textDecoration: 'none', cursor: 'pointer' }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: '#263140' }}>{ev.name}</div>
                      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                        {ev.venue && `${ev.venue} · `}{ev.date}{ev.priceRange && ` · ${ev.priceRange}`}
                      </div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 500, color: '#263140', flexShrink: 0 }}>Ticketmaster →</span>
                  </a>
                ))
              ) : (
                <a href={tickets.ticketmasterSearchUrl} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10, textDecoration: 'none' }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#263140' }}>Buscar en Ticketmaster</div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{tickets.keyword}</div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 500, color: '#263140', flexShrink: 0 }}>Buscar →</span>
                </a>
              )}

              {/* StubHub */}
              <a href={tickets.stubhubUrl} target="_blank" rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 10, textDecoration: 'none' }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#7c3aed' }}>Buscar en StubHub</div>
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>Reventa y segunda mano</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 500, color: '#7c3aed', flexShrink: 0 }}>StubHub →</span>
              </a>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: '#6b7280' }}>No se pudieron cargar las opciones de boletos.</div>
          )}
        </div>
      )}

      {/* Footer */}
      <div style={{ padding: '12px 20px', borderTop: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleSummaryToggle}
            style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 20, padding: '6px 14px', fontSize: 12, color: '#6b7280', cursor: 'pointer' }}
          >
            {summaryOpen ? '▲ Menos info' : '▼ Ver resumen IA'}
          </button>
          <button
            onClick={() => navigate(`/match/${match.providerMatchId}`)}
            style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 20, padding: '6px 14px', fontSize: 12, color: '#263140', cursor: 'pointer' }}
          >
            Más info →
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setWatchOpen(!watchOpen)}
            style={{
              background: watchOpen ? '#f0f9ff' : '#f3f4f6',
              color: watchOpen ? '#263140' : '#374151',
              border: watchOpen ? '1px solid #bae6fd' : '1px solid #e5e7eb',
              borderRadius: 20, padding: '6px 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer'
            }}
          >
            📺 Dónde verlo
          </button>
          <button
            onClick={handleTicketsToggle}
            style={{
              background: ticketsOpen ? '#FEF3E2' : '#F18006',
              color: ticketsOpen ? '#F18006' : '#fff',
              border: ticketsOpen ? '1px solid #F18006' : 'none',
              borderRadius: 20, padding: '6px 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer'
            }}
          >
            🎟 Boletos
          </button>
        </div>
      </div>
    </div>
  )
}
