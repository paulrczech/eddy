// On-device diagnostic log for hard-to-reproduce bugs (audio dropping out after the
// screen locks, during a long loop session, etc.) — these happen on a real phone during
// normal use, not at a desk with devtools open, so console.log alone isn't reachable
// after the fact. Entries persist to localStorage (survives the app being killed, not
// just backgrounded) and can be exported via the native share sheet from AboutModal.vue,
// using the exact same Filesystem+Share plumbing MIDI/WAV export already use
// (saveAndShareBytes() in fileExport.ts) — no new native capability needed.
//
// Deliberately just a flat, capped list, not a fancy structured store: the point is "send
// Paul can tap export, attach the result to a message" — Claude reads the raw text,
// no viewer UI to build or maintain.

const STORAGE_KEY = 'eddy_diag_log'
const MAX_ENTRIES = 400

interface DiagEntry {
  t: string // ISO timestamp
  event: string
  data?: Record<string, unknown>
}

function load(): DiagEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as DiagEntry[]) : []
  } catch {
    return []
  }
}

let entries: DiagEntry[] = load()

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Storage full/unavailable — logging is best-effort and must never interrupt
    // playback or throw into a caller that isn't expecting it.
  }
}

export function logDiag(event: string, data?: Record<string, unknown>): void {
  entries.push({ t: new Date().toISOString(), event, data })
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES)
  persist()
}

export function getDiagLogText(): string {
  if (entries.length === 0) return 'No diagnostic entries recorded yet.'
  return entries
    .map((e) => `${e.t}  ${e.event}${e.data ? '  ' + JSON.stringify(e.data) : ''}`)
    .join('\n')
}

export function clearDiagLog(): void {
  entries = []
  persist()
}
