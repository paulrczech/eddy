// Shared note-scheduling logic for arpeggiating a cluster — direction ordering, latch's
// "repeat to fill the bar" behavior, and the beat-to-seconds conversion. Deliberately
// framework/audio-library free (no Tone.js import) so it can be used identically by live
// playback (useAudioEngine.ts, scheduling into Tone.Part/triggerAttackRelease) and MIDI
// export (midiUtils.ts, writing note-on/note-off pairs) without either one drifting out
// of sync with the other — which is exactly what had happened before this file existed:
// MIDI export had its own separate, latch-unaware reimplementation of arpeggio ordering.
import type { Cluster } from './noteUtils'
import type { ArpeggioDirection, Subdivision } from '../stores/settingsStore'

export function intervalFromBpm(bpm: number, subdivision: Subdivision = 4): number {
  return 60 / bpm / subdivision
}

// Started as a diagnostic toggle to isolate whether the VSCO2 piano's low-register
// "jarring" issue was caused by the random jitter or something else — turned out every
// instrument sounded better completely flat (no jitter, no arpeggio-position taper
// either), not just VSCO2, so Paul kept it off app-wide (2026-09-30), a deliberate
// decision, not just an unresolved test. Affects every instrument — humanVelocity() is
// shared, no per-instrument hook exists. If this ever comes back, the real version is
// the "Humanize" dial logged in DOWNRIVER.md — a dial, not just on/off, so a quieter
// jitter could solve VSCO2's original issue without flattening every instrument's feel.
const DISABLE_HUMANIZATION = true

// Humanized velocity — base with slight random variation and arpeggio position taper,
// currently disabled app-wide via DISABLE_HUMANIZATION above (every note plays at a flat
// baseVelocity). The jitter/taper logic stays in place rather than being deleted, since
// this was a deliberate "off for now" call, not a decision that the mechanism was wrong.
export function humanVelocity(baseVelocity: number, noteIdx: number, totalNotes: number): number {
  if (DISABLE_HUMANIZATION) return baseVelocity
  const jitter = (Math.random() - 0.5) * 0.24  // ±12% random humanization
  const taper = noteIdx === 0 ? 0 : -0.06 * (noteIdx / Math.max(totalNotes - 1, 1))
  return Math.min(1, Math.max(0.3, baseVelocity + jitter + taper))
}

export function buildArpeggioNotes(cluster: number[], direction: ArpeggioDirection): number[] {
  const sorted = [...cluster].sort((a, b) => a - b)
  switch (direction) {
    case 'up':
    case 'chord':
      return sorted
    case 'down':
      return [...sorted].reverse()
    case 'updown': {
      const inner = sorted.slice(1, sorted.length - 1).reverse()
      return [...sorted, ...inner]
    }
    case 'random':
      return [...sorted].sort(() => Math.random() - 0.5)
    default:
      return sorted
  }
}

// Latch: repeat the arpeggio to fill the whole bar instead of playing through once and
// resting for the remainder — the default "runs once per measure" feel. Returns events
// with `time` relative to the start of this one cluster; callers offset by the cluster's
// own position in the sequence. 'chord' direction is unaffected regardless of latch: its
// interval is near-zero/zero (a simultaneous stab, or a live-only guitar strum — see
// chordInterval() in useAudioEngine.ts, which is deliberately NOT part of this shared
// module since it's a live-playback-only articulation choice), so "how many times does
// one pass fit in the bar" is meaningless there.
export function buildClusterEvents(
  cluster: Cluster,
  direction: ArpeggioDirection,
  interval: number,
  clusterDuration: number,
  latch: boolean
): { time: number; notes: number[] }[] {
  if (direction === 'chord' || !latch) {
    return [{ time: 0, notes: buildArpeggioNotes(cluster, direction) }]
  }
  const notes = buildArpeggioNotes(cluster, direction)
  const patternDuration = notes.length * interval
  if (patternDuration <= 0) return [{ time: 0, notes }]
  const repeats = Math.max(1, Math.floor(clusterDuration / patternDuration))
  const events = Array.from({ length: repeats }, (_, r) => ({
    time: r * patternDuration,
    // Rebuilt per repeat rather than reusing `notes` — a no-op for the deterministic
    // directions (up/down/updown), but gives 'random' a fresh shuffle each pass, which
    // is what a real latched arpeggiator would do.
    notes: r === 0 ? notes : buildArpeggioNotes(cluster, direction),
  }))

  // Whole passes don't always divide the bar evenly (e.g. a 3-note cluster at 8th notes
  // fits 2 full passes with a quarter-note gap left over) — rather than resting through
  // that leftover time, play as many notes of one more pass as actually fit. A small
  // float-precision epsilon guards against e.g. 0.599999999s reading as "no room" for a
  // note that should exactly fit.
  const remaining = clusterDuration - repeats * patternDuration
  const extraNoteCount = Math.floor((remaining + 1e-9) / interval)
  if (extraNoteCount > 0) {
    events.push({
      time: repeats * patternDuration,
      notes: buildArpeggioNotes(cluster, direction).slice(0, extraNoteCount),
    })
  }
  return events
}
