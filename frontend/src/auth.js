const STORAGE_KEY = 'fanschedule_user'

export function getUser() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function setUser(user) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
}

export function clearUser() {
  localStorage.removeItem(STORAGE_KEY)
}

export function getUserId() {
  return getUser()?.userId || null
}

export function isLoggedIn() {
  return !!getUserId()
}
