import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import { apiFetch } from '../api'
import { getUserId } from '../auth'
import { obtenerEstadoGoogle, debeAvisarDePermiso, marcarAvisoDePermisoVisto, invalidarEstadoGoogle } from '../googleStatus'
import CalendarConnectModal from '../components/CalendarConnectModal'
import AvisoError from '../components/AvisoError'
import { API_BASE } from '../config'

const SPORT_LABELS = {
  futbol:            { emoji: '⚽', name: 'Fútbol' },
  basketball:        { emoji: '🏀', name: 'Basketball' },
  futbol_americano:  { emoji: '🏈', name: 'Fútbol americano' },
  automovilismo:     { emoji: '🎽', name: 'Automovilismo' },
  baseball:          { emoji: '⚾', name: 'Baseball' },
  tenis:             { emoji: '🎾', name: 'Tenis' },
  combate:           { emoji: '🥊', name: 'Combate' },
  rugby:             { emoji: '🏉', name: 'Rugby' },
  hockey:            { emoji: '🏒', name: 'Hockey' },
  voleibol:          { emoji: '🏐', name: 'Voleibol' },
  golf:              { emoji: '⛳', name: 'Golf' },
  ciclismo:          { emoji: '🚴', name: 'Ciclismo' },
}

const LEAGUES_BY_SPORT = {
  futbol: [
    {
      id: 'europa_ligas',
      title: 'Europa — Ligas nacionales',
      leagues: [
        { id: '4335', name: 'La Liga',          apiName: 'Spanish La Liga',          country: 'España',     type: 'league' },
        { id: '4400', name: 'Segunda División',  apiName: 'Spanish La Liga 2',  country: 'España',     type: 'league' },
        { id: '4483', name: 'Copa del Rey',      apiName: 'Copa del Rey',             country: 'España',     type: 'cup'    },
        { id: '4328', name: 'Premier League',    apiName: 'English Premier League',   country: 'Inglaterra', type: 'league' },
        { id: '4329', name: 'Championship',      apiName: 'English League Championship', country: 'Inglaterra', type: 'league' },
        { id: '4482', name: 'FA Cup',            apiName: 'English FA Cup',           country: 'Inglaterra', type: 'cup'    },
        { id: '4331', name: 'Bundesliga',        apiName: 'German Bundesliga',        country: 'Alemania',   type: 'league' },
        { id: '4399', name: '2. Bundesliga',     apiName: 'German 2. Bundesliga',  country: 'Alemania',   type: 'league' },
        { id: '4485', name: 'DFB Pokal',         apiName: 'German DFB-Pokal',         country: 'Alemania',   type: 'cup'    },
        { id: '4332', name: 'Serie A',           apiName: 'Italian Serie A',          country: 'Italia',     type: 'league' },
        { id: '4394', name: 'Serie B',           apiName: 'Italian Serie B',  country: 'Italia',     type: 'league' },
        { id: '4506', name: 'Coppa Italia',      apiName: 'Italian Coppa Italia',     country: 'Italia',     type: 'cup'    },
        { id: '4334', name: 'Ligue 1',           apiName: 'French Ligue 1',           country: 'Francia',    type: 'league' },
        { id: '4401', name: 'Ligue 2',           apiName: 'French Ligue 2',  country: 'Francia',    type: 'league' },
        { id: '4484', name: 'Coupe de France',   apiName: 'French Coupe de France',   country: 'Francia',    type: 'cup'    },
        { id: '4344', name: 'Primeira Liga',     apiName: 'Portuguese Primeira Liga', country: 'Portugal',   type: 'league' },
        { id: '4662', name: 'Liga Portugal 2',   apiName: 'Portuguese LigaPro',  country: 'Portugal',   type: 'league' },
        { id: '4510', name: 'Taça de Portugal',  apiName: 'Portuguese Taca de Portugal', country: 'Portugal',   type: 'cup'    },
      ]
    },
    {
      id: 'europa_continental',
      title: 'Europa — Competiciones continentales',
      leagues: [
        { id: '4480', name: 'Champions League',  apiName: 'UEFA Champions League',       country: 'Europa', type: 'cup' },
        { id: '4481', name: 'Europa League',     apiName: 'UEFA Europa League',          country: 'Europa', type: 'cup' },
        { id: '5071', name: 'Conference League', apiName: 'UEFA Europa Conference League', country: 'Europa', type: 'cup' },
      ]
    },
    {
      id: 'latam_primera',
      title: 'América Latina — Primera División',
      leagues: [
        { id: '4350', name: 'Liga MX',              apiName: 'Mexican Primera League',          country: 'México',        type: 'league' },
        { id: '4406', name: 'Primera División',     apiName: 'Argentine Primera División',      country: 'Argentina',     type: 'league' },
        { id: '4351', name: 'Série A',              apiName: 'Brazilian Serie A',               country: 'Brasil',        type: 'league' },
        { id: '4497', name: 'Primera A',            apiName: 'Colombian Primera A',             country: 'Colombia',      type: 'league' },
        { id: '4627', name: 'Primera División',     apiName: 'Chilean Primera Division',        country: 'Chile',         type: 'league' },
        { id: '4688', name: 'Liga 1',               apiName: 'Peruvian Primera Division',       country: 'Perú',          type: 'league' },
        { id: '4432', name: 'Primera División',     apiName: 'Uruguayan Primera Division',      country: 'Uruguay',       type: 'league' },
        { id: '4686', name: 'Serie A',              apiName: 'Ecuadorian Serie A',              country: 'Ecuador',       type: 'league' },
        { id: '4687', name: 'División Profesional', apiName: 'Paraguayan Primera Division',     country: 'Paraguay',      type: 'league' },
        { id: '4685', name: 'División Profesional', apiName: 'Bolivian Primera División',       country: 'Bolivia',       type: 'league' },
        { id: '4513', name: 'Primera División',     apiName: 'Venezuelan Primera Division',     country: 'Venezuela',     type: 'league' },
        { id: '4815', name: 'Primera División',     apiName: 'Costa-Rica Liga FPD',             country: 'Costa Rica',    type: 'league' },
        { id: '4817', name: 'Liga Nacional',        apiName: 'Guatemala Liga Nacional',         country: 'Guatemala',     type: 'league' },
        { id: '4818', name: 'Liga Nacional',        apiName: 'Honduras Liga Nacional de Futbol',country: 'Honduras',      type: 'league' },
        { id: '4816', name: 'Primera División',     apiName: 'El Salvador Primera Division',    country: 'El Salvador',   type: 'league' },
        { id: '4819', name: 'LPF',                  apiName: 'Panama Liga Panamena de Futbol',  country: 'Panamá',        type: 'league' },
        { id: '4956', name: 'Liga Dominicana',      apiName: 'Dominican LDF',                   country: 'R. Dominicana', type: 'league' },
      ]
    },
    {
      id: 'latam_segunda',
      title: 'América Latina — Segunda División',
      leagues: [
        { id: '4654', name: 'Expansión MX',     apiName: 'Mexican Liga de Expansion MX', country: 'México',    type: 'cup'    },
        { id: '4616', name: 'Primera Nacional', apiName: 'Argentinian Primera B Nacional', country: 'Argentina', type: 'league' },
        { id: '4404', name: 'Série B',          apiName: 'Brazilian Serie B',              country: 'Brasil',    type: 'league' },
        { id: '4951', name: 'Primera B',        apiName: 'Colombian Categoría Primera B',  country: 'Colombia',  type: 'league' },
        { id: '4899', name: 'Primera B',        apiName: 'Chilean Primera B',              country: 'Chile',     type: 'league' },
        { id: '5073', name: 'Liga 2',           apiName: 'Peruvian Segunda Division',      country: 'Perú',      type: 'league' },
        { id: '5072', name: 'Segunda División', apiName: 'Uruguayan Segunda Division',     country: 'Uruguay',   type: 'league' },
        { id: '4957', name: 'Serie B',          apiName: 'Ecuadorian Serie B',             country: 'Ecuador',   type: 'league' },
      ]
    },
    {
      id: 'americas_continental',
      title: 'Américas — Competiciones continentales',
      leagues: [
        { id: '4501', name: 'Copa Libertadores',      apiName: 'CONMEBOL Libertadores',       country: 'CONMEBOL', type: 'cup' },
        { id: '4724', name: 'Copa Sudamericana',      apiName: 'CONMEBOL Sudamericana',       country: 'CONMEBOL', type: 'cup' },
        { id: '4721', name: 'CONCACAF Champions Cup', apiName: 'CONCACAF Champions League',    country: 'CONCACAF', type: 'cup' },
      ]
    },
    // APAGADA a propósito (hidden). Prometía suscripciones que nunca reciben partidos: guarda
    // competitionKey "national_all"/"national_official", que el sync brinca y ninguna liga real
    // trae, y el teamName en español ("México") cuando el proveedor escribe "Mexico". Se va a
    // reemplazar por la sección de confederaciones + selección específica. El código de abajo
    // (NATIONAL_TEAMS, handleNationalSubscribe, el bloque isSelecciones) se queda para reusarlo.
    {
      id: 'selecciones',
      title: 'Selecciones nacionales',
      special: 'selecciones',
      hidden: true,
      leagues: []
    }
  ],
  basketball: [
    { id: 'basket_americas', title: 'Américas', leagues: [
      { id: '4387', name: 'NBA',           apiName: 'NBA',  country: 'Estados Unidos', type: 'league' },
      { id: '4516', name: 'WNBA',          apiName: 'WNBA', country: 'Estados Unidos', type: 'league' },
      { id: '4607', name: 'NCAA',          apiName: 'NCAA Men\'s Basketball', country: 'Estados Unidos', type: 'cup'    },
      { id: '4434', name: 'NBL Australia', apiName: 'Australian NBL', country: 'Australia', type: 'league' },
    ]},
    { id: 'basket_europa', title: 'Europa', leagues: [
      { id: '4546', name: 'EuroLeague', apiName: 'EuroLeague Basketball', country: 'Europa', type: 'cup' },
      { id: '4408', name: 'ACB Liga',   apiName: 'Spanish Liga ACB',     country: 'España', type: 'league' },
    ]},
  ],
  futbol_americano: [
    { id: 'americano_all', title: 'Ligas', leagues: [
      { id: '4391', name: 'NFL',           apiName: 'NFL',              country: 'Estados Unidos', type: 'league' },
      { id: '4479', name: 'NCAA Football', apiName: 'NCAA Football',   country: 'Estados Unidos', type: 'cup'    },
      { id: '4405', name: 'CFL',           apiName: 'CFL',             country: 'Canadá',         type: 'league' },
    ]},
  ],
  automovilismo: [
    { id: 'motor_all', title: 'Competiciones', leagues: [
      { id: '4370', name: 'Fórmula 1',  apiName: 'Formula 1',        country: 'Internacional',  type: 'cup' },
      { id: '4373', name: 'IndyCar',    apiName: 'IndyCar Series',   country: 'Estados Unidos', type: 'cup' },
      { id: '4393', name: 'NASCAR',     apiName: 'NASCAR Cup Series',country: 'Estados Unidos', type: 'cup' },
      { id: '4407', name: 'MotoGP',     apiName: 'MotoGP',         country: 'Internacional',  type: 'cup' },
      { id: '4409', name: 'WRC',        apiName: 'World Rally Championship', country: 'Internacional',  type: 'cup' },
    ]},
  ],
  baseball: [
    { id: 'baseball_all', title: 'Ligas', leagues: [
      { id: '4424', name: 'MLB',           apiName: 'MLB',  country: 'Estados Unidos', type: 'league' },
      { id: '5064', name: 'Liga Mexicana', apiName: 'Liga Mexicana de Beisbol', country: 'México', type: 'league' },
      { id: '4591', name: 'NPB',           apiName: 'Japanese Nippon Baseball', country: 'Japón',          type: 'cup'    },
    ]},
  ],
  // En tenis estas dos filas ya NO son para seguir el circuito entero (eso ahora son las
  // categorías de torneo, que vienen del backend): son la entrada a la lista de jugadores.
  // `label` es solo lo que se pinta aquí. `name` se queda como "ATP Tour"/"WTA Tour" a propósito:
  // TeamPicker y TeamSubscriptionModal lo usan como competitionName de las suscripciones por
  // jugador y en sus textos, y ésas no se tocan.
  tenis: [
    { id: 'tenis_jugadores', title: 'Jugadores', leagues: [
      { id: '4464', name: 'ATP Tour', label: 'Jugadores ATP', apiName: 'ATP World Tour', country: 'Internacional', type: 'league' },
      { id: '4517', name: 'WTA Tour', label: 'Jugadores WTA', apiName: 'WTA Tour', country: 'Internacional', type: 'league' },
    ]},
  ],
  combate: [
    { id: 'combate_all', title: 'Organizaciones', leagues: [
      { id: '4443', name: 'UFC',   apiName: 'UFC', country: 'Internacional', type: 'cup' },
      { id: '4445', name: 'Boxeo', apiName: 'Boxing', country: 'Internacional', type: 'cup' },
    ]},
  ],
  rugby: [
    { id: 'rugby_all', title: 'Competiciones', leagues: [
      { id: '4714', name: 'Six Nations',     apiName: 'Six Nations Championship', country: 'Europa',        type: 'cup' },
      { id: '4574', name: 'Rugby World Cup', apiName: 'Rugby World Cup', country: 'Internacional', type: 'cup' },
    ]},
  ],
  hockey: [
    { id: 'hockey_all', title: 'Ligas', leagues: [
      { id: '4380', name: 'NHL', apiName: 'NHL', country: 'Estados Unidos / Canadá', type: 'league' },
      { id: '4920', name: 'KHL', apiName: 'KHL', country: 'Rusia',                   type: 'cup'    },
    ]},
  ],
  voleibol: [
    { id: 'voleibol_all', title: 'Ligas y competiciones', leagues: [
      { id: '5083', name: 'FIVB Nations League', apiName: 'FIVB Volleyball Nations League', country: 'Internacional', type: 'cup'    },
      { id: '4544', name: 'Lega Volley',         apiName: 'Italian Volleyball League', country: 'Italia', type: 'league' },
    ]},
  ],
  golf: [
    { id: 'golf_all', title: 'Circuitos', leagues: [
      { id: '4425', name: 'PGA Tour',       apiName: 'PGA Tour',      country: 'Mundial', type: 'cup' },
      { id: '4553', name: 'LPGA Tour',      apiName: 'LPGA Tour',     country: 'Mundial', type: 'cup' },
      { id: '4426', name: 'DP World Tour',  apiName: 'European Tour', country: 'Mundial', type: 'cup' },
      { id: '5329', name: 'LIV Golf',       apiName: 'LIV Golf',     country: 'Mundial', type: 'cup' },
    ]},
  ],
  ciclismo: [
    { id: 'ciclismo_all', title: 'Competiciones', leagues: [
      { id: '4465', name: 'UCI World Tour', apiName: 'UCI World Tour', country: 'Internacional', type: 'cup' },
    ]},
  ],
}

const NATIONAL_TEAMS = [
  { name: 'México',             flag: '🇲🇽', confederation: 'CONCACAF' },
  { name: 'Estados Unidos',     flag: '🇺🇸', confederation: 'CONCACAF' },
  { name: 'Canadá',             flag: '🇨🇦', confederation: 'CONCACAF' },
  { name: 'Costa Rica',         flag: '🇨🇷', confederation: 'CONCACAF' },
  { name: 'Honduras',           flag: '🇭🇳', confederation: 'CONCACAF' },
  { name: 'Guatemala',          flag: '🇬🇹', confederation: 'CONCACAF' },
  { name: 'El Salvador',        flag: '🇸🇻', confederation: 'CONCACAF' },
  { name: 'Panamá',             flag: '🇵🇦', confederation: 'CONCACAF' },
  { name: 'Jamaica',            flag: '🇯🇲', confederation: 'CONCACAF' },
  { name: 'Trinidad y Tobago',  flag: '🇹🇹', confederation: 'CONCACAF' },
  { name: 'Cuba',               flag: '🇨🇺', confederation: 'CONCACAF' },
  { name: 'Rep. Dominicana',    flag: '🇩🇴', confederation: 'CONCACAF' },
  { name: 'Argentina',          flag: '🇦🇷', confederation: 'CONMEBOL' },
  { name: 'Brasil',             flag: '🇧🇷', confederation: 'CONMEBOL' },
  { name: 'Colombia',           flag: '🇨🇴', confederation: 'CONMEBOL' },
  { name: 'Chile',              flag: '🇨🇱', confederation: 'CONMEBOL' },
  { name: 'Perú',               flag: '🇵🇪', confederation: 'CONMEBOL' },
  { name: 'Uruguay',            flag: '🇺🇾', confederation: 'CONMEBOL' },
  { name: 'Ecuador',            flag: '🇪🇨', confederation: 'CONMEBOL' },
  { name: 'Paraguay',           flag: '🇵🇾', confederation: 'CONMEBOL' },
  { name: 'Bolivia',            flag: '🇧🇴', confederation: 'CONMEBOL' },
  { name: 'Venezuela',          flag: '🇻🇪', confederation: 'CONMEBOL' },
  { name: 'España',             flag: '🇪🇸', confederation: 'UEFA' },
  { name: 'Francia',            flag: '🇫🇷', confederation: 'UEFA' },
  { name: 'Alemania',           flag: '🇩🇪', confederation: 'UEFA' },
  { name: 'Italia',             flag: '🇮🇹', confederation: 'UEFA' },
  { name: 'Portugal',           flag: '🇵🇹', confederation: 'UEFA' },
  { name: 'Inglaterra',         flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', confederation: 'UEFA' },
  { name: 'Países Bajos',       flag: '🇳🇱', confederation: 'UEFA' },
  { name: 'Bélgica',            flag: '🇧🇪', confederation: 'UEFA' },
  { name: 'Croacia',            flag: '🇭🇷', confederation: 'UEFA' },
  { name: 'Japón',              flag: '🇯🇵', confederation: 'AFC'  },
  { name: 'Corea del Sur',      flag: '🇰🇷', confederation: 'AFC'  },
  { name: 'Arabia Saudita',     flag: '🇸🇦', confederation: 'AFC'  },
  { name: 'Australia',          flag: '🇦🇺', confederation: 'AFC'  },
  { name: 'Marruecos',          flag: '🇲🇦', confederation: 'CAF'  },
  { name: 'Nigeria',            flag: '🇳🇬', confederation: 'CAF'  },
  { name: 'Ghana',              flag: '🇬🇭', confederation: 'CAF'  },
  { name: 'Egipto',             flag: '🇪🇬', confederation: 'CAF'  },
]

export default function LeaguePicker() {
  const { sport } = useParams()
  const navigate  = useNavigate()
  const sportInfo = SPORT_LABELS[sport] || { emoji: '🏆', name: sport }
  const categories = LEAGUES_BY_SPORT[sport] || []
  const userId = getUserId()

  const [search, setSearch]                     = useState('')
  const [subscribingId, setSubscribingId]       = useState(null)
  const [subscribedIds, setSubscribedIds]       = useState([])
  const [countrySearch, setCountrySearch]       = useState('')
  const [selectedCountry, setSelectedCountry]   = useState(null)
  const [nationalMode, setNationalMode]         = useState(null)
  const [subscribingNational, setSubscribingNational] = useState(false)
  const [subscribedNational, setSubscribedNational]   = useState([])
  const [errorSub, setErrorSub]                       = useState(null)
  const [mostrarAviso, setMostrarAviso]               = useState(false)

  // ── Categorías de torneo de tenis ──
  // La lista sale del backend (GET /api/tenis/categorias, que lee src/data/tenisTorneos.json):
  // escrita aquí a mano se desincronizaría de la tabla que usa el clasificador.
  // null = cargando; [] con errorCategorias = no se pudo cargar. Si falla NO se cae a
  // "ATP Tour": eso reviviría la suscripción de circuito que se está retirando.
  const esTenis = sport === 'tenis'
  const [categoriasTenis, setCategoriasTenis]   = useState(null)
  const [errorCategorias, setErrorCategorias]   = useState(false)
  // clave de categoría -> id de la suscripción. Sale de GET /subscriptions/:userId, así que
  // lo prendido se ve prendido aunque se haya prendido en otra visita.
  const [subPorCategoria, setSubPorCategoria]   = useState({})
  const [cambiandoCategoria, setCambiandoCategoria] = useState(null)

  useEffect(() => {
    if (!esTenis) return
    let vivo = true
    Promise.all([
      apiFetch('/api/tenis/categorias').then(r => r.json()),
      apiFetch(`/subscriptions/${userId}`).then(r => r.json()),
    ])
      .then(([cats, subs]) => {
        if (!vivo) return
        if (!cats.ok || !Array.isArray(cats.categorias) || !subs.ok) throw new Error('respuesta incompleta')
        const claves = new Set(cats.categorias.map(c => c.clave))
        const mapa = {}
        for (const s of subs.subscriptions || []) {
          if (s.sport === 'tenis' && !s.teamName && claves.has(s.competitionKey)) mapa[s.competitionKey] = s.id
        }
        setCategoriasTenis(cats.categorias)
        setSubPorCategoria(mapa)
      })
      .catch(err => {
        console.error('Error cargando categorías de tenis:', err)
        if (vivo) { setCategoriasTenis([]); setErrorCategorias(true) }
      })
    return () => { vivo = false }
  }, [esTenis, userId])

  // Prender = POST /subscriptions (el backend corre el relleno de este usuario al momento).
  // Apagar = el mismo DELETE /subscriptions/:id de Dashboard y Perfil, sin confirmación: es
  // reversible, porque volver a prender vuelve a correr el relleno.
  const toggleCategoria = async (cat) => {
    if (cambiandoCategoria) return
    setCambiandoCategoria(cat.clave)
    setErrorSub(null)
    const subId = subPorCategoria[cat.clave]
    try {
      if (subId) {
        const res  = await apiFetch(`/subscriptions/${subId}`, { method: 'DELETE' })
        const data = await res.json()
        if (!data.ok) { setErrorSub(`No se pudo dejar de seguir ${cat.nombre}. Intenta de nuevo.`); return }
        setSubPorCategoria(prev => { const n = { ...prev }; delete n[cat.clave]; return n })
      } else {
        const res  = await apiFetch('/subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: userId, sport: 'tenis', competitionKey: cat.clave, competitionName: cat.nombre, teamName: null })
        })
        const data = await res.json()
        if (!data.ok || !data.subscription) { setErrorSub(`No se pudo seguir ${cat.nombre}. Intenta de nuevo.`); return }
        setSubPorCategoria(prev => ({ ...prev, [cat.clave]: data.subscription.id }))
        // Mismo orden que handleDirectSubscribe: primero se confirma que se guardó, luego el permiso.
        if (debeAvisarDePermiso(await obtenerEstadoGoogle())) setMostrarAviso(true)
      }
    } catch (e) {
      console.error(e)
      setErrorSub(`No se pudo cambiar ${cat.nombre}. Revisa tu conexión.`)
    } finally {
      setCambiandoCategoria(null)
    }
  }

  // ORDEN: primero se guarda y se MIRA la respuesta; solo si se guardó bien se evalúa el permiso.
  // Si el POST falló se muestra el error de la suscripción y NO el del calendario: mandar a
  // arreglar un permiso a alguien cuya suscripción no se guardó es mandarlo a arreglar lo que no
  // falló.
  const handleDirectSubscribe = async (league) => {
    if (subscribingId) return
    setSubscribingId(league.id)
    setErrorSub(null)
    try {
      const res = await apiFetch('/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId, sport, competitionKey: league.id, competitionName: league.name, teamName: null })
      })
      const data = await res.json()
      if (!data.ok) {
        // Antes esta línea marcaba la liga como seguida pasara lo que pasara: la UI afirmaba algo
        // que no había ocurrido.
        setErrorSub(`No se pudo seguir ${league.name}. Intenta de nuevo.`)
        return
      }
      setSubscribedIds(prev => [...prev, league.id])
      // Se ESPERA el estado en vez de leer la foto del hook: mientras carga, esa foto es
      // undefined y debeAvisarDePermiso diría "no avisar". Alguien que se suscribe antes de que
      // responda /auth/google/status —con Render dormido pasa— se iría sin aviso, y el código se
      // vería igual de correcto que si funcionara. La promesa ya está en vuelo o cacheada: no
      // cuesta una petición nueva.
      if (debeAvisarDePermiso(await obtenerEstadoGoogle())) setMostrarAviso(true)
    } catch (e) {
      console.error(e)
      setErrorSub(`No se pudo seguir ${league.name}. Revisa tu conexión.`)
    }
    finally { setSubscribingId(null) }
  }

  const handleNationalSubscribe = async () => {
    if (!selectedCountry || !nationalMode || subscribingNational) return
    setSubscribingNational(true)
    setErrorSub(null)
    try {
      const res = await apiFetch('/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId, sport, competitionKey: `national_${nationalMode}`, competitionName: `Selección ${selectedCountry.name}`, teamName: selectedCountry.name })
      })
      const data = await res.json()
      if (!data.ok) {
        setErrorSub(`No se pudo seguir a ${selectedCountry.name}. Intenta de nuevo.`)
        return
      }
      setSubscribedNational(prev => [...prev, selectedCountry.name])
      setSelectedCountry(null); setNationalMode(null); setCountrySearch('')
      // Se ESPERA el estado en vez de leer la foto del hook: mientras carga, esa foto es
      // undefined y debeAvisarDePermiso diría "no avisar". Alguien que se suscribe antes de que
      // responda /auth/google/status —con Render dormido pasa— se iría sin aviso, y el código se
      // vería igual de correcto que si funcionara. La promesa ya está en vuelo o cacheada: no
      // cuesta una petición nueva.
      if (debeAvisarDePermiso(await obtenerEstadoGoogle())) setMostrarAviso(true)
    } catch (e) {
      console.error(e)
      setErrorSub(`No se pudo seguir a ${selectedCountry.name}. Revisa tu conexión.`)
    }
    finally { setSubscribingNational(false) }
  }

  // Cerrar el modal NUNCA deshace la suscripción: ya quedó guardada, y el backfill la atiende en
  // cuanto llegue el permiso.
  const cerrarAviso = () => { marcarAvisoDePermisoVisto(); setMostrarAviso(false) }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>

      <Sidebar activePath="/dashboard" />

      <div style={{ flex: 1, background: '#faf9f7', padding: '32px 28px', overflowY: 'auto' }}>

        <button onClick={() => navigate('/dashboard')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#666666', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 24, padding: 0 }}>
          ← Volver a mis deportes
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          <div style={{ width: 48, height: 48, background: '#ffffff', border: '1px solid #e8e8e8', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>{sportInfo.emoji}</div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 500, color: '#1C2430' }}>{sportInfo.name}</h1>
            <p style={{ fontSize: 13, color: '#666666', marginTop: 2 }}>{esTenis ? 'Elige las categorías de torneo o los jugadores que quieres seguir' : 'Elige las ligas que quieres seguir'}</p>
          </div>
        </div>

        <div style={{ background: '#f0f0f0', border: '1px solid #e8e8e8', borderRadius: 12, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <span style={{ fontSize: 14, color: '#666666' }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar liga, copa o competición..." style={{ border: 'none', outline: 'none', fontSize: 14, color: '#1C2430', flex: 1, background: 'transparent' }} />
          {search && <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#666666', padding: 0, lineHeight: 1 }}>×</button>}
        </div>

        {esTenis && (() => {
          const visibles = (categoriasTenis || []).filter(c => !search || c.nombre.toLowerCase().includes(search.toLowerCase()))
          if (search && categoriasTenis && visibles.length === 0) return null
          return (
            <div style={{ marginBottom: 32 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Categorías de torneo</span>
                {categoriasTenis && !errorCategorias && <span style={{ fontSize: 11, color: '#666666', background: '#e8e8e8', borderRadius: 10, padding: '2px 8px' }}>{visibles.length}</span>}
              </div>
              {categoriasTenis === null ? (
                <div style={{ fontSize: 13, color: '#666666', padding: '12px 0' }}>Cargando categorías...</div>
              ) : errorCategorias ? (
                <div style={{ fontSize: 13, color: '#666666', padding: '12px 0' }}>No pudimos cargar las categorías de torneo. Recarga la página para intentar de nuevo.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {visibles.map(cat => {
                    const prendida = Boolean(subPorCategoria[cat.clave])
                    const cambiando = cambiandoCategoria === cat.clave
                    return (
                      <div key={cat.clave} style={{ background: prendida ? 'rgba(16,177,199,0.04)' : '#ffffff', border: `0.5px solid ${prendida ? '#10B1C7' : '#e8e8e8'}`, borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(255,92,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0, border: '0.5px solid #ffe8b0' }}>🏆</div>
                          <div style={{ fontSize: 14, fontWeight: 500, color: '#1C2430' }}>{cat.nombre}</div>
                        </div>
                        <button
                          onClick={() => toggleCategoria(cat)}
                          disabled={Boolean(cambiandoCategoria)}
                          aria-pressed={prendida}
                          style={prendida
                            ? { background: 'transparent', color: '#06D6A0', border: '1px solid #06D6A0', borderRadius: 20, padding: '6px 16px', fontSize: 12, fontWeight: 500, cursor: cambiandoCategoria ? 'wait' : 'pointer', opacity: cambiando ? 0.7 : 1, flexShrink: 0 }
                            : { background: '#F18006', color: '#fff', border: '1px solid #F18006', borderRadius: 20, padding: '6px 16px', fontSize: 12, fontWeight: 500, cursor: cambiandoCategoria ? 'wait' : 'pointer', opacity: cambiando ? 0.7 : 1, flexShrink: 0 }}
                        >
                          {cambiando ? '...' : prendida ? '✓ Siguiendo' : '+ Seguir'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })()}

        {/* Selecciones nacionales: UN renglón arriba de las ligas, que no se mueven. Lleva a su
            propia pantalla (SeleccionesPage) con el mismo patrón que "Ver equipos →" de una liga.
            Es la sección NUEVA; la vieja ('selecciones' con hidden: true, más abajo) sigue apagada.
            Siempre se puede entrar: el estado (qué sigues) se carga allá, del servidor, cada vez. */}
        {sport === 'futbol' && (!search || 'futbol de selecciones nacionales mundial copa oro eurocopa copa america concacaf uefa conmebol'.includes(search.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) && (
          <div
            onClick={() => navigate('/dashboard/futbol/selecciones')}
            style={{ background: '#ffffff', border: '0.5px solid #e8e8e8', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', marginBottom: 32 }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#10B1C7' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#e8e8e8' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(255,92,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0, border: '0.5px solid #ffe8b0' }}>🌎</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#1C2430' }}>Fútbol de selecciones</div>
                <div style={{ fontSize: 12, color: '#666666', marginTop: 2 }}>Confederaciones y selecciones, varonil y femenil</div>
              </div>
            </div>
            <span style={{ fontSize: 13, color: '#10B1C7', fontWeight: 500 }}>Ver selecciones →</span>
          </div>
        )}

        {categories.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#666666', fontSize: 14 }}>
            Ligas de {sportInfo.name} próximamente.
          </div>
        )}

        {categories.map(category => {
          if (category.hidden) return null
          const isSelecciones  = category.special === 'selecciones'
          const visibleLeagues = category.leagues.filter(l =>
            !search || (l.label || l.name).toLowerCase().includes(search.toLowerCase()) || l.country.toLowerCase().includes(search.toLowerCase())
          )
          if (search && !isSelecciones && visibleLeagues.length === 0) return null

          return (
            <div key={category.id} style={{ marginBottom: 32 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.8px' }}>{category.title}</span>
                {!isSelecciones && <span style={{ fontSize: 11, color: '#666666', background: '#e8e8e8', borderRadius: 10, padding: '2px 8px' }}>{visibleLeagues.length}</span>}
              </div>

              {isSelecciones ? (
                <div style={{ background: '#ffffff', border: '0.5px solid #e8e8e8', borderRadius: 14, padding: 20 }}>
                  <p style={{ fontSize: 13, color: '#666666', marginBottom: 14, lineHeight: 1.5 }}>
                    Busca tu selección y elige qué partidos quieres en tu calendario.
                  </p>
                  <div style={{ background: '#f0f0f0', border: '0.5px solid #e8e8e8', borderRadius: 10, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 14, color: '#666666' }}>🔍</span>
                    <input value={countrySearch} onChange={e => { setCountrySearch(e.target.value); setSelectedCountry(null); setNationalMode(null) }} placeholder="Ej: México, España, Brasil..." style={{ border: 'none', outline: 'none', fontSize: 14, color: '#1C2430', flex: 1, background: 'transparent' }} />
                  </div>
                  {countrySearch.length < 2 ? (
                    <div style={{ fontSize: 13, color: '#666666', textAlign: 'center', padding: '16px 0' }}>Escribe al menos 2 letras para buscar</div>
                  ) : (
                    <div style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {(() => {
                        const results = NATIONAL_TEAMS.filter(t =>
                          t.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
                          t.confederation.toLowerCase().includes(countrySearch.toLowerCase())
                        )
                        if (results.length === 0) return <div style={{ fontSize: 13, color: '#666666', textAlign: 'center', padding: '20px 0' }}>No encontramos "{countrySearch}"</div>
                        return results.map(team => {
                          const alreadySubscribed = subscribedNational.includes(team.name)
                          const isSelected        = selectedCountry?.name === team.name
                          return (
                            <div key={team.name}>
                              <div onClick={() => { if (!alreadySubscribed) { setSelectedCountry(isSelected ? null : team); setNationalMode(null) } }}
                                style={{ padding: '10px 12px', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: alreadySubscribed ? 'default' : 'pointer', background: isSelected ? 'rgba(16,177,199,0.04)' : 'transparent', border: `0.5px solid ${isSelected ? '#10B1C7' : 'transparent'}` }}
                                onMouseEnter={e => { if (!alreadySubscribed && !isSelected) e.currentTarget.style.background = 'rgba(241,128,6,0.04)' }}
                                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <span style={{ fontSize: 22 }}>{team.flag}</span>
                                  <div>
                                    <div style={{ fontSize: 14, fontWeight: 500, color: '#1C2430' }}>{team.name}</div>
                                    <div style={{ fontSize: 11, color: '#666666' }}>{team.confederation}</div>
                                  </div>
                                </div>
                                {alreadySubscribed
                                  ? <span style={{ fontSize: 12, color: '#06D6A0', fontWeight: 500 }}>✓ Suscrito</span>
                                  : <span style={{ fontSize: 12, color: isSelected ? '#10B1C7' : '#666666' }}>{isSelected ? 'Seleccionado ✓' : 'Elegir'}</span>
                                }
                              </div>
                              {isSelected && (
                                <div style={{ padding: '14px 12px', background: 'rgba(16,177,199,0.04)', borderRadius: 10, margin: '4px 0 8px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                                  <div style={{ fontSize: 12, color: '#666666' }}>¿Qué partidos quieres de {team.flag} {team.name}?</div>
                                  <div style={{ display: 'flex', gap: 8 }}>
                                    <button onClick={() => setNationalMode('official')} style={{ flex: 1, padding: '9px 12px', borderRadius: 10, border: `1.5px solid ${nationalMode === 'official' ? '#10B1C7' : '#e8e8e8'}`, background: nationalMode === 'official' ? 'rgba(16,177,199,0.06)' : '#ffffff', color: nationalMode === 'official' ? '#10B1C7' : '#666666', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                                      Solo competiciones oficiales
                                    </button>
                                    <button onClick={() => setNationalMode('all')} style={{ flex: 1, padding: '9px 12px', borderRadius: 10, border: `1.5px solid ${nationalMode === 'all' ? '#10B1C7' : '#e8e8e8'}`, background: nationalMode === 'all' ? 'rgba(16,177,199,0.06)' : '#ffffff', color: nationalMode === 'all' ? '#10B1C7' : '#666666', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                                      Competiciones + amistosos
                                    </button>
                                  </div>
                                  {nationalMode && (
                                    <button onClick={handleNationalSubscribe} disabled={subscribingNational} style={{ background: '#F18006', color: '#fff', border: 'none', borderRadius: 10, padding: '10px', fontSize: 13, fontWeight: 500, cursor: subscribingNational ? 'wait' : 'pointer', opacity: subscribingNational ? 0.7 : 1 }}>
                                      {subscribingNational ? 'Suscribiendo...' : `+ Seguir ${team.name}`}
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })
                      })()}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {visibleLeagues.map(league => {
                    const isCup            = league.type === 'cup'
                    const alreadySubscribed = subscribedIds.includes(league.id)
                    const isSubscribing    = subscribingId === league.id
                    return (
                      <div key={league.id}
                        onClick={() => { if (!isCup && !alreadySubscribed) navigate(`/dashboard/${sport}/${league.id}`, { state: { league, sportInfo } }) }}
                        style={{ background: alreadySubscribed ? 'rgba(16,177,199,0.04)' : '#ffffff', border: `0.5px solid ${alreadySubscribed ? '#10B1C7' : '#e8e8e8'}`, borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: isCup || alreadySubscribed ? 'default' : 'pointer' }}
                        onMouseEnter={e => { if (!isCup && !alreadySubscribed) e.currentTarget.style.borderColor = '#10B1C7' }}
                        onMouseLeave={e => { if (!alreadySubscribed) e.currentTarget.style.borderColor = '#e8e8e8' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 40, height: 40, borderRadius: 10, background: isCup ? 'rgba(255,92,0,0.1)' : '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: isCup ? 18 : 15, fontWeight: 500, color: isCup ? '#e0a020' : '#10B1C7', flexShrink: 0, border: `0.5px solid ${isCup ? '#ffe8b0' : '#e8e8e8'}` }}>
                            {isCup ? '🏆' : (league.label || league.name).charAt(0)}
                          </div>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 500, color: '#1C2430' }}>{league.label || league.name}</div>
                            <div style={{ fontSize: 12, color: '#666666', marginTop: 2 }}>{league.country}</div>
                          </div>
                        </div>
                        <div>
                          {alreadySubscribed ? (
                            <span style={{ fontSize: 13, color: '#06D6A0', fontWeight: 500 }}>✓ Suscrito</span>
                          ) : isCup ? (
                            <button onClick={e => { e.stopPropagation(); handleDirectSubscribe(league) }} disabled={isSubscribing} style={{ background: '#F18006', color: '#fff', border: 'none', borderRadius: 20, padding: '6px 16px', fontSize: 12, fontWeight: 500, cursor: isSubscribing ? 'wait' : 'pointer', opacity: isSubscribing ? 0.7 : 1 }}>
                              {isSubscribing ? '...' : '+ Suscribir'}
                            </button>
                          ) : (
                            <span style={{ fontSize: 13, color: '#10B1C7', fontWeight: 500 }}>{esTenis ? 'Ver jugadores →' : 'Ver equipos →'}</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <AvisoError mensaje={errorSub} onCerrar={() => setErrorSub(null)} />

      {/* onConnect NO marca el aviso como visto, a propósito: quien pica Conectar y despaloma la
          casilla en Google vuelve SIN permiso, y es justo la persona que más nos importa.
          Marcarlo nos callaría con ella el resto de la sesión. Si sí lo concedió,
          hasCalendarScope será true y el modal no vuelve a salir de todos modos. */}
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