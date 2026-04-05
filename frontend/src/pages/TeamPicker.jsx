import { useState, useEffect } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import TeamSubscriptionModal from '../components/TeamSubscriptionModal'
import { API_BASE } from '../config'
import { getUserId } from '../auth'

export default function TeamPicker() {
  const { sport, leagueId } = useParams()
  const { state }           = useLocation()
  const navigate            = useNavigate()

  const league    = state?.league    || { name: 'Liga', flag: '🏆' }
  const sportInfo = state?.sportInfo || { emoji: '🏆', name: sport }
  const isTennis  = sport === 'tenis'
  const userId = getUserId()

  // ── DIAGNÓSTICO — quitar después de confirmar que funciona ──
  console.log('STATE recibido:', state)
  console.log('LEAGUE:', league)
  console.log('leagueId:', leagueId)

  const [search, setSearch]             = useState('')
  const [selectedTeam, setSelectedTeam] = useState(null)
  const [subscribed, setSubscribed]     = useState([])
  const [saving, setSaving]             = useState(false)
  const [saved, setSaved]               = useState(false)
  const [newlyAdded, setNewlyAdded]     = useState([])
  const [teams, setTeams]               = useState([])
  const [loadingTeams, setLoadingTeams] = useState(true)
  const [teamsError, setTeamsError]     = useState(null)

  // Cargar equipos o jugadores según el deporte
  useEffect(() => {
    setLoadingTeams(true)
    setTeamsError(null)
    const leagueName = encodeURIComponent(league.apiName || league.name || '')
    const endpoint = isTennis ? 'players' : 'teams'
    const url = `${API_BASE}/api/${endpoint}/${leagueId}?leagueName=${leagueName}`
    console.log(`Fetching ${endpoint} from:`, url)
    fetch(url)
      .then(res => res.json())
      .then(data => {
        console.log(`${endpoint} response:`, data)
        const items = isTennis ? data.players : data.teams
        if (data.ok && items) setTeams(items)
        else setTeamsError(isTennis ? 'No se pudieron cargar los jugadores.' : 'No se pudieron cargar los equipos.')
      })
      .catch(err => {
        console.error(`${endpoint} fetch error:`, err)
        setTeamsError('Error de conexión. ¿Está corriendo el backend?')
      })
      .finally(() => setLoadingTeams(false))
  }, [leagueId, league.name, isTennis])

  // Cargar suscripciones existentes
  useEffect(() => {
    fetch(`${API_BASE}/subscriptions/${userId}`)
      .then(res => res.json())
      .then(data => {
        if (data.ok) {
          const existing = data.subscriptions
            .filter(s => s.sport === sport)
            .map(s => s.teamName)
            .filter(Boolean)
          setSubscribed(existing)
        }
      })
      .catch(err => console.error('Error loading subscriptions:', err))
  }, [sport])

  const filtered     = teams.filter(t => t.name.toLowerCase().includes(search.toLowerCase()))
  const isSubscribed = (team) => subscribed.includes(team.name) || newlyAdded.find(t => t.id === team.id)

  const handleConfirm = async ({ team, league, mode }) => {
    setSelectedTeam(null)
    // mode 'all' con un equipo real = seguir equipo en todas las competiciones
    // mode 'all' desde botón "Seguir liga completa" = team.id === leagueId
    const isFullLeague = team.id === leagueId
    const subscription = {
      userId: userId, sport,
      competitionKey: isFullLeague ? leagueId : (mode === 'league_only' ? leagueId : null),
      competitionName: league.name || null,
      teamName: isFullLeague ? null : team.name,
    }
    try {
      const res  = await fetch(`${API_BASE}/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
      })
      const data = await res.json()
      if (data.ok) setNewlyAdded(prev => [...prev, team])
    } catch (error) {
      console.error('Error saving subscription:', error)
    }
  }

  const handleSaveAndSync = async () => {
    setSaving(true)
    try {
      const res  = await fetch(`${API_BASE}/subscriptions/sync`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }
      })
      const data = await res.json()
      console.log('Sync result:', data)
      setSaved(true)
      setTimeout(() => navigate('/dashboard'), 1500)
    } catch (error) {
      console.error('Error syncing:', error)
    } finally {
      setSaving(false)
    }
  }

  const reloadTeams = () => {
    setLoadingTeams(true)
    setTeamsError(null)
    const leagueName = encodeURIComponent(league.apiName || league.name || '')
    const endpoint = isTennis ? 'players' : 'teams'
    fetch(`${API_BASE}/api/${endpoint}/${leagueId}?leagueName=${leagueName}`)
      .then(r => r.json())
      .then(d => { setTeams((isTennis ? d.players : d.teams) || []); setLoadingTeams(false) })
      .catch(() => { setTeamsError('Error de conexión.'); setLoadingTeams(false) })
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>

      <Sidebar activePath="/dashboard" />

      <div style={{ flex: 1, background: '#0F1A2E', padding: '32px 28px', overflowY: 'auto' }}>

        <button onClick={() => navigate(`/dashboard/${sport}`)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#8899AA', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 24, padding: 0 }}>
          ← Volver a {sportInfo.name}
        </button>

        <div style={{ fontSize: 13, color: '#8899AA', marginBottom: 20 }}>
          Mis favoritos → {sportInfo.emoji} {sportInfo.name} → <strong style={{ color: '#FFFFFF' }}>{league.name}</strong>
        </div>

        {/* Seguir liga completa */}
        <div style={{ background: '#142238', border: '0.5px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: '#FFFFFF' }}>{isTennis ? 'Seguir todo el circuito' : 'Seguir toda la liga'}</div>
            <div style={{ fontSize: 12, color: '#8899AA', marginTop: 2 }}>{isTennis ? `Recibe todos los torneos de ${league.name}` : `Recibe todos los partidos de ${league.name}`}</div>
          </div>
          <button
            onClick={() => handleConfirm({ team: { id: leagueId, name: league.name, initials: '🏆' }, league, mode: 'all' })}
            style={{ background: '#F18006', color: '#1C2430', border: 'none', borderRadius: 20, padding: '8px 18px', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
            {isTennis ? '+ Seguir circuito completo' : '+ Seguir liga completa'}
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{ flex: 1, height: '0.5px', background: 'rgba(255,255,255,0.08)' }} />
          <span style={{ fontSize: 12, color: '#8899AA' }}>{isTennis ? 'o elige jugadores específicos' : 'o elige equipos específicos'}</span>
          <div style={{ flex: 1, height: '0.5px', background: 'rgba(255,255,255,0.08)' }} />
        </div>

        {/* Buscador */}
        {!loadingTeams && !teamsError && teams.length > 0 && (
          <div style={{ background: '#1E3A5F', border: '0.5px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <span style={{ fontSize: 16, color: '#8899AA' }}>🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={isTennis ? 'Buscar jugador...' : 'Buscar equipo...'} style={{ border: 'none', outline: 'none', fontSize: 14, color: '#FFFFFF', flex: 1, background: 'transparent' }} />
          </div>
        )}

        {/* Contador */}
        <div style={{ fontSize: 13, fontWeight: 500, color: '#8899AA', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 14 }}>
          {loadingTeams ? (isTennis ? 'Cargando jugadores...' : 'Cargando equipos...') : teamsError ? 'Error' : `${filtered.length} ${isTennis ? 'jugadores' : 'equipos'}`}
        </div>

        {/* Cargando */}
        {loadingTeams && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
            {[1,2,3,4,5,6,7,8].map(i => (
              <div key={i} style={{ background: '#142238', border: '0.5px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: '#1E3A5F', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ width: '80%', height: 13, background: '#1E3A5F', borderRadius: 4 }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {teamsError && (
          <div style={{ background: '#142238', border: '0.5px solid rgba(255,92,0,0.2)', borderRadius: 12, padding: '20px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: '#FFFFFF', marginBottom: 4 }}>{teamsError}</div>
            <div style={{ fontSize: 12, color: '#8899AA', marginBottom: 16 }}>Verifica que el backend esté corriendo en el puerto 3001</div>
            <button onClick={reloadTeams} style={{ background: '#10B1C7', color: '#fff', border: 'none', borderRadius: 20, padding: '8px 20px', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
              Reintentar
            </button>
          </div>
        )}

        {/* Sin resultados */}
        {!loadingTeams && !teamsError && filtered.length === 0 && teams.length > 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#8899AA', fontSize: 14 }}>
            No hay {isTennis ? 'jugadores' : 'equipos'} que coincidan con "{search}"
          </div>
        )}

        {/* Sin equipos */}
        {!loadingTeams && !teamsError && teams.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#8899AA', fontSize: 14 }}>
            {isTennis ? 'No se encontraron jugadores para este circuito.' : 'Esta liga no tiene equipos registrados en TheSportsDB.'}
            <br />
            <span style={{ fontSize: 12 }}>Puedes seguir {isTennis ? 'el circuito completo' : 'la liga completa'} usando el botón de arriba.</span>
          </div>
        )}

        {/* Grid de equipos / jugadores */}
        {!loadingTeams && !teamsError && (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${isTennis ? '200px' : '160px'}, 1fr))`, gap: 10 }}>
            {filtered.map((team) => {
              const already = isSubscribed(team)
              return (
                <div key={team.id}
                  onClick={() => !already && setSelectedTeam(team)}
                  style={{ background: already ? 'rgba(16,177,199,0.04)' : '#142238', border: `0.5px solid ${already ? '#10B1C7' : 'rgba(255,255,255,0.08)'}`, borderRadius: 12, padding: isTennis ? '14px 16px' : 16, display: 'flex', alignItems: 'center', gap: 10, cursor: already ? 'default' : 'pointer' }}
                  onMouseEnter={e => { if (!already) e.currentTarget.style.borderColor = '#10B1C7' }}
                  onMouseLeave={e => { if (!already) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)' }}
                >
                  {isTennis ? (
                    team.photo ? (
                      <img src={team.photo} alt={team.name} style={{ width: 42, height: 42, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 42, height: 42, borderRadius: '50%', background: '#1E3A5F', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>🎾</div>
                    )
                  ) : (
                    team.badge ? (
                      <img src={team.badge} alt={team.name} style={{ width: 36, height: 36, objectFit: 'contain', flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: '#1E3A5F', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 500, color: '#8899AA', flexShrink: 0 }}>
                        {team.initials}
                      </div>
                    )
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#FFFFFF', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team.name}</span>
                    {isTennis && team.nationality && (
                      <span style={{ fontSize: 11, color: '#8899AA', marginTop: 1, display: 'block' }}>{team.nationality}</span>
                    )}
                  </div>
                  {already && <span style={{ fontSize: 14, color: '#06D6A0' }}>✓</span>}
                </div>
              )
            })}
          </div>
        )}

        {/* Barra de guardado */}
        {newlyAdded.length > 0 && (
          <div style={{ background: saved ? '#06D6A0' : '#142238', borderRadius: 14, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, flexWrap: 'wrap', gap: 12, transition: 'background 0.3s' }}>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
              {saved
                ? '✓ Sincronizado con Google Calendar'
                : <><strong style={{ color: '#10B1C7' }}>{newlyAdded.length} {isTennis ? (newlyAdded.length === 1 ? 'jugador' : 'jugadores') : (newlyAdded.length === 1 ? 'equipo' : 'equipos')}</strong> — {newlyAdded.map(t => t.name).join(', ')}</>
              }
            </span>
            {!saved && (
              <button onClick={handleSaveAndSync} disabled={saving} style={{ background: '#F18006', color: '#1C2430', border: 'none', borderRadius: 20, padding: '10px 24px', fontSize: 13, fontWeight: 500, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Sincronizando...' : 'Guardar y sincronizar'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Modal */}
      {selectedTeam && (
        <TeamSubscriptionModal
          team={selectedTeam}
          league={league}
          sport={sport}
          onConfirm={handleConfirm}
          onCancel={() => setSelectedTeam(null)}
        />
      )}
    </div>
  )
}