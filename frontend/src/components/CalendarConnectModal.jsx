import AvisoPermisoCalendario from './AvisoPermisoCalendario'

// El copy vive en AvisoPermisoCalendario, compartido con el landing (que lo pinta aparte, en modo
// discreto). Este modal es el que ve todo lo demás: el gate de App, el banner del dashboard, el
// sidebar, el perfil, LeaguePicker y TeamPicker abren ESTE componente, no el aviso directo.
//
// Lo que el copy tiene que lograr es una sola cosa: que la persona MARQUE la casilla del
// calendario, que Google muestra desmarcada. No nombra ningún aviso alarmante de Google porque
// desde que pedimos calendar.app.created ya no lo hay — la pantalla solo habla de crear
// calendarios secundarios.
//
// lineaDeEntrada: opcional, para el caso de interceptar a alguien que acaba de suscribirse.
// etiquetaSecundaria: "Explorar primero" tiene sentido al entrar a la app; desde un banner, donde
// la persona ya está explorando, se pasa "Ahora no".
// titulo / etiquetaPrincipal: en el landing la persona todavía NO ha iniciado sesión, y hablarle
// de "conecta tu calendario" o "Conectar Google Calendar" suena a otra cosa distinta de la que
// acaba de picar. Ahí se pasan etiquetas propias.
export default function CalendarConnectModal({
  onConnect,
  onExplore,
  lineaDeEntrada,
  titulo = 'Conecta tu calendario',
  etiquetaPrincipal = 'Conectar Google Calendar',
  etiquetaSecundaria = 'Explorar primero',
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 2100 }}>
      <div style={{ background: '#ffffff', borderRadius: 20, padding: '36px 32px', maxWidth: 440, width: '100%', textAlign: 'center' }}>

        <div style={{ fontSize: 32, marginBottom: 16 }}>📅</div>

        <h2 style={{ fontSize: 20, fontWeight: 600, color: '#1C2430', marginBottom: 16 }}>
          {titulo}
        </h2>

        <div style={{ marginBottom: 22 }}>
          <AvisoPermisoCalendario lineaDeEntrada={lineaDeEntrada} />
        </div>

        <button
          onClick={onConnect}
          style={{ width: '100%', background: '#F18006', border: 'none', borderRadius: 12, padding: '15px', fontSize: 15, fontWeight: 600, color: '#fff', cursor: 'pointer', marginBottom: 14 }}
        >
          {etiquetaPrincipal}
        </button>

        <div>
          <button
            onClick={onExplore}
            style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: 13, cursor: 'pointer', textDecoration: 'underline', padding: 4 }}
          >
            {etiquetaSecundaria}
          </button>
        </div>

      </div>
    </div>
  )
}
