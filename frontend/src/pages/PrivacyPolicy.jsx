import { Link } from 'react-router-dom'

export default function PrivacyPolicy() {
  return (
    <div style={{ minHeight: '100vh', background: '#faf9f7', color: '#1C2430', fontFamily: 'system-ui, sans-serif' }}>

      {/* Nav */}
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 28px', background: '#1C2430' }}>
        <Link to="/" style={{ textDecoration: 'none' }}>
          <img src="/fanschedule-logo.png" alt="FanSchedule" style={{ height: 60, objectFit: 'contain' }} />
        </Link>
        <Link to="/" style={{ color: '#fff', fontSize: 14, textDecoration: 'none' }}>
          ← Volver al inicio
        </Link>
      </nav>

      {/* Content */}
      <main style={{ maxWidth: 760, margin: '0 auto', padding: '48px 28px 80px', lineHeight: 1.7 }}>
        <h1 style={{ fontSize: 36, fontWeight: 500, marginBottom: 8 }}>Política de privacidad</h1>
        <p style={{ fontSize: 14, color: '#6B7280', marginBottom: 40 }}>Última actualización: 17 de mayo de 2026</p>

        <p style={{ fontSize: 16, marginBottom: 32 }}>
          En FanSchedule respetamos tu privacidad. Esta página explica qué información recopilamos,
          cómo la usamos y qué control tienes sobre ella.
        </p>

        <Section title="1. Qué datos recopilamos">
          <ul style={ulStyle}>
            <li><strong>Nombre y email</strong> de tu cuenta de Google, obtenidos vía OAuth cuando inicias sesión.</li>
            <li><strong>Ligas y equipos favoritos</strong> que seleccionas dentro de la app.</li>
            <li><strong>Consentimiento de email marketing</strong>: si aceptaste recibir novedades o comunicaciones de partners.</li>
            <li><strong>Eventos sincronizados</strong> a tu Google Calendar (identificadores y metadatos de los partidos que añadimos).</li>
          </ul>
        </Section>

        <Section title="2. Cómo usamos los datos">
          <ul style={ulStyle}>
            <li>Para <strong>sincronizar los partidos</strong> de tus ligas y equipos en tu Google Calendar.</li>
            <li>Para <strong>enviarte novedades del producto</strong> y comunicaciones de partners, únicamente si diste tu consentimiento.</li>
            <li>Para mostrarte <strong>información relevante de deportes</strong> (próximos partidos, eventos cercanos, planificador de viajes).</li>
          </ul>
        </Section>

        <Section title="3. Con quién compartimos datos">
          <ul style={ulStyle}>
            <li><strong>Google (Calendar API)</strong>: para crear y actualizar los eventos en tu calendario.</li>
            <li><strong>TheSportsDB</strong>: como fuente de datos de partidos, equipos y ligas.</li>
            <li><strong>Ticketmaster</strong>: para mostrar boletos y disponibilidad de eventos.</li>
          </ul>
          <p style={{ marginTop: 16 }}>
            <strong>No vendemos tus datos a terceros.</strong> Solo compartimos lo estrictamente necesario
            con los servicios anteriores para que FanSchedule funcione.
          </p>
        </Section>

        <Section title="4. Cómo eliminamos tus datos">
          <p>
            Puedes cerrar sesión en cualquier momento desde la app. Si quieres eliminar por completo
            tu cuenta y todos los datos asociados, escríbenos a{' '}
            <a href="mailto:lopezesmenjaud@gmail.com" style={linkStyle}>lopezesmenjaud@gmail.com</a>{' '}
            y procesaremos tu solicitud.
          </p>
        </Section>

        <Section title="5. Cookies y almacenamiento">
          <p>
            Usamos <code style={codeStyle}>localStorage</code> del navegador para mantener tu sesión
            iniciada y recordar tus preferencias (deportes, equipos, consentimiento de email). No usamos
            cookies de rastreo publicitario.
          </p>
        </Section>

        <Section title="6. Contacto">
          <p>
            Si tienes dudas sobre esta política o quieres ejercer tus derechos sobre tus datos,
            escríbenos a <a href="mailto:lopezesmenjaud@gmail.com" style={linkStyle}>lopezesmenjaud@gmail.com</a>.
          </p>
        </Section>
      </main>

      {/* Footer */}
      <footer style={{ background: '#1C2430', padding: '24px 28px', textAlign: 'center' }}>
        <span style={{ fontSize: 13, color: '#8899AA' }}>FanSchedule</span>
      </footer>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 36 }}>
      <h2 style={{ fontSize: 22, fontWeight: 500, marginBottom: 16 }}>{title}</h2>
      <div style={{ fontSize: 16 }}>{children}</div>
    </section>
  )
}

const ulStyle = { paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }
const linkStyle = { color: '#F18006', textDecoration: 'underline' }
const codeStyle = { background: 'rgba(28,36,48,0.08)', padding: '2px 6px', borderRadius: 4, fontSize: 14 }
