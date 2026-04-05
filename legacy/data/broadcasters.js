// Canales por deporte y país — 3 categorías:
//   freeTV:    TV abierta (gratis, no monetizable)
//   paidTV:    TV de paga / cable (no monetizable)
//   streaming: Plataformas online — { name, url } — monetizables con ID afiliado
//
// Cuando tengas tu ID de afiliado, agrega ?ref=TU_ID a cada url.
// Ejemplo: https://vix.com?ref=TU_ID

export const BROADCASTERS = {

  football: {
    Mexico: {
      freeTV:    ['Canal de las Estrellas', 'TUDN abierto'],
      paidTV:    ['Fox Sports', 'ESPN', 'TUDN'],
      streaming: [
        { name: 'ViX',          url: 'https://vix.com' },
        { name: 'Fox Sports+',  url: 'https://www.foxsports.com.mx' },
        { name: 'Paramount+',   url: 'https://www.paramountplus.com/mx' },
      ],
    },
    Spain: {
      freeTV:    ['La 1', 'Telecinco'],
      paidTV:    ['Movistar+', 'DAZN canal'],
      streaming: [
        { name: 'DAZN',         url: 'https://www.dazn.com/es-ES' },
        { name: 'Movistar+',    url: 'https://www.movistarplus.es' },
      ],
    },
    'United States': {
      freeTV:    ['Telemundo', 'UniMás'],
      paidTV:    ['Fox', 'CBS', 'ABC'],
      streaming: [
        { name: 'Peacock',      url: 'https://www.peacocktv.com' },
        { name: 'ESPN+',        url: 'https://plus.espn.com' },
        { name: 'Paramount+',   url: 'https://www.paramountplus.com' },
      ],
    },
    Argentina: {
      freeTV:    ['TV Pública'],
      paidTV:    ['TyC Sports', 'ESPN', 'DirecTV Sports'],
      streaming: [
        { name: 'Star+',        url: 'https://www.starplus.com/ar' },
        { name: 'ESPN Premium', url: 'https://www.espn.com.ar' },
      ],
    },
    Brazil: {
      freeTV:    ['Globo', 'Band'],
      paidTV:    ['SporTV', 'ESPN', 'TNT Sports'],
      streaming: [
        { name: 'Globoplay',    url: 'https://globoplay.globo.com' },
        { name: 'Star+',        url: 'https://www.starplus.com/br' },
      ],
    },
    Colombia: {
      freeTV:    [],
      paidTV:    ['Win Sports', 'ESPN', 'DirecTV Sports'],
      streaming: [
        { name: 'Win Sports+',  url: 'https://www.winsports.co' },
        { name: 'Star+',        url: 'https://www.starplus.com/co' },
      ],
    },
    Chile: {
      freeTV:    [],
      paidTV:    ['TNT Sports', 'ESPN', 'DirecTV Sports'],
      streaming: [
        { name: 'Star+',        url: 'https://www.starplus.com/cl' },
        { name: 'TNT Sports Go', url: 'https://www.tntsportsgo.com' },
      ],
    },
    England: {
      freeTV:    ['BBC', 'ITV'],
      paidTV:    ['Sky Sports', 'TNT Sports'],
      streaming: [
        { name: 'NOW',          url: 'https://www.nowtv.com' },
        { name: 'Amazon Prime', url: 'https://www.primevideo.com' },
        { name: 'Discovery+',   url: 'https://www.discoveryplus.com/gb' },
      ],
    },
    Germany: {
      freeTV:    ['ARD', 'ZDF'],
      paidTV:    ['Sky Sports'],
      streaming: [
        { name: 'DAZN',         url: 'https://www.dazn.com/de-DE' },
        { name: 'Sky Go',       url: 'https://www.sky.de/produkte/sky-go' },
      ],
    },
    France: {
      freeTV:    ['TF1', 'France TV'],
      paidTV:    ['Canal+', 'beIN Sports'],
      streaming: [
        { name: 'Canal+',       url: 'https://www.canalplus.com' },
        { name: 'beIN Sports',  url: 'https://www.beinconnect.com/fr' },
      ],
    },
    Italy: {
      freeTV:    ['RAI'],
      paidTV:    ['Sky Sport', 'DAZN canal'],
      streaming: [
        { name: 'DAZN',         url: 'https://www.dazn.com/it-IT' },
        { name: 'Sky Go',       url: 'https://www.sky.it/sky-go' },
      ],
    },
    Portugal: {
      freeTV:    ['RTP'],
      paidTV:    ['Sport TV'],
      streaming: [
        { name: 'Sport TV+',    url: 'https://www.sporttv.pt' },
      ],
    },
  },

  motorsport: {
    Mexico: {
      freeTV:    [],
      paidTV:    ['Fox Sports', 'ESPN', 'TUDN'],
      streaming: [
        { name: 'F1 TV Pro',    url: 'https://f1tv.formula1.com' },
        { name: 'Fox Sports+',  url: 'https://www.foxsports.com.mx' },
        { name: 'ESPN+',        url: 'https://plus.espn.com' },
      ],
    },
    Spain: {
      freeTV:    [],
      paidTV:    ['Movistar F1', 'DAZN canal'],
      streaming: [
        { name: 'DAZN',         url: 'https://www.dazn.com/es-ES' },
        { name: 'F1 TV Pro',    url: 'https://f1tv.formula1.com' },
      ],
    },
    'United States': {
      freeTV:    ['ABC'],
      paidTV:    ['ESPN'],
      streaming: [
        { name: 'ESPN+',        url: 'https://plus.espn.com' },
        { name: 'F1 TV Pro',    url: 'https://f1tv.formula1.com' },
      ],
    },
    Brazil: {
      freeTV:    ['Band', 'Globo'],
      paidTV:    [],
      streaming: [
        { name: 'Globoplay',    url: 'https://globoplay.globo.com' },
        { name: 'F1 TV Pro',    url: 'https://f1tv.formula1.com' },
      ],
    },
    England: {
      freeTV:    ['Channel 4'],
      paidTV:    ['Sky Sports F1'],
      streaming: [
        { name: 'NOW',          url: 'https://www.nowtv.com' },
        { name: 'F1 TV Pro',    url: 'https://f1tv.formula1.com' },
      ],
    },
    Germany: {
      freeTV:    ['RTL'],
      paidTV:    ['Sky Sport F1'],
      streaming: [
        { name: 'DAZN',         url: 'https://www.dazn.com/de-DE' },
        { name: 'F1 TV Pro',    url: 'https://f1tv.formula1.com' },
      ],
    },
    France: {
      freeTV:    ['C8'],
      paidTV:    ['Canal+'],
      streaming: [
        { name: 'Canal+',       url: 'https://www.canalplus.com' },
        { name: 'F1 TV Pro',    url: 'https://f1tv.formula1.com' },
      ],
    },
    Italy: {
      freeTV:    [],
      paidTV:    ['Sky Sport F1'],
      streaming: [
        { name: 'Sky Go',       url: 'https://www.sky.it/sky-go' },
        { name: 'NOW',          url: 'https://www.nowtv.com/it' },
        { name: 'F1 TV Pro',    url: 'https://f1tv.formula1.com' },
      ],
    },
    Netherlands: {
      freeTV:    [],
      paidTV:    ['Viaplay canal', 'Ziggo Sport'],
      streaming: [
        { name: 'Viaplay',      url: 'https://viaplay.com/nl-nl' },
        { name: 'F1 TV Pro',    url: 'https://f1tv.formula1.com' },
      ],
    },
    Argentina: {
      freeTV:    [],
      paidTV:    ['ESPN', 'Fox Sports'],
      streaming: [
        { name: 'Star+',        url: 'https://www.starplus.com/ar' },
        { name: 'F1 TV Pro',    url: 'https://f1tv.formula1.com' },
      ],
    },
  },

  basketball: {
    Mexico: {
      freeTV:    [],
      paidTV:    ['ESPN', 'TUDN'],
      streaming: [
        { name: 'NBA League Pass', url: 'https://www.nba.com/league-pass' },
        { name: 'Star+',           url: 'https://www.starplus.com/mx' },
      ],
    },
    Spain: {
      freeTV:    [],
      paidTV:    ['Movistar+', 'DAZN canal'],
      streaming: [
        { name: 'NBA League Pass', url: 'https://www.nba.com/league-pass' },
        { name: 'DAZN',            url: 'https://www.dazn.com/es-ES' },
      ],
    },
    'United States': {
      freeTV:    ['ABC'],
      paidTV:    ['ESPN', 'TNT', 'NBA TV'],
      streaming: [
        { name: 'NBA League Pass', url: 'https://www.nba.com/league-pass' },
        { name: 'Peacock',         url: 'https://www.peacocktv.com' },
        { name: 'Max',             url: 'https://www.max.com' },
      ],
    },
    Argentina: {
      freeTV:    [],
      paidTV:    ['ESPN', 'TyC Sports'],
      streaming: [
        { name: 'NBA League Pass', url: 'https://www.nba.com/league-pass' },
        { name: 'Star+',           url: 'https://www.starplus.com/ar' },
      ],
    },
    Brazil: {
      freeTV:    [],
      paidTV:    ['ESPN', 'Band Sports'],
      streaming: [
        { name: 'NBA League Pass', url: 'https://www.nba.com/league-pass' },
        { name: 'Star+',           url: 'https://www.starplus.com/br' },
      ],
    },
    England: {
      freeTV:    [],
      paidTV:    ['Sky Sports'],
      streaming: [
        { name: 'NBA League Pass', url: 'https://www.nba.com/league-pass' },
        { name: 'NOW',             url: 'https://www.nowtv.com' },
      ],
    },
    Germany: {
      freeTV:    [],
      paidTV:    ['MagentaSport canal', 'ProSieben'],
      streaming: [
        { name: 'NBA League Pass', url: 'https://www.nba.com/league-pass' },
        { name: 'MagentaSport',    url: 'https://www.magentatv.de' },
      ],
    },
  },

  'american football': {
    Mexico: {
      freeTV:    [],
      paidTV:    ['ESPN', 'Fox Sports'],
      streaming: [
        { name: 'NFL Game Pass', url: 'https://www.nfl.com/nfl-plus' },
        { name: 'ESPN+',         url: 'https://plus.espn.com' },
        { name: 'Paramount+',    url: 'https://www.paramountplus.com/mx' },
      ],
    },
    'United States': {
      freeTV:    ['CBS', 'Fox', 'NBC', 'ABC'],
      paidTV:    ['ESPN', 'Amazon Prime'],
      streaming: [
        { name: 'NFL+',          url: 'https://www.nfl.com/nfl-plus' },
        { name: 'Peacock',       url: 'https://www.peacocktv.com' },
        { name: 'Paramount+',    url: 'https://www.paramountplus.com' },
        { name: 'Amazon Prime',  url: 'https://www.primevideo.com' },
      ],
    },
    England: {
      freeTV:    ['ITV', 'Channel 4'],
      paidTV:    ['Sky Sports'],
      streaming: [
        { name: 'DAZN',          url: 'https://www.dazn.com/en-GB' },
        { name: 'NFL Game Pass', url: 'https://www.nfl.com/nfl-plus' },
      ],
    },
    Germany: {
      freeTV:    ['ProSieben', 'Sat.1'],
      paidTV:    ['DAZN canal'],
      streaming: [
        { name: 'DAZN',          url: 'https://www.dazn.com/de-DE' },
        { name: 'NFL Game Pass', url: 'https://www.nfl.com/nfl-plus' },
      ],
    },
    Brazil: {
      freeTV:    [],
      paidTV:    ['ESPN'],
      streaming: [
        { name: 'Star+',         url: 'https://www.starplus.com/br' },
        { name: 'NFL Game Pass', url: 'https://www.nfl.com/nfl-plus' },
      ],
    },
    Canada: {
      freeTV:    ['CTV'],
      paidTV:    ['TSN', 'Sportsnet'],
      streaming: [
        { name: 'TSN Direct',    url: 'https://www.tsn.ca/tsnplus' },
        { name: 'NFL Game Pass', url: 'https://www.nfl.com/nfl-plus' },
      ],
    },
  },

  baseball: {
    Mexico: {
      freeTV:    [],
      paidTV:    ['ESPN', 'Fox Sports'],
      streaming: [
        { name: 'MLB.TV',        url: 'https://www.mlb.com/tv' },
        { name: 'ESPN+',         url: 'https://plus.espn.com' },
      ],
    },
    'United States': {
      freeTV:    ['Fox', 'TBS'],
      paidTV:    ['ESPN', 'MLB Network'],
      streaming: [
        { name: 'MLB.TV',        url: 'https://www.mlb.com/tv' },
        { name: 'Peacock',       url: 'https://www.peacocktv.com' },
        { name: 'Apple TV+',     url: 'https://tv.apple.com' },
      ],
    },
    'Dominican Republic': {
      freeTV:    [],
      paidTV:    ['ESPN Caribbean'],
      streaming: [
        { name: 'MLB.TV',        url: 'https://www.mlb.com/tv' },
      ],
    },
    Japan: {
      freeTV:    ['NHK'],
      paidTV:    ['J Sports'],
      streaming: [
        { name: 'DAZN',          url: 'https://www.dazn.com/ja-JP' },
        { name: 'MLB.TV',        url: 'https://www.mlb.com/tv' },
      ],
    },
    Venezuela: {
      freeTV:    [],
      paidTV:    ['ESPN'],
      streaming: [
        { name: 'MLB.TV',        url: 'https://www.mlb.com/tv' },
        { name: 'Star+',         url: 'https://www.starplus.com/ve' },
      ],
    },
  },

  tennis: {
    Mexico: {
      freeTV:    [],
      paidTV:    ['ESPN', 'Fox Sports'],
      streaming: [
        { name: 'ESPN+',         url: 'https://plus.espn.com' },
        { name: 'Star+',         url: 'https://www.starplus.com/mx' },
        { name: 'Tennis Channel', url: 'https://www.tennischannel.com' },
      ],
    },
    Spain: {
      freeTV:    ['La 1'],
      paidTV:    ['Movistar+', 'DAZN canal'],
      streaming: [
        { name: 'DAZN',          url: 'https://www.dazn.com/es-ES' },
        { name: 'Movistar+',     url: 'https://www.movistarplus.es' },
      ],
    },
    'United States': {
      freeTV:    ['CBS'],
      paidTV:    ['ESPN', 'Tennis Channel'],
      streaming: [
        { name: 'ESPN+',         url: 'https://plus.espn.com' },
        { name: 'Tennis Channel+', url: 'https://www.tennischannel.com' },
      ],
    },
    England: {
      freeTV:    ['BBC'],
      paidTV:    ['Sky Sports', 'Amazon Prime canal'],
      streaming: [
        { name: 'NOW',           url: 'https://www.nowtv.com' },
        { name: 'Amazon Prime',  url: 'https://www.primevideo.com' },
      ],
    },
    France: {
      freeTV:    ['France TV'],
      paidTV:    ['Eurosport canal'],
      streaming: [
        { name: 'Eurosport',     url: 'https://www.eurosport.com/fr' },
        { name: 'Discovery+',    url: 'https://www.discoveryplus.com/fr' },
      ],
    },
    Australia: {
      freeTV:    ['Nine'],
      paidTV:    [],
      streaming: [
        { name: 'Stan Sport',    url: 'https://www.stan.com.au/sport' },
      ],
    },
    Argentina: {
      freeTV:    [],
      paidTV:    ['ESPN', 'DirecTV Sports'],
      streaming: [
        { name: 'Star+',         url: 'https://www.starplus.com/ar' },
        { name: 'ESPN Premium',  url: 'https://www.espn.com.ar' },
      ],
    },
  },

  fighting: {
    Mexico: {
      freeTV:    [],
      paidTV:    ['Fox Sports', 'ESPN'],
      streaming: [
        { name: 'UFC Fight Pass', url: 'https://ufcfightpass.com' },
        { name: 'Star+',          url: 'https://www.starplus.com/mx' },
        { name: 'ESPN+',          url: 'https://plus.espn.com' },
      ],
    },
    'United States': {
      freeTV:    ['ABC'],
      paidTV:    ['ESPN'],
      streaming: [
        { name: 'ESPN+',          url: 'https://plus.espn.com' },
        { name: 'UFC Fight Pass',  url: 'https://ufcfightpass.com' },
      ],
    },
    Spain: {
      freeTV:    [],
      paidTV:    ['DAZN canal'],
      streaming: [
        { name: 'DAZN',           url: 'https://www.dazn.com/es-ES' },
        { name: 'UFC Fight Pass',  url: 'https://ufcfightpass.com' },
      ],
    },
    England: {
      freeTV:    [],
      paidTV:    ['TNT Sports'],
      streaming: [
        { name: 'Discovery+',     url: 'https://www.discoveryplus.com/gb' },
        { name: 'UFC Fight Pass',  url: 'https://ufcfightpass.com' },
      ],
    },
    Brazil: {
      freeTV:    [],
      paidTV:    ['ESPN', 'Band'],
      streaming: [
        { name: 'Star+',          url: 'https://www.starplus.com/br' },
        { name: 'UFC Fight Pass',  url: 'https://ufcfightpass.com' },
      ],
    },
    Australia: {
      freeTV:    [],
      paidTV:    ['ESPN'],
      streaming: [
        { name: 'Kayo Sports',    url: 'https://kayosports.com.au' },
        { name: 'UFC Fight Pass',  url: 'https://ufcfightpass.com' },
      ],
    },
  },

  rugby: {
    England: {
      freeTV:    ['ITV', 'Channel 4', 'BBC'],
      paidTV:    ['Sky Sports'],
      streaming: [
        { name: 'NOW',           url: 'https://www.nowtv.com' },
        { name: 'ITVX',          url: 'https://www.itv.com/watch' },
      ],
    },
    France: {
      freeTV:    ['France TV', 'TF1'],
      paidTV:    ['Canal+'],
      streaming: [
        { name: 'Canal+',        url: 'https://www.canalplus.com' },
        { name: 'France TV',     url: 'https://www.france.tv' },
      ],
    },
    Argentina: {
      freeTV:    [],
      paidTV:    ['ESPN', 'DirecTV Sports'],
      streaming: [
        { name: 'Star+',         url: 'https://www.starplus.com/ar' },
        { name: 'ESPN Premium',  url: 'https://www.espn.com.ar' },
      ],
    },
    Italy: {
      freeTV:    ['RAI Sport'],
      paidTV:    ['DAZN canal'],
      streaming: [
        { name: 'DAZN',          url: 'https://www.dazn.com/it-IT' },
        { name: 'Rai Play',      url: 'https://www.raiplay.it' },
      ],
    },
    Australia: {
      freeTV:    ['Nine'],
      paidTV:    [],
      streaming: [
        { name: 'Stan Sport',    url: 'https://www.stan.com.au/sport' },
      ],
    },
    'New Zealand': {
      freeTV:    [],
      paidTV:    ['Sky Sport canal'],
      streaming: [
        { name: 'Sky Sport Now', url: 'https://skysport.co.nz' },
      ],
    },
  },

  'ice hockey': {
    'United States': {
      freeTV:    ['ABC', 'TBS'],
      paidTV:    ['ESPN', 'TNT'],
      streaming: [
        { name: 'ESPN+',         url: 'https://plus.espn.com' },
        { name: 'Max',           url: 'https://www.max.com' },
        { name: 'Discovery+',    url: 'https://www.discoveryplus.com' },
      ],
    },
    Canada: {
      freeTV:    ['CBC'],
      paidTV:    ['Sportsnet', 'TVA Sports'],
      streaming: [
        { name: 'Sportsnet Now', url: 'https://www.sportsnet.ca/now' },
        { name: 'TVA Sports',    url: 'https://www.tvasports.ca' },
      ],
    },
    Germany: {
      freeTV:    [],
      paidTV:    ['Sport1'],
      streaming: [
        { name: 'DAZN',          url: 'https://www.dazn.com/de-DE' },
        { name: 'MagentaSport',  url: 'https://www.magentatv.de' },
      ],
    },
    Sweden: {
      freeTV:    [],
      paidTV:    ['C More canal', 'Viaplay canal'],
      streaming: [
        { name: 'C More',        url: 'https://www.cmore.se' },
        { name: 'Viaplay',       url: 'https://viaplay.com/se-sv' },
      ],
    },
    Finland: {
      freeTV:    [],
      paidTV:    [],
      streaming: [
        { name: 'Elisa Viihde',  url: 'https://www.elisa.fi/viihde' },
        { name: 'C More',        url: 'https://www.cmore.fi' },
      ],
    },
  },

  volleyball: {
    Brazil: {
      freeTV:    ['Globo'],
      paidTV:    ['SporTV'],
      streaming: [
        { name: 'Globoplay',     url: 'https://globoplay.globo.com' },
      ],
    },
    Italy: {
      freeTV:    ['RAI Sport'],
      paidTV:    ['DAZN canal'],
      streaming: [
        { name: 'DAZN',          url: 'https://www.dazn.com/it-IT' },
        { name: 'Rai Play',      url: 'https://www.raiplay.it' },
      ],
    },
    'United States': {
      freeTV:    ['CBS Sports'],
      paidTV:    [],
      streaming: [
        { name: 'FloVolleyball', url: 'https://www.flovolleyball.tv' },
        { name: 'Paramount+',   url: 'https://www.paramountplus.com' },
      ],
    },
    Germany: {
      freeTV:    [],
      paidTV:    ['Sport1'],
      streaming: [
        { name: 'DAZN',          url: 'https://www.dazn.com/de-DE' },
      ],
    },
    Poland: {
      freeTV:    [],
      paidTV:    ['Polsat Sport'],
      streaming: [
        { name: 'Polsat Box Go', url: 'https://polsatboxgo.pl' },
      ],
    },
    Mexico: {
      freeTV:    [],
      paidTV:    ['ESPN'],
      streaming: [
        { name: 'Star+',         url: 'https://www.starplus.com/mx' },
      ],
    },
  },
}

// Normaliza el nombre del deporte que viene del backend
export function normalizeSport(sport) {
  if (!sport) return null
  const s = sport.toLowerCase()
  if (s.includes('soccer') || (s.includes('football') && !s.includes('american'))) return 'football'
  if (s.includes('american')) return 'american football'
  if (s.includes('basket'))   return 'basketball'
  if (s.includes('motor') || s.includes('f1') || s.includes('formula')) return 'motorsport'
  if (s.includes('baseball')) return 'baseball'
  if (s.includes('tennis'))   return 'tennis'
  if (s.includes('fight') || s.includes('combat') || s.includes('ufc') || s.includes('box')) return 'fighting'
  if (s.includes('rugby'))    return 'rugby'
  if (s.includes('hockey'))   return 'ice hockey'
  if (s.includes('volei') || s.includes('volleyball')) return 'volleyball'
  return s
}

export const AVAILABLE_COUNTRIES = [
  'Mexico', 'Spain', 'United States', 'Argentina', 'Brazil',
  'Colombia', 'Chile', 'Peru', 'Uruguay', 'Venezuela',
  'England', 'Germany', 'France', 'Italy', 'Portugal',
  'Netherlands', 'Canada', 'Australia', 'Japan',
  'Dominican Republic', 'New Zealand', 'Sweden', 'Finland', 'Poland',
]