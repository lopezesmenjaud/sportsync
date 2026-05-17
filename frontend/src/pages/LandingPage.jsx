import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { API_BASE } from '../config'

const TICKER_ITEMS = [
  'Real Madrid vs Barcelona · Hoy 21:00',
  'GP de Bahrein · Sáb 15:00',
  'Lakers vs Warriors · Mié 20:00',
  'Chiefs vs Eagles · Dom 18:30',
  'Manchester City vs Arsenal · Mar 20:45',
  'Verstappen vs Hamilton · GP Miami',
]

const FEATURES = [
  { num: '01', title: 'Sincronización automática', desc: 'Tus partidos en Google Calendar sin hacer nada. Si el horario cambia, tu calendario se actualiza solo.' },
  { num: '02', title: 'Dónde verlo', desc: 'Cada evento incluye en qué canal o plataforma de streaming puedes ver el partido en tu país.' },
  { num: '03', title: 'Compra boletos', desc: 'Liga directa para comprar entradas desde el evento de tu calendario. Sin buscar en otros lados.' },
  { num: '04', title: 'Eventos cerca de ti', desc: 'Comparte tu ubicación y descubre qué partidos hay cerca con boletos disponibles ahora mismo.' },
  { num: '05', title: 'Planea tu viaje', desc: '¿Viajando? Ingresa fechas y destino para ver qué partidos hay durante tu estancia y comprar entradas.' },
  { num: '06', title: 'Trending y análisis', desc: 'Lo más comentado en redes y videos de analistas, directo en el evento antes del partido.' },
]

const EVENTS = [
  { sport: 'Fútbol · La Liga', teams: 'Real Madrid vs Barcelona', meta: 'Hoy · 21:00 · Santiago Bernabéu', status: 'En vivo', statusClass: 'status-live' },
  { sport: 'Fórmula 1', teams: 'GP de Bahrein — Clasificación', meta: 'Sáb · 15:00 · Circuito de Sakhir', status: 'En 2 horas', statusClass: 'status-soon' },
  { sport: 'NBA', teams: 'Lakers vs Golden State Warriors', meta: 'Mié · 20:00 · Crypto.com Arena', status: 'Programado', statusClass: 'status-sched' },
  { sport: 'NFL', teams: 'Kansas City Chiefs vs Eagles', meta: 'Dom · 18:30 · Arrowhead Stadium', status: 'Programado', statusClass: 'status-sched' },
]

const SPORTS = ['Fútbol', 'NFL', 'NBA', 'MLB', 'Fórmula 1', 'Y más']

const GoogleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
)

export default function LandingPage() {
  const tickerRef = useRef(null)

  const handleLogin = () => {
    window.location.href = `${API_BASE}/auth/google`
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', color: '#fff' }}>

      {/* Nav */}
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 28px', background: '#1C2430' }}>
        <img src="/fanschedule-logo.png" alt="FanSchedule" style={{ height: 80, objectFit: 'contain' }} />
        <button onClick={handleLogin} style={{ background: '#F18006', color: '#fff', border: 'none', borderRadius: 24, padding: '10px 24px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
          Empezar gratis
        </button>
      </nav>

      {/* Hero */}
      <div style={{ background: '#1C2430', padding: '72px 28px 80px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -100, left: '50%', transform: 'translateX(-50%)', width: 600, height: 400, background: 'radial-gradient(ellipse, rgba(16,177,199,0.25) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(16,177,199,0.15)', border: '1px solid rgba(16,177,199,0.35)', color: '#10B1C7', fontSize: 12, fontWeight: 500, padding: '6px 16px', borderRadius: 24, marginBottom: 28 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10B1C7' }} />
          Your sports schedule, built for fans.
        </div>
        <h1 style={{ fontSize: 52, fontWeight: 500, color: '#fff', lineHeight: 1.1, marginBottom: 24, maxWidth: 680, marginLeft: 'auto', marginRight: 'auto' }}>
          Never lose track of the<br />matches you <span style={{ color: '#F18006' }}>care about</span>
        </h1>
        <p style={{ fontSize: 17, color: '#8899AA', maxWidth: 460, margin: '0 auto 44px', lineHeight: 1.7 }}>
          A sports schedule that feels built around your fan life. Connect your Google Calendar and every match appears automatically.
        </p>
        <button onClick={handleLogin} style={{ display: 'inline-flex', alignItems: 'center', gap: 12, background: '#F18006', color: '#fff', fontSize: 15, fontWeight: 500, padding: '15px 32px', borderRadius: 50, border: 'none', cursor: 'pointer' }}>
          <GoogleIcon />
          Continuar con Google — es gratis
        </button>
      </div>

      {/* Ticker */}
      <div style={{ background: '#142238', padding: '14px 0', overflow: 'hidden', whiteSpace: 'nowrap' }}>
        <div style={{ display: 'inline-flex', gap: 48, animation: 'ticker 20s linear infinite' }}>
          {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
            <span key={i} style={{ fontSize: 13, fontWeight: 500, color: '#fff', flexShrink: 0 }}>{item}</span>
          ))}
        </div>
      </div>

      {/* Events preview */}
      <div style={{ background: '#0F1A2E', padding: '48px 28px', display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
        {EVENTS.map((e, i) => (
          <div key={i} style={{ background: '#142238', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '18px 20px', minWidth: 200, flex: 1, maxWidth: 220 }}>
            <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 10, color: i === 0 ? '#06D6A0' : i === 1 ? '#FF5C00' : i === 2 ? '#c084fc' : '#10B1C7' }}>{e.sport}</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: '#fff', marginBottom: 8, lineHeight: 1.4 }}>{e.teams}</div>
            <div style={{ fontSize: 12, color: '#8899AA' }}>{e.meta}</div>
            <div style={{ display: 'inline-block', marginTop: 10, fontSize: 11, padding: '3px 10px', borderRadius: 20, background: e.statusClass === 'status-live' ? 'rgba(6,214,160,0.15)' : e.statusClass === 'status-soon' ? 'rgba(255,92,0,0.15)' : 'rgba(255,255,255,0.08)', color: e.statusClass === 'status-live' ? '#06D6A0' : e.statusClass === 'status-soon' ? '#FF5C00' : 'rgba(255,255,255,0.5)' }}>{e.status}</div>
          </div>
        ))}
      </div>

      {/* Features */}
      <div style={{ background: '#0F1A2E', padding: '80px 28px', maxWidth: 960, margin: '0 auto' }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#10B1C7', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 12 }}>Por qué FanSchedule</div>
        <h2 style={{ fontSize: 36, fontWeight: 500, color: '#FFFFFF', marginBottom: 48, lineHeight: 1.25 }}>Más que un calendario.<br />Tu guía deportiva completa.</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          {FEATURES.map((f, i) => (
            <div key={i} style={{ background: '#142238', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '28px 24px' }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: '#10B1C7', marginBottom: 16, letterSpacing: 1 }}>{f.num}</div>
              <h3 style={{ fontSize: 16, fontWeight: 500, color: '#FFFFFF', marginBottom: 10 }}>{f.title}</h3>
              <p style={{ fontSize: 13, color: '#8899AA', lineHeight: 1.65 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Steps */}
      <div style={{ background: '#1C2430', padding: '80px 28px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: '#10B1C7', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 12 }}>Cómo funciona</div>
          <h2 style={{ fontSize: 36, fontWeight: 500, color: '#fff', marginBottom: 48, lineHeight: 1.25 }}>Listo en tres pasos</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 24 }}>
            {[
              { n: '01', title: 'Conecta tu cuenta', desc: 'Inicia sesión con Google y autoriza acceso a tu calendario en un solo clic.' },
              { n: '02', title: 'Elige tus deportes', desc: 'Selecciona las ligas, equipos y deportistas que quieres seguir.' },
              { n: '03', title: 'Disfruta', desc: 'Todos los partidos aparecen en tu calendario y se actualizan solos para siempre.' },
            ].map((s, i) => (
              <div key={i} style={{ borderLeft: '2px solid #10B1C7', paddingLeft: 20 }}>
                <div style={{ fontSize: 36, fontWeight: 500, color: '#10B1C7', lineHeight: 1, marginBottom: 12 }}>{s.n}</div>
                <h3 style={{ fontSize: 15, fontWeight: 500, color: '#fff', marginBottom: 8 }}>{s.title}</h3>
                <p style={{ fontSize: 13, color: '#8899AA', lineHeight: 1.65 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CTA */}
      <div style={{ background: '#263140', padding: '80px 28px', textAlign: 'center' }}>
        <h2 style={{ fontSize: 40, fontWeight: 500, color: '#fff', marginBottom: 16, lineHeight: 1.2 }}>Empieza a seguir<br />tu deporte hoy</h2>
        <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.7)', marginBottom: 40 }}>Gratis. Sin tarjeta de crédito. Solo tu cuenta de Google.</p>
        <button onClick={handleLogin} style={{ display: 'inline-flex', alignItems: 'center', gap: 12, background: '#F18006', color: '#fff', fontSize: 15, fontWeight: 500, padding: '15px 32px', borderRadius: 50, border: 'none', cursor: 'pointer' }}>
          <GoogleIcon />
          Continuar con Google
        </button>
      </div>

      {/* Footer */}
      <div style={{ background: '#1C2430', padding: '24px 28px', textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: '#8899AA' }}>FanSchedule</span>
        <span style={{ fontSize: 13, color: '#8899AA' }}>·</span>
        <Link to="/privacy" style={{ fontSize: 13, color: '#8899AA', textDecoration: 'none' }}>
          Política de privacidad
        </Link>
      </div>

      <style>{`
        @keyframes ticker {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
      `}</style>
    </div>
  )
}
