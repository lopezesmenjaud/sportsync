import { useState } from 'react'

const SPORT_EMOJI = {
  futbol: '⚽', basketball: '🏀', futbol_americano: '🏈',
  automovilismo: '🏎️', baseball: '⚾', tenis: '🎾',
  combate: '🥊', rugby: '🏉', hockey: '🏒', voleibol: '🏐',
}

const SPORT_LABEL = {
  futbol: 'Fútbol', basketball: 'Basketball', futbol_americano: 'Fútbol americano',
  automovilismo: 'Automovilismo', baseball: 'Baseball', tenis: 'Tenis',
  combate: 'Combate', rugby: 'Rugby', hockey: 'Hockey', voleibol: 'Voleibol',
}

function getAllDesc(sport, leagueName, teamName) {
  switch (sport) {
    case 'futbol':
      return `Liga, Champions, Copa y cualquier competición en la que juegue ${teamName}.`
    case 'basketball':
      if (leagueName?.includes('NBA'))
        return `Temporada regular, Playoffs y NBA Finals de ${teamName}.`
      return `Temporada regular y playoffs de ${teamName}.`
    case 'futbol_americano':
      if (leagueName?.includes('NCAA'))
        return `Temporada regular y Bowl games de ${teamName}.`
      if (leagueName?.includes('CFL'))
        return `Temporada regular y Grey Cup de ${teamName}.`
      return `Temporada regular, Playoffs y Super Bowl de ${teamName}.`
    case 'automovilismo':
      return `Todos los Grandes Premios y sesiones de ${teamName}.`
    case 'baseball':
      return `Temporada regular y Playoffs de ${teamName}.`
    case 'tenis':
      return `Todos los torneos del circuito en los que participe ${teamName}.`
    case 'combate':
      return `Todas las peleas programadas de ${teamName}.`
    case 'rugby':
      return `Todos los partidos y fases eliminatorias de ${teamName}.`
    case 'hockey':
      return `Temporada regular, Playoffs y Stanley Cup de ${teamName}.`
    case 'voleibol':
      return `Todos los partidos y fases finales de ${teamName}.`
    default:
      return `Todos los eventos de ${teamName}.`
  }
}

function getLeagueOnlyDesc(sport, leagueName, teamName) {
  switch (sport) {
    case 'futbol':
      return `Solo los partidos de ${teamName} en ${leagueName}. Puedes agregar otras después.`
    case 'basketball':
      return `Solo los partidos de ${teamName} en ${leagueName}. No incluye playoffs de otras conferencias.`
    case 'futbol_americano':
      return `Solo los partidos de ${teamName} en ${leagueName}.`
    case 'automovilismo':
      return `Solo las carreras de ${teamName} en ${leagueName}.`
    case 'baseball':
      return `Solo los partidos de ${teamName} en ${leagueName}.`
    case 'tenis':
      return `Solo los partidos de ${teamName} en ${leagueName}.`
    case 'combate':
      return `Solo las peleas de ${teamName} en eventos de ${leagueName}.`
    case 'rugby':
      return `Solo los partidos de ${teamName} en ${leagueName}.`
    case 'hockey':
      return `Solo los partidos de ${teamName} en ${leagueName}.`
    case 'voleibol':
      return `Solo los partidos de ${teamName} en ${leagueName}.`
    default:
      return `Solo los eventos de ${teamName} en ${leagueName}.`
  }
}

export default function TeamSubscriptionModal({ team, league, sport, onConfirm, onCancel }) {
  const [mode, setMode] = useState('all')

  const emoji     = SPORT_EMOJI[sport] || '🏆'
  const sportName = SPORT_LABEL[sport] || sport

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 100 }}>
      <div style={{ background: '#ffffff', borderRadius: 20, padding: '32px 28px', maxWidth: 420, width: '100%' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
          {sport === 'tenis' && team.photo ? (
            <img src={team.photo} alt={team.name} style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
          ) : team.badge ? (
            <img src={team.badge} alt={team.name} style={{ width: 52, height: 52, objectFit: 'contain', flexShrink: 0 }} />
          ) : (
            <div style={{ width: 52, height: 52, borderRadius: 14, background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 500, color: '#666666', flexShrink: 0 }}>
              {team.initials}
            </div>
          )}
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 500, color: '#1C2430' }}>{team.name}</h2>
            <p style={{ fontSize: 13, color: '#666666', marginTop: 2 }}>{emoji} {sportName} · {league.name}</p>
          </div>
        </div>

        <div style={{ fontSize: 14, fontWeight: 500, color: '#1C2430', marginBottom: 16 }}>
          ¿Qué partidos quieres agregar a tu calendario?
        </div>

        {[
          {
            value: 'all',
            title: sport === 'tenis' ? 'Todos los torneos' : sport === 'automovilismo' ? 'Todas las carreras' : sport === 'combate' ? 'Todas las peleas' : 'Todos los partidos',
            desc: getAllDesc(sport, league.name, team.name)
          },
          {
            value: 'league_only',
            title: sport === 'tenis' ? 'Solo en este circuito' : sport === 'automovilismo' ? 'Solo en este campeonato' : 'Solo en esta competición',
            desc: getLeagueOnlyDesc(sport, league.name, team.name)
          }
        ].map((option) => (
          <div key={option.value}
            onClick={() => setMode(option.value)}
            style={{ border: `1.5px solid ${mode === option.value ? '#10B1C7' : '#e8e8e8'}`, borderRadius: 14, padding: 16, cursor: 'pointer', marginBottom: 10, display: 'flex', alignItems: 'flex-start', gap: 14, background: mode === option.value ? 'rgba(16,177,199,0.04)' : 'transparent' }}
          >
            <div style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${mode === option.value ? '#10B1C7' : '#e8e8e8'}`, flexShrink: 0, marginTop: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: mode === option.value ? '#10B1C7' : 'transparent' }}>
              {mode === option.value && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff' }} />}
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: '#1C2430', marginBottom: 4 }}>{option.title}</div>
              <div style={{ fontSize: 12, color: '#666666', lineHeight: 1.5 }}>{option.desc}</div>
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
          <button onClick={onCancel} style={{ flex: 1, background: '#f0f0f0', color: '#666666', border: 'none', borderRadius: 20, padding: 12, fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
            Cancelar
          </button>
          <button onClick={() => onConfirm({ team, league, mode })} style={{ flex: 2, background: '#F18006', color: '#fff', border: 'none', borderRadius: 20, padding: 12, fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
            Agregar al calendario
          </button>
        </div>

      </div>
    </div>
  )
}
