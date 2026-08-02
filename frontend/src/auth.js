const STORAGE_KEY = 'fanschedule_user'
// Token de sesión opaco que emite el backend en el callback de OAuth. Todavía NO se manda en
// ninguna petición: esta etapa solo lo captura y lo guarda (fase A4, etapa A).
const TOKEN_KEY = 'fanschedule_token'

export function getUser() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function setUser(user) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
}

// Cierra la sesión por completo: el usuario Y el token. Los dos sitios que llaman a esto son los
// botones de "cerrar sesión" (Sidebar y Profile), así que dejar el token vivo ahí sería dejar una
// credencial de 90 días en el navegador de alguien que acaba de salirse.
export function clearUser() {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(TOKEN_KEY)
}

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || null
  } catch { return null }
}

export function setToken(token) {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch { /* modo privado sin storage: se sigue sin token, cae al camino legacy */ }
}

export function getUserId() {
  return getUser()?.userId || null
}

export function isLoggedIn() {
  return !!getUserId()
}
