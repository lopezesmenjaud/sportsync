// Aviso de error fijo abajo de la pantalla.
//
// Fijo y no en el flujo del contenido porque las listas de ligas y equipos son largas: un banner
// arriba lo ve solo quien está arriba, y quien pica una liga estando abajo no vería nada — la app
// volvería a fallar en silencio, que es justo lo que estamos cerrando.
//
// NO desaparece solo. Un aviso que se va a los cuatro segundos vuelve a ser silencio para quien
// miró a otro lado en ese momento; se cierra con la ✕, a propósito.
//
// Un solo mensaje a la vez: el estado es un string, así que un error nuevo reemplaza al anterior
// en vez de apilarse.
export default function AvisoError({ mensaje, onCerrar }) {
  if (!mensaje) return null

  return (
    <div
      style={{
        position: 'fixed',
        left: 16,
        right: 16,
        // Margen generoso + safe-area: en teléfono no debe quedar debajo de la barra del sistema
        // ni encima de un botón.
        bottom: 'calc(28px + env(safe-area-inset-bottom, 0px))',
        // Por debajo del modal (2100) por si alguna vez coincidieran: gana el modal.
        zIndex: 2000,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none', // el contenedor no bloquea clics fuera del aviso
      }}
    >
      <div
        style={{
          pointerEvents: 'auto',
          maxWidth: 520,
          width: '100%',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: 12,
          padding: '12px 12px 12px 16px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          boxShadow: '0 6px 24px rgba(0,0,0,0.14)',
          fontSize: 13,
          color: '#b91c1c',
          lineHeight: 1.5,
        }}
      >
        <span style={{ flex: 1 }}>{mensaje}</span>
        <button
          onClick={onCerrar}
          aria-label="Cerrar aviso"
          style={{
            flexShrink: 0,
            background: 'none',
            border: 'none',
            color: '#b91c1c',
            fontSize: 15,
            lineHeight: 1,
            cursor: 'pointer',
            padding: '2px 4px',
          }}
        >
          ✕
        </button>
      </div>
    </div>
  )
}
