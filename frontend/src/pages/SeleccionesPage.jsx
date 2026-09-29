import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import SeleccionesPicker from '../components/SeleccionesPicker'
import CalendarConnectModal from '../components/CalendarConnectModal'
import { getUserId } from '../auth'
import { obtenerEstadoGoogle, debeAvisarDePermiso, marcarAvisoDePermisoVisto, invalidarEstadoGoogle } from '../googleStatus'
import { API_BASE } from '../config'

// Pantalla "Fútbol de selecciones" (/dashboard/futbol/selecciones). Se llega desde su renglón en el
// picker de fútbol, con el mismo patrón que "Ver equipos →" de una liga (TeamPicker): su propia
// ruta, "← Volver" arriba y la migaja. Toda la lógica vive en SeleccionesPicker, sin cambios: esta
// pantalla solo le pone la puerta y el aviso de permiso de Google.
export default function SeleccionesPage() {
  const navigate = useNavigate()
  const userId = getUserId()
  const [mostrarAviso, setMostrarAviso] = useState(false)

  // Mismo criterio que el picker: se ESPERA el estado de Google en vez de leer una foto que
  // mientras carga es undefined (y diría "no avisar").
  const alSuscribirse = async () => {
    if (debeAvisarDePermiso(await obtenerEstadoGoogle())) setMostrarAviso(true)
  }
  const cerrarAviso = () => { marcarAvisoDePermisoVisto(); setMostrarAviso(false) }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>

      <Sidebar activePath="/dashboard" />

      <div style={{ flex: 1, background: '#faf9f7', padding: '32px 28px', overflowY: 'auto' }}>

        <button onClick={() => navigate('/dashboard/futbol')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#666666', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 24, padding: 0 }}>
          ← Volver a Fútbol
        </button>

        <div style={{ fontSize: 13, color: '#666666', marginBottom: 20 }}>
          Mis favoritos → ⚽ Fútbol → <strong style={{ color: '#1C2430' }}>Fútbol de selecciones</strong>
        </div>

        <SeleccionesPicker userId={userId} onSuscrito={alSuscribirse} />
      </div>

      {/* Igual que en LeaguePicker: onConnect NO marca el aviso como visto, para no callarnos con
          quien despaloma la casilla en Google y vuelve sin permiso. */}
      {mostrarAviso && (
        <CalendarConnectModal
          lineaDeEntrada="Para agendarte los partidos que sigues necesitamos permiso de tu Google Calendar."
          onConnect={() => { invalidarEstadoGoogle(); window.location.href = `${API_BASE}/auth/google` }}
          onExplore={cerrarAviso}
          etiquetaSecundaria="Ahora no"
        />
      )}
    </div>
  )
}
