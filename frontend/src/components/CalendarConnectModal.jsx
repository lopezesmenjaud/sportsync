export default function CalendarConnectModal({ onConnect, onExplore }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 2100 }}>
      <div style={{ background: '#ffffff', borderRadius: 20, padding: '36px 32px', maxWidth: 440, width: '100%', textAlign: 'center' }}>

        <div style={{ fontSize: 32, marginBottom: 16 }}>📅</div>

        <h2 style={{ fontSize: 20, fontWeight: 600, color: '#1C2430', marginBottom: 12 }}>
          Conecta tu calendario
        </h2>

        <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.6, marginBottom: 16 }}>
          FanSchedule crea un calendario propio en tu Google Calendar y ahí te agenda los partidos de tus equipos.
        </p>

        <div style={{ background: '#FEF3E2', border: '1px solid #F18006', borderRadius: 12, padding: '12px 14px', marginBottom: 20, textAlign: 'left' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: '#7c2d12', lineHeight: 1.5 }}>
            <span style={{ flexShrink: 0 }}>⚠️</span>
            <span>En la siguiente pantalla Google te va a pedir permiso — asegúrate de dejar <strong>palomeada la casilla del calendario</strong>, o no podremos agendarte nada.</span>
          </div>
        </div>

        <button
          onClick={onConnect}
          style={{ width: '100%', background: '#F18006', border: 'none', borderRadius: 12, padding: '15px', fontSize: 15, fontWeight: 600, color: '#fff', cursor: 'pointer', marginBottom: 14 }}
        >
          Conectar Google Calendar
        </button>

        <div>
          <button
            onClick={onExplore}
            style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: 13, cursor: 'pointer', textDecoration: 'underline', padding: 4 }}
          >
            Explorar primero
          </button>
        </div>

        <p style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.5, marginTop: 18 }}>
          Solo tocamos el calendario que creamos. No leemos ni modificamos tus otros calendarios.
        </p>

      </div>
    </div>
  )
}
