// Aviso que prepara a la persona para la pantalla de permisos de Google.
//
// UN SOLO CUERPO. Dos redacciones del mismo mensaje se separan con el tiempo; por eso el texto
// vive aquí y en ningún otro lado.
//
// Se renderiza en 3 sitios: LandingPage lo pinta dos veces en modo `discreto`, y
// CalendarConnectModal una vez en modo completo. El banner del dashboard y el sidebar NO lo
// renderizan — sus botones abren el modal, y el modal es quien lo pinta. En total son 7 los
// puntos de entrada que abren ese modal: el gate de App, el banner del dashboard, el sidebar,
// el perfil, LeaguePicker, TeamPicker y el landing.
//
// El problema que resuelve: la casilla del calendario en la pantalla de Google viene
// DESMARCADA. Quien no lo sabe le da a "Continuar" sin tocarla y vuelve sin permiso, sin
// enterarse de que falta algo. De 15 usuarios, 4 se quedaron así.
//
// El texto anterior fallaba por dos lados: describía el aviso de "ver y eliminar todos tus
// calendarios", que ya no aparece desde que pedimos calendar.app.created, y decía "deja
// palomeada la casilla" — la instrucción exactamente al revés de lo que hay que hacer.
//
// props:
//   lineaDeEntrada — opcional. Solo se usa al interceptar a alguien que acaba de suscribirse,
//                    para conectar el aviso con lo que la persona acaba de intentar hacer.
//   discreto       — presentación para el landing: gris, chico, sin ícono ni caja de color. Ahí
//                    es información útil de antemano, no una advertencia; si asusta más que la
//                    propia pantalla de Google, es contraproducente.
export default function AvisoPermisoCalendario({ lineaDeEntrada, discreto = false }) {
  // El resaltado necesita color propio por variante: el landing va sobre fondo oscuro y el modal
  // sobre blanco. Con un solo color, en una de las dos el énfasis no se ve.
  const fuerte = { fontWeight: 600, color: discreto ? '#ffffff' : '#1C2430' }

  // JSX, no strings: "Marca la casilla" lleva énfasis. Por eso el modo discreto ya no puede
  // usar join(' ') — sobre JSX eso renderiza [object Object].
  const parrafos = [
    <>Google te va a pedir permiso para tu calendario. <strong style={fuerte}>Marca la casilla</strong> — viene desmarcada, y sin ella no podemos agendarte nada.</>,
    <>Creamos un calendario nuevo, "FanSchedule", y solo escribimos ahí. Ni siquiera pedimos permiso para ver los tuyos. Y puedes quitarnos el permiso cuando quieras desde tu cuenta de Google.</>,
  ]

  if (discreto) {
    return (
      <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6, maxWidth: 460, margin: '14px auto 0', textAlign: 'center' }}>
        {parrafos.map((texto, i) => (
          <span key={i}>{i > 0 && ' '}{texto}</span>
        ))}
      </p>
    )
  }

  return (
    <div style={{ textAlign: 'left' }}>
      {lineaDeEntrada && (
        <p style={{ fontSize: 14, fontWeight: 500, color: '#1C2430', lineHeight: 1.5, marginBottom: 12 }}>
          {lineaDeEntrada}
        </p>
      )}
      {parrafos.map((texto, i) => (
        <p key={i} style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.6, marginBottom: i === parrafos.length - 1 ? 0 : 10 }}>
          {texto}
        </p>
      ))}
    </div>
  )
}
