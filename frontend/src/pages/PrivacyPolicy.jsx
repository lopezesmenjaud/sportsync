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
        <p style={{ fontSize: 14, color: '#6B7280', marginBottom: 40 }}>Última actualización: 27 de mayo de 2026</p>

        <p style={{ fontSize: 16, marginBottom: 32 }}>
          En FanSchedule respetamos tu privacidad. Esta página explica qué información recopilamos,
          cómo la usamos y qué control tienes sobre ella.
        </p>

        <Section title="1. Qué datos recopilamos">
          <ul style={ulStyle}>
            <li><strong>Nombre y correo</strong> de tu cuenta de Google, obtenidos vía OAuth cuando inicias sesión.</li>
            <li><strong>Ligas y equipos favoritos</strong> que seleccionas dentro de la app.</li>
            <li><strong>Consentimiento de email marketing</strong>: si aceptaste recibir novedades del producto o comunicaciones de partners.</li>
            <li><strong>Eventos sincronizados</strong> a tu Google Calendar: identificadores y metadatos de los partidos que añadimos.</li>
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
          <p style={{ marginBottom: 16 }}>
            Para que FanSchedule funcione, enviamos cierta información a estos servicios:
          </p>
          <ul style={ulStyle}>
            <li><strong>Google Calendar</strong>: con tu autorización, creamos y actualizamos en tu propio calendario los eventos de los partidos que eliges.</li>
            <li><strong>OpenStreetMap / Nominatim</strong>: en las funciones "Cerca de mí" y "Planear viaje", tu navegador envía tu ubicación (coordenadas) o el nombre de una ciudad a este servicio para determinar a qué ciudad corresponde.</li>
            <li><strong>Anthropic (Claude)</strong>: enviamos datos de los partidos (equipos, estadios) y la ciudad que consultas, para generar la información de "dónde ver", "eventos cercanos" y resúmenes de partidos. No enviamos tu nombre ni tu correo.</li>
            <li><strong>ip-api.com</strong>: cuando abres la app, enviamos tu dirección IP a este servicio para detectar tu país automáticamente. No almacenamos tu IP.</li>
          </ul>
          <p style={{ marginTop: 24, marginBottom: 16 }}>
            También obtenemos información de las siguientes fuentes, a las que no les enviamos tus datos personales — solo consultas sobre partidos y eventos:
          </p>
          <ul style={ulStyle}>
            <li><strong>TheSportsDB</strong>: fuente de datos de partidos, equipos y ligas.</li>
            <li><strong>Ticketmaster</strong>: información de boletos para los partidos.</li>
          </ul>
          <p style={{ marginTop: 24 }}>
            <strong>No vendemos tus datos a terceros.</strong> Solo compartimos lo estrictamente necesario
            con los servicios anteriores para que FanSchedule funcione.
          </p>
        </Section>

        <Section title="4. Datos de Google y Uso Limitado">
          <p style={{ marginBottom: 16 }}>
            El uso y la transferencia que hace FanSchedule de la información recibida de las APIs de Google
            se ajustará a la Política de Datos de Usuario de los Servicios de la API de Google, incluyendo
            los requisitos de Uso Limitado (Limited Use). En concreto, los datos de tu Google Calendar:
          </p>
          <ul style={ulStyle}>
            <li>se usan únicamente para crear y actualizar los eventos de los partidos que tú eliges;</li>
            <li>no se utilizan con fines publicitarios;</li>
            <li>no se venden ni se transfieren a terceros, salvo lo estrictamente necesario para operar la app o cuando la ley lo exija;</li>
            <li>no son leídos por ninguna persona, salvo que tú lo autorices expresamente o sea requerido por ley.</li>
          </ul>
        </Section>

        <Section title="5. Cómo eliminamos tus datos">
          <p>
            Puedes cerrar sesión en cualquier momento desde la app. Si quieres eliminar por completo
            tu cuenta y todos los datos asociados, escríbenos a{' '}
            <a href="mailto:lopezesmenjaud@gmail.com" style={linkStyle}>lopezesmenjaud@gmail.com</a>{' '}
            y procesaremos tu solicitud.
          </p>
        </Section>

        <Section title="6. Cookies y almacenamiento">
          <p>
            Usamos <code style={codeStyle}>localStorage</code> del navegador para mantener tu sesión
            iniciada y recordar tus preferencias (deportes, equipos, consentimiento de email). No usamos
            cookies de rastreo publicitario.
          </p>
        </Section>

        <Section title="7. Menores de edad">
          <p>
            FanSchedule no está dirigido a menores de 13 años y no recopilamos a sabiendas datos de menores de esa edad.
          </p>
        </Section>

        <Section title="8. Cambios a esta política">
          <p>
            Podemos actualizar esta política ocasionalmente. Si hacemos cambios importantes, actualizaremos
            la fecha de "última actualización" en la parte superior de esta página.
          </p>
        </Section>

        <Section title="9. Contacto">
          <p>
            Si tienes dudas sobre esta política o quieres ejercer tus derechos sobre tus datos,
            escríbenos a <a href="mailto:lopezesmenjaud@gmail.com" style={linkStyle}>lopezesmenjaud@gmail.com</a>.
          </p>
        </Section>
      </main>

      {/* Footer */}
      <footer style={{ background: '#1C2430', padding: '24px 28px', textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: '#8899AA' }}>FanSchedule</span>
        <span style={{ fontSize: 13, color: '#8899AA' }}>·</span>
        <Link to="/terms" style={{ fontSize: 13, color: '#8899AA', textDecoration: 'none' }}>
          Términos del Servicio
        </Link>
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
