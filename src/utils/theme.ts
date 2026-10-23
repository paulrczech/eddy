import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'

export type ThemePref = 'dark' | 'light' | 'system'
export type EffectiveTheme = 'dark' | 'light'

const KEY = 'eddy-theme'
const query = () => window.matchMedia('(prefers-color-scheme: dark)')

export function loadThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'dark' || v === 'light' || v === 'system') return v
  } catch {
    // storage blocked — fall through to the default
  }
  return 'dark'
}

export function saveThemePref(pref: ThemePref) {
  try { localStorage.setItem(KEY, pref) } catch { /* ignore */ }
}

export function resolveTheme(pref: ThemePref): EffectiveTheme {
  if (pref === 'system') return query().matches ? 'dark' : 'light'
  return pref
}

// Sets the tokens' theme (data-theme, read by variables.css) and Ionic's own palette
// class together, so Ionic's internals (pickers, action sheets) never disagree with ours.
// The status bar follows on native: Style.Dark means light glyphs, for a dark app.
export function applyTheme(pref: ThemePref) {
  const theme = resolveTheme(pref)
  const root = document.documentElement
  root.dataset.theme = theme
  root.classList.toggle('ion-palette-dark', theme === 'dark')
  if (Capacitor.isNativePlatform()) {
    StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light }).catch(() => {})
  }
}

// While the preference is 'system', follow the OS live. Returns an unsubscribe.
export function watchSystemTheme(getPref: () => ThemePref): () => void {
  const q = query()
  const onChange = () => { if (getPref() === 'system') applyTheme('system') }
  q.addEventListener('change', onChange)
  return () => q.removeEventListener('change', onChange)
}
