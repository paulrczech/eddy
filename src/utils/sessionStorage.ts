import type { Cluster } from './noteUtils'
import { clusterLabel } from './noteUtils'
import type { InstrumentType, ArpeggioDirection, Subdivision, TimeSignature } from '../stores/settingsStore'
import type { Pool } from '../stores/sequenceStore'

export interface SavedSession {
  id: string
  name: string
  savedAt: number       // Unix ms timestamp
  sequence: Cluster[]
  voiceCount: number
  instrument?: InstrumentType  // optional for backwards compat with older saves
  tempo?: number                        // optional — older saves predate these four
  arpeggioDirection?: ArpeggioDirection
  subdivision?: Subdivision
  latchMode?: boolean
  ambience?: number
  timeSignature?: TimeSignature
  pools?: Pool[]         // optional — older saves predate pools entirely
}

const STORAGE_KEY = 'note-threader-sessions'

function loadAll(): SavedSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveAll(sessions: SavedSession[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
}

export function listSessions(): SavedSession[] {
  return loadAll().sort((a, b) => b.savedAt - a.savedAt)
}

// Default save name derived from the session's starting notes — "eddy-A.D.G.C",
// numbered from 1 whenever the same starting cluster has been saved before.
function nextSessionName(sequence: Cluster[], sessions: SavedSession[]): string {
  const base = `eddy-${clusterLabel(sequence[0])}`
  const existingNames = new Set(sessions.map(s => s.name))
  let n = 1
  while (existingNames.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

export function saveSession(
  sequence: Cluster[],
  voiceCount: number,
  instrument?: InstrumentType,
  name?: string,
  tempo?: number,
  arpeggioDirection?: ArpeggioDirection,
  subdivision?: Subdivision,
  latchMode?: boolean,
  ambience?: number,
  timeSignature?: TimeSignature,
  pools?: Pool[]
): SavedSession {
  const sessions = loadAll()
  const session: SavedSession = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name ?? nextSessionName(sequence, sessions),
    savedAt: Date.now(),
    sequence,
    voiceCount,
    instrument,
    tempo,
    arpeggioDirection,
    subdivision,
    latchMode,
    ambience,
    timeSignature,
    pools,
  }
  sessions.push(session)
  saveAll(sessions)
  return session
}

export function overwriteSession(
  id: string,
  sequence: Cluster[],
  voiceCount: number,
  instrument?: InstrumentType,
  tempo?: number,
  arpeggioDirection?: ArpeggioDirection,
  subdivision?: Subdivision,
  latchMode?: boolean,
  ambience?: number,
  timeSignature?: TimeSignature,
  pools?: Pool[]
): SavedSession | null {
  const sessions = loadAll()
  const target = sessions.find(s => s.id === id)
  if (!target) return null
  target.sequence = sequence
  target.voiceCount = voiceCount
  target.instrument = instrument
  target.tempo = tempo
  target.arpeggioDirection = arpeggioDirection
  target.subdivision = subdivision
  target.latchMode = latchMode
  target.ambience = ambience
  target.timeSignature = timeSignature
  target.pools = pools
  target.savedAt = Date.now()
  saveAll(sessions)
  return target
}

export function deleteSession(id: string): void {
  const sessions = loadAll().filter(s => s.id !== id)
  saveAll(sessions)
}

export function clearAllSessions(): void {
  saveAll([])
}

export function renameSession(id: string, name: string): void {
  const sessions = loadAll()
  const target = sessions.find(s => s.id === id)
  if (target) {
    target.name = name
    saveAll(sessions)
  }
}
