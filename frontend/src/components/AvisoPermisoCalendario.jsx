// Aviso que prepara a la persona para la pantalla de permisos de Google.
//
// UN SOLO CUERPO, usado en los cuatro lugares donde alguien puede acabar frente a esa pantalla:
// el modal del gate, el banner del dashboard, el sidebar y el landing. Dos redacciones del mismo
// mensaje se separan con el tiempo; por eso el texto vive aquí y en ningún otro lado.
//
// El problema que resuelve: Google dice "ver y eliminar todos tus calendarios", que suena a que
// vamos a borrarle cosas. Quien no está preparado despaloma la casilla, y sin ella no podemos
// agendar nada — y la app no se lo dice. De 9 usuarios, 3 no dieron el permiso.
//
// props:
//   lineaDeEntrada — opcional. Solo se usa al interceptar a alguien que acaba de suscribirse,
//                    para conectar el aviso con lo que la persona acaba de intentar hacer.
//   discreto       — presentación para el landing: gris, chico, sin ícono ni caja de color. Ahí
//                    es información útil de antemano, no una advertencia; si asusta más que la
//                    propia pantalla de Google, es contraproducente.
export default function AvisoPermisoCalendario({ lineaDeEntrada, discreto = false }) {
  const parrafos = [
    'Google te va a mostrar un aviso que suena fuerte — habla de ver y eliminar todos tus calendarios. En realidad creamos un calendario nuevo, "FanSchedule", y solo escribimos ahí. Los tuyos ni los leemos.',
    'Cuando aparezca, deja palomeada la casilla del calendario — sin ella no podemos agendarte nada. Y puedes quitarnos el permiso cuando quieras desde tu cuenta de Google.',
  ]

  if (discreto) {
    return (
      <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6, maxWidth: 460, margin: '14px auto 0', textAlign: 'center' }}>
        {parrafos.join(' ')}
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
