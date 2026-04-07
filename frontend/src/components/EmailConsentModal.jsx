import { API_BASE } from '../config'
import { getUserId } from '../auth'

function saveConsent(emailFanschedule, emailPartners) {
  const userId = getUserId()
  if (!userId) return
  fetch(`${API_BASE}/api/consent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, emailFanschedule, emailPartners })
  }).catch(() => {})
}

export default function EmailConsentModal({ onAccept, onDecline }) {
  const handleAccept = () => {
    saveConsent(true, true)
    onAccept()
  }

  const handleDecline = () => {
    saveConsent(false, false)
    onDecline()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 2000 }}>
      <div style={{ background: '#ffffff', borderRadius: 20, padding: '36px 32px', maxWidth: 420, width: '100%', textAlign: 'center' }}>

        <div style={{ fontSize: 32, marginBottom: 16 }}>📬</div>

        <h2 style={{ fontSize: 20, fontWeight: 600, color: '#1C2430', marginBottom: 12 }}>
          ¿Quieres estar al tanto?
        </h2>

        <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.6, marginBottom: 28 }}>
          Envíanos tu autorización para mandarte novedades de FanSchedule y ofertas de nuestros socios (boletos, streaming, promociones deportivas). Puedes cambiar esto cuando quieras en tu perfil.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            onClick={handleAccept}
            style={{ width: '100%', background: '#F18006', border: 'none', borderRadius: 12, padding: '14px', fontSize: 14, fontWeight: 500, color: '#fff', cursor: 'pointer' }}
          >
            Sí, quiero recibir novedades
          </button>
          <button
            onClick={handleDecline}
            style={{ width: '100%', background: '#f0f0f0', border: 'none', borderRadius: 12, padding: '14px', fontSize: 14, fontWeight: 500, color: '#6b7280', cursor: 'pointer' }}
          >
            No por ahora
          </button>
        </div>

      </div>
    </div>
  )
}
