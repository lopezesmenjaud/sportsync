import { Link } from 'react-router-dom'

export default function TermsOfService() {
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
        <h1 style={{ fontSize: 36, fontWeight: 500, marginBottom: 8 }}>Términos del Servicio</h1>
        <p style={{ fontSize: 14, color: '#6B7280', marginBottom: 40 }}>Última actualización: 17 de julio de 2026</p>

        <p style={{ fontSize: 16, marginBottom: 32 }}>
          Bienvenido a FanSchedule. Estos Términos del Servicio ("Términos") regulan el uso de la
          aplicación y el sitio web fanschedule.com ("el Servicio"). Al usar FanSchedule, aceptas
          estos Términos. Si no estás de acuerdo, por favor no uses el Servicio.
        </p>

        <Section title="1. Qué es FanSchedule">
          <p>
            FanSchedule es una aplicación que te permite seguir tus ligas y equipos favoritos y
            sincronizar automáticamente los partidos en tu Google Calendar. También ofrece funciones
            complementarias como información de dónde ver los partidos, eventos cercanos y planificación
            de viajes.
          </p>
        </Section>

        <Section title="2. Tu cuenta">
          <p>
            Para usar FanSchedule inicias sesión con tu cuenta de Google. Eres responsable de mantener
            la seguridad de tu cuenta de Google y de la actividad que ocurra a través de ella. Debes
            proporcionar información veraz y usar el Servicio conforme a estos Términos.
          </p>
        </Section>

        <Section title="3. Uso aceptable">
          <p>
            Te comprometes a no usar FanSchedule para fines ilegales ni de forma que pueda dañar,
            deshabilitar o sobrecargar el Servicio. En particular, no debes intentar acceder sin
            autorización a nuestros sistemas o a los de terceros, ni usar medios automatizados para
            extraer datos del Servicio, ni interferir con su funcionamiento normal.
          </p>
        </Section>

        <Section title="4. Datos deportivos y de terceros">
          <p>
            La información de partidos, equipos, ligas, boletos y ubicaciones proviene de fuentes de
            terceros (incluyendo TheSportsDB, Ticketmaster, OpenStreetMap y otros). Hacemos un esfuerzo
            razonable para mostrar información precisa y actualizada, pero no garantizamos que los
            horarios, fechas, sedes o cualquier otro dato sean exactos o estén libres de errores.
            Verifica siempre la información oficial antes de tomar decisiones (por ejemplo, comprar
            boletos o planear un viaje).
          </p>
        </Section>

        <Section title="5. Integración con Google Calendar">
          <p>
            Con tu autorización, FanSchedule crea y actualiza eventos en tu Google Calendar. Tú
            controlas esta conexión y puedes revocarla en cualquier momento desde la configuración de
            tu cuenta de Google. El manejo de los datos de Google se rige por nuestra{' '}
            <Link to="/privacy" style={linkStyle}>Política de Privacidad</Link> y por la Política de
            Datos de Usuario de los Servicios de la API de Google.
          </p>
        </Section>

        <Section title="6. Planes gratuitos y de pago">
          <p>
            FanSchedule ofrece y seguirá ofreciendo un plan gratuito. En el futuro podremos introducir
            funciones o planes de pago opcionales ("premium") además del plan gratuito. Cualquier
            función de pago se te cobrará únicamente si la contratas de forma expresa, y te informaremos
            de sus condiciones y precios antes de que la actives. El plan gratuito seguirá disponible
            con independencia de que existan opciones de pago.
          </p>
        </Section>

        <Section title="7. Disponibilidad del Servicio">
          <p>
            Hacemos lo posible por mantener FanSchedule disponible y funcionando, pero el Servicio se
            ofrece "tal cual" y "según disponibilidad". Podemos modificar, suspender o discontinuar el
            Servicio (total o parcialmente) en cualquier momento, sin que ello genere responsabilidad
            hacia ti.
          </p>
        </Section>

        <Section title="8. Limitación de responsabilidad">
          <p>
            En la medida permitida por la ley, FanSchedule no será responsable por daños indirectos,
            incidentales o consecuentes derivados del uso o la imposibilidad de usar el Servicio,
            incluyendo pérdidas ocasionadas por información deportiva inexacta, eventos de calendario
            incorrectos o interrupciones del Servicio. Tu uso de FanSchedule es bajo tu propio riesgo.
          </p>
        </Section>

        <Section title="9. Propiedad intelectual">
          <p>
            FanSchedule, su nombre, logotipo y el software que lo compone son propiedad de sus
            creadores. Los nombres de ligas, equipos y competiciones pertenecen a sus respectivos
            titulares y se usan únicamente con fines informativos.
          </p>
        </Section>

        <Section title="10. Terminación">
          <p>
            Puedes dejar de usar FanSchedule en cualquier momento y solicitar la eliminación de tu
            cuenta conforme a nuestra{' '}
            <Link to="/privacy" style={linkStyle}>Política de Privacidad</Link>. Podemos suspender o
            terminar tu acceso al Servicio si incumples estos Términos.
          </p>
        </Section>

        <Section title="11. Cambios a estos Términos">
          <p>
            Podemos actualizar estos Términos ocasionalmente. Si hacemos cambios importantes,
            actualizaremos la fecha de "última actualización" en la parte superior de esta página. El
            uso continuado del Servicio tras los cambios implica tu aceptación de los mismos.
          </p>
        </Section>

        <Section title="12. Contacto">
          <p>
            Si tienes dudas sobre estos Términos, escríbenos a{' '}
            <a href="mailto:lopezesmenjaud@gmail.com" style={linkStyle}>lopezesmenjaud@gmail.com</a>.
          </p>
        </Section>
      </main>

      {/* Footer */}
      <footer style={{ background: '#1C2430', padding: '24px 28px', textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: '#8899AA' }}>FanSchedule</span>
        <span style={{ fontSize: 13, color: '#8899AA' }}>·</span>
        <Link to="/privacy" style={{ fontSize: 13, color: '#8899AA', textDecoration: 'none' }}>
          Política de privacidad
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

const linkStyle = { color: '#F18006', textDecoration: 'underline' }
