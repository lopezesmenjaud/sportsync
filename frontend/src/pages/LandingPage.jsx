import { useEffect, useState } from 'react'
import { API_BASE } from '../config'
import { consumirSesionExpirada } from '../api'
import { invalidarEstadoGoogle } from '../googleStatus'
import AvisoPermisoCalendario from '../components/AvisoPermisoCalendario'
import CalendarConnectModal from '../components/CalendarConnectModal'
import { useAnuncios } from '../ads'

// Las tarjetas y la cinta muestran partidos REALES, que el navegador pide a
// /api/portada/partidos (src/routes/portada.js en el backend). Antes eran textos escritos a mano
// con "Hoy" y "En vivo", que dejaban de ser ciertos al día siguiente.
//
// El HTML que se genera al compilar (scripts/generarPortada.mjs) es esta página SIN datos: no
// lleva ni una tarjeta. Así nada del HTML puede quedarse anunciando un partido que ya se jugó.
//
// Fechas SIEMPRE completas y en hora del centro de México, la misma zona que usan las páginas
// /partido/. Nada de "Hoy", "Mañana" ni "En 2 horas".
const ZONA = 'America/Mexico_City'
const FECHA_LARGA = new Intl.DateTimeFormat('es-MX', { timeZone: ZONA, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const HORA_LARGA = new Intl.DateTimeFormat('es-MX', { timeZone: ZONA, hour: 'numeric', minute: '2-digit', hour12: true })
const FECHA_CORTA = new Intl.DateTimeFormat('es-MX', { timeZone: ZONA, day: 'numeric', month: 'short', year: 'numeric' })
const HORA_CORTA = new Intl.DateTimeFormat('es-MX', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

const fechaDeTarjeta = (iso) => `${FECHA_LARGA.format(new Date(iso))} · ${HORA_LARGA.format(new Date(iso))}`
const fechaDeCinta = (iso) => `${FECHA_CORTA.format(new Date(iso))} · ${HORA_CORTA.format(new Date(iso))}`

// Lo que ya empezó se descarta en el navegador, con su propio reloj: la respuesta del backend
// puede tener unos minutos de caché.
const yaEmpezo = (p, ahora) => !(Date.parse(p.inicioUtc) > ahora)

const COLORES_DE_TARJETA = ['#06D6A0', '#FF5C00', '#c084fc', '#10B1C7']

const FEATURES = [
  { num: '01', title: 'Sincronización automática', desc: 'Tus partidos en Google Calendar sin hacer nada. Si el horario cambia, tu calendario se actualiza solo.' },
  { num: '02', title: 'La página del partido', desc: 'Cada evento de tu calendario trae el link a la página del partido. Ahí está su información: dónde verlo, un resumen y la búsqueda de boletos.' },
  { num: '03', title: 'Busca boletos', desc: 'En cada partido te dejamos lista la búsqueda en Ticketmaster y StubHub para que encuentres entradas.' },
  { num: '04', title: 'Eventos cerca de ti', desc: 'Comparte tu ubicación o escribe tu ciudad y descubre qué partidos de las ligas de tu país se juegan cerca en los próximos 30 días.' },
  { num: '05', title: 'Planea tu viaje', desc: '¿Viajando? Ingresa fechas y destino para ver qué partidos de las ligas de ese país se juegan durante tu estancia, dentro de los próximos 30 días.' },
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
  // El landing es contenido de publicador puro: explica el producto, no depende de ninguna
  // petición y nunca está vacío. Califica desde el primer render.
  useAnuncios(true)

  // null = todavía no llegan (o no llegaron). Mientras tanto la página se pinta igual que el HTML
  // generado: sin tarjetas y sin cinta. Si el backend no responde, se queda así.
  const [partidos, setPartidos] = useState(null)
  const [ahora, setAhora] = useState(() => Date.now())

  useEffect(() => {
    let vigente = true
    // fetch pelón y no apiFetch: son datos públicos, no hay por qué mandar el token de sesión.
    fetch(`${API_BASE}/api/portada/partidos`)
      .then((res) => (res.ok ? res.json() : null))
      .then((datos) => {
        if (!vigente || !datos) return
        setPartidos({ tarjetas: Array.isArray(datos.tarjetas) ? datos.tarjetas : [], cinta: Array.isArray(datos.cinta) ? datos.cinta : [] })
        setAhora(Date.now())
      })
      .catch(() => { /* sin partidos: la sección no se muestra */ })
    // Cada minuto se vuelve a mirar el reloj, para que quien deja la pestaña abierta no siga
    // viendo un partido que ya empezó.
    const reloj = setInterval(() => setAhora(Date.now()), 60 * 1000)
    return () => { vigente = false; clearInterval(reloj) }
  }, [])

  const tarjetas = (partidos?.tarjetas || []).filter((p) => !yaEmpezo(p, ahora))
  const cinta = (partidos?.cinta || []).filter((p) => !yaEmpezo(p, ahora))

  // Si llegamos aquí porque la sesión se venció, hay que decirlo. Sin esto la persona aterriza en
  // el landing sin explicación y parece que la app la desconectó sola. Se lee una sola vez.
  const [sesionExpirada] = useState(() => consumirSesionExpirada())

  // Aquí la persona NO ha iniciado sesión, así que el modal lleva etiquetas propias: hablarle de
  // "conecta tu calendario" antes de entrar suena a otra cosa distinta de la que acaba de picar.
  const [mostrarAviso, setMostrarAviso] = useState(false)

  const handleLogin = () => {
    invalidarEstadoGoogle()
    window.location.href = `${API_BASE}/auth/google`
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', color: '#fff' }}>

      {sesionExpirada && (
        <div style={{ background: '#F18006', color: '#fff', padding: '12px 28px', fontSize: 14, textAlign: 'center' }}>
          Tu sesión expiró. Vuelve a conectar tu cuenta de Google para seguir donde ibas.
        </div>
      )}

      {/* Nav */}
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 28px', background: '#1C2430' }}>
        <img src="/fanschedule-logo.png" alt="FanSchedule" className="landing-logo" style={{ objectFit: 'contain' }} />
        {/* Abre el modal en vez de navegar. En teléfono este es el ÚNICO botón visible sin
            scroll: el h1 de 52px empuja el hero y su aviso abajo del doblez, así que quien pica
            aquí llegaría a la pantalla de Google sin haber leído nada. */}
        <button onClick={() => setMostrarAviso(true)} style={{ background: '#F18006', color: '#fff', border: 'none', borderRadius: 24, padding: '10px 24px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
          Empezar gratis
        </button>
      </nav>

      {/* Hero */}
      <div className="landing-hero" style={{ background: '#1C2430', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -100, left: '50%', transform: 'translateX(-50%)', width: 600, height: 400, background: 'radial-gradient(ellipse, rgba(16,177,199,0.25) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div className="landing-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(16,177,199,0.15)', border: '1px solid rgba(16,177,199,0.35)', color: '#10B1C7', fontSize: 12, fontWeight: 500, padding: '6px 16px', borderRadius: 24 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10B1C7' }} />
          Tu calendario deportivo, hecho para fans.
        </div>
        <h1 className="landing-h1" style={{ fontWeight: 500, color: '#fff', lineHeight: 1.1, maxWidth: 680, marginLeft: 'auto', marginRight: 'auto' }}>
          Nunca te pierdas<br />los partidos que <span style={{ color: '#F18006' }}>te importan</span>
        </h1>
        <p className="landing-sub" style={{ color: '#8899AA', maxWidth: 460, lineHeight: 1.7 }}>
          Una agenda deportiva armada alrededor de lo que sigues. Conecta tu Google Calendar y cada partido se agenda solo.
        </p>
        <button onClick={handleLogin} style={{ display: 'inline-flex', alignItems: 'center', gap: 12, background: '#F18006', color: '#fff', fontSize: 15, fontWeight: 500, padding: '15px 32px', borderRadius: 50, border: 'none', cursor: 'pointer' }}>
          <GoogleIcon />
          Continuar con Google — es gratis
        </button>
        {/* Prepara para la pantalla de permisos ANTES de mandar a Google. Discreto a propósito:
            si asusta más que el propio aviso de Google, es contraproducente. */}
        <AvisoPermisoCalendario discreto />
      </div>

      {/* Cinta. Solo existe si hay partidos que anunciar. Va dos veces seguida para que el
          desplazamiento dé la vuelta sin salto; la segunda copia es solo decorado y se le oculta
          al lector de pantalla, que si no leería cada partido dos veces. */}
      {cinta.length > 0 && (
        <div style={{ background: '#142238', padding: '14px 0', overflow: 'hidden', whiteSpace: 'nowrap' }}>
          <div style={{ display: 'inline-flex', animation: `ticker ${Math.max(20, cinta.length * 5)}s linear infinite` }}>
            {[false, true].map((copia) => (
              <div key={String(copia)} aria-hidden={copia || undefined} style={{ display: 'inline-flex', gap: 48, paddingRight: 48 }}>
                {cinta.map((p) => (
                  <span key={p.id} style={{ fontSize: 13, fontWeight: 500, color: '#fff', flexShrink: 0 }}>{p.nombre} · {fechaDeCinta(p.inicioUtc)}</span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Próximos partidos. Cada tarjeta enlaza a su página /partido/, que sirve el backend: por
          eso <a> y no <Link>. El enlace a /equipos va SIEMPRE, haya partidos o no: es parte del
          HTML generado. */}
      <div style={{ background: '#0F1A2E', padding: '48px 28px' }}>
        {tarjetas.length > 0 && (
          <>
            <div style={{ fontSize: 12, color: '#8899AA', textAlign: 'center', marginBottom: 16 }}>Próximos partidos · Horarios del centro de México</div>
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
              {tarjetas.map((p, i) => (
                <a key={p.id} href={p.url} style={{ display: 'block', textDecoration: 'none', background: '#142238', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '18px 20px', minWidth: 200, flex: 1, maxWidth: 220 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 10, color: COLORES_DE_TARJETA[i % COLORES_DE_TARJETA.length] }}>{p.competencia}</div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: '#fff', marginBottom: 8, lineHeight: 1.4 }}>{p.nombre}</div>
                  <div style={{ fontSize: 12, color: '#8899AA', lineHeight: 1.5 }}>{fechaDeTarjeta(p.inicioUtc)}</div>
                </a>
              ))}
            </div>
          </>
        )}
        <p style={{ fontSize: 14, color: '#8899AA', textAlign: 'center', marginTop: tarjetas.length > 0 ? 24 : 0 }}>
          Horarios de cada equipo → <a href="/equipos" style={{ color: '#10B1C7', fontWeight: 500, textDecoration: 'none' }}>Ver todos los equipos</a>
        </p>
      </div>

      {/* Features */}
      {/* Mismo patrón que "Cómo funciona": el color va en la caja exterior a todo lo ancho, y el
          maxWidth en la de adentro. Con los dos en la misma caja, el color se quedaba en 960 px y
          en pantallas anchas salían franjas a los lados. */}
      <div style={{ background: '#0F1A2E', padding: '80px 28px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
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
        <AvisoPermisoCalendario discreto />
      </div>

      {/* Footer */}
      <div style={{ background: '#1C2430', padding: '24px 28px', textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: '#8899AA' }}>FanSchedule</span>
        <span style={{ fontSize: 13, color: '#8899AA' }}>·</span>
        {/* <a> y no <Link>: estas páginas las sirve el backend, no la app. Con <Link> React Router
            las buscaría entre sus rutas y no las encontraría. */}
        <a href="/equipos" style={{ fontSize: 13, color: '#8899AA', textDecoration: 'none' }}>
          Equipos
        </a>
        <span style={{ fontSize: 13, color: '#8899AA' }}>·</span>
        <a href="/acerca" style={{ fontSize: 13, color: '#8899AA', textDecoration: 'none' }}>
          Acerca de
        </a>
        <span style={{ fontSize: 13, color: '#8899AA' }}>·</span>
        <a href="/contacto" style={{ fontSize: 13, color: '#8899AA', textDecoration: 'none' }}>
          Contacto
        </a>
        <span style={{ fontSize: 13, color: '#8899AA' }}>·</span>
        <a href="/privacy" style={{ fontSize: 13, color: '#8899AA', textDecoration: 'none' }}>
          Política de privacidad
        </a>
        <span style={{ fontSize: 13, color: '#8899AA' }}>·</span>
        <a href="/terms" style={{ fontSize: 13, color: '#8899AA', textDecoration: 'none' }}>
          Términos del Servicio
        </a>
      </div>

      <style>{`
        @keyframes ticker {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }

        /* Tamaños del hero. Estaban en línea con valores fijos, y el h1 de 52px empujaba el
           botón principal —el llamado a la acción— fuera del doblez en teléfono.
           Media query y no clamp: es el patrón que ya usa el proyecto (index.css, App.css,
           Sidebar.jsx). El corte en 768px es el mismo que usa index.css. */
        .landing-logo  { height: 80px; }
        .landing-hero  { padding: 72px 28px 80px; }
        .landing-badge { margin-bottom: 28px; }
        .landing-h1    { font-size: 52px; margin-bottom: 24px; }
        .landing-sub   { font-size: 17px; margin: 0 auto 44px; }

        @media (max-width: 768px) {
          .landing-logo  { height: 56px; }
          .landing-hero  { padding: 40px 20px 48px; }
          .landing-badge { margin-bottom: 16px; }
          .landing-h1    { font-size: 30px; margin-bottom: 16px; }
          .landing-sub   { font-size: 15px; margin: 0 auto 28px; }
        }
      `}</style>

      {mostrarAviso && (
        <CalendarConnectModal
          onConnect={handleLogin}
          onExplore={() => setMostrarAviso(false)}
          titulo="Antes de continuar con Google"
          etiquetaPrincipal="Continuar con Google — es gratis"
          etiquetaSecundaria="Ahora no"
        />
      )}
    </div>
  )
}
