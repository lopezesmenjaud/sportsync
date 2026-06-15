import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE } from '../config'
import { getUser, getUserId, clearUser } from '../auth'

const NAV_ITEMS = [
  { label: 'Mis favoritos',     path: '/dashboard' },
  { label: 'Próximos partidos', path: '/upcoming'  },
  { label: 'Cerca de mí',       path: '/nearby'    },
  { label: 'Planear viaje',     path: '/travel'    },
  { label: 'Mi perfil',         path: '/profile'   },
]

// Símbolo calendar-F (mismo que favicon.svg y los íconos PWA)
function LogoMark({ size = 32 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      xmlns="http://www.w3.org/2000/svg"
      style={{ borderRadius: Math.round(size * 0.22), flexShrink: 0, display: 'block' }}
    >
      <rect width="120" height="120" fill="#1C2430" />
      <rect x="42" y="28" width="8" height="14" rx="3" fill="#F18006" />
      <rect x="70" y="28" width="8" height="14" rx="3" fill="#F18006" />
      <rect x="26" y="38" width="68" height="60" rx="10" fill="#F18006" />
      <path d="M46,50 H78 V60 H56 V65 H72 V74 H56 V88 H46 Z" fill="#1C2430" />
    </svg>
  )
}

function BrandLogo({ symbolSize = 32, fontSize = 20 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <LogoMark size={symbolSize} />
      <span style={{ fontSize, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1 }}>
        <span style={{ color: '#F18006' }}>Fan</span><span style={{ color: '#fff' }}>Schedule</span>
      </span>
    </div>
  )
}

export default function Sidebar({ activePath }) {
  const navigate = useNavigate()
  const [google, setGoogle] = useState({ connected: false, email: null, needsReauth: false })
  const [drawerOpen, setDrawerOpen] = useState(false)
  const userId = getUserId()
  const user = getUser()

  useEffect(() => {
    fetch(`${API_BASE}/auth/google/status/${userId}`)
      .then(res => res.json())
      .then(data => { if (data.ok) setGoogle({ connected: data.connected, email: data.email, needsReauth: data.needsReauth }) })
      .catch(() => {})
  }, [])

  const handleNav = (path) => {
    navigate(path)
    setDrawerOpen(false)
  }

  const sidebarContent = (
    <>
      {/* Logo */}
      <div style={{ paddingTop: 20, paddingBottom: 20, paddingLeft: 8, marginBottom: 24 }}>
        <BrandLogo symbolSize={32} fontSize={20} />
      </div>

      {/* Nav items */}
      {NAV_ITEMS.map((item) => {
        const isActive = activePath === item.path
        return (
          <div
            key={item.label}
            onClick={() => handleNav(item.path)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '9px 12px',
              borderRadius: 10,
              fontSize: 13,
              color: isActive ? '#fff' : 'rgba(255,255,255,0.5)',
              background: isActive ? '#F18006' : 'transparent',
              cursor: 'pointer',
              fontWeight: isActive ? 500 : 400,
              transition: 'background 0.2s, color 0.2s'
            }}
            onMouseEnter={e => {
              if (!isActive) e.currentTarget.style.color = 'rgba(255,255,255,0.85)'
            }}
            onMouseLeave={e => {
              if (!isActive) e.currentTarget.style.color = 'rgba(255,255,255,0.5)'
            }}
          >
            <div style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'currentColor',
              flexShrink: 0
            }} />
            {item.label}
          </div>
        )
      })}

      {/* Usuario y cuenta */}
      <div style={{ marginTop: 'auto', padding: '0 4px', borderTop: '1px solid rgba(255,255,255,0.15)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 8px 6px' }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'rgba(255,255,255,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 500, color: '#fff', flexShrink: 0
          }}>
            {(user?.name || user?.email || '?')[0].toUpperCase()}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            {user?.name && (
              <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.9)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.name}
              </div>
            )}
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.email || 'Sin cuenta'}
            </div>
          </div>
        </div>

        {google.needsReauth && (
          <div style={{
            background: '#FEF3E2', border: '1px solid #F18006', borderRadius: 8,
            padding: '8px 10px', margin: '4px 0 8px',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11, color: '#7c2d12', fontWeight: 500, lineHeight: 1.3 }}>
              <span style={{ flexShrink: 0 }}>⚠️</span>
              <span>Tu conexión con Google expiró</span>
            </div>
            <button
              onClick={() => { window.location.href = `${API_BASE}/auth/google` }}
              style={{
                width: '100%', marginTop: 6, padding: '5px 10px', borderRadius: 6,
                border: 'none', background: '#F18006', color: '#fff',
                fontSize: 11, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Reconectar
            </button>
          </div>
        )}

        {google.connected && !google.needsReauth ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px 8px', fontSize: 10, color: 'rgba(74,222,128,0.9)' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#4ade80', flexShrink: 0 }} />
            Google Calendar conectado
          </div>
        ) : google.connected && google.needsReauth ? null : (
          <button
            onClick={() => { window.location.href = `${API_BASE}/auth/google` }}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '8px 12px', margin: '2px 0 8px', borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.2)', background: 'transparent',
              color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: 500, cursor: 'pointer',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#fff' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.7)' }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            Conectar Calendar
          </button>
        )}

        <button
          onClick={() => { clearUser(); window.location.href = '/' }}
          style={{
            width: '100%', background: 'none', border: 'none',
            color: 'rgba(255,255,255,0.4)', fontSize: 11, cursor: 'pointer',
            padding: '6px 8px 10px', textAlign: 'left',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#fca5a5' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)' }}
        >
          Cerrar sesión
        </button>
      </div>
    </>
  )

  return (
    <>
      <style>{`
        @media (max-width: 768px) {
          .sidebar-desktop { display: none !important; }
          .sidebar-topbar { display: flex !important; }
          .sidebar-drawer { display: flex !important; }
          .sidebar-overlay { display: block !important; }
        }
        @media (min-width: 769px) {
          .sidebar-desktop { display: flex !important; }
          .sidebar-topbar { display: none !important; }
          .sidebar-drawer { display: none !important; }
          .sidebar-overlay { display: none !important; }
        }
      `}</style>

      {/* Desktop sidebar */}
      <div className="sidebar-desktop" style={{
        width: 220,
        background: '#263140',
        padding: '20px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        flexShrink: 0,
        minHeight: '100vh'
      }}>
        {sidebarContent}
      </div>

      {/* Mobile topbar */}
      <div className="sidebar-topbar" style={{
        display: 'none',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 56,
        background: '#263140',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        zIndex: 1000,
      }}>
        <button
          onClick={() => setDrawerOpen(!drawerOpen)}
          style={{ background: 'none', border: 'none', color: '#fff', fontSize: 24, cursor: 'pointer', padding: '4px 8px', lineHeight: 1 }}
        >
          {drawerOpen ? '✕' : '☰'}
        </button>
        <BrandLogo symbolSize={28} fontSize={17} />
        <div style={{ width: 40 }} />
      </div>

      {/* Mobile overlay */}
      {drawerOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setDrawerOpen(false)}
          style={{
            display: 'none',
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 1001,
          }}
        />
      )}

      {/* Mobile drawer */}
      <div className="sidebar-drawer" style={{
        display: 'none',
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width: 260,
        background: '#263140',
        padding: '20px 16px',
        flexDirection: 'column',
        gap: 4,
        zIndex: 1002,
        transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.3s ease',
        overflowY: 'auto',
      }}>
        {sidebarContent}
      </div>
    </>
  )
}
