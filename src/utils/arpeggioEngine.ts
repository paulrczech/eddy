// Shared note-scheduling logic for arpeggiating a cluster — direction ordering, latch's
// "repeat to fill the bar" behavior, and the beat-to-seconds conversion. Deliberately
// framework/audio-library free (no Tone.js import) so it can be used identically by live
// playback (useAudioEngine.ts, scheduling into Tone.Part/triggerAttackRelease) and MIDI
// export (midiUtils.ts, writing note-on/note-off pairs) without either one drifting out
// of sync with the other — which is exactly what had happened before this file existed:
// MIDI export had its own separate, latch-unaware reimplementation of arpeggio ordering.
import type { Cluster } from './noteUtils'
import type { ArpeggioDirection, Subdivision, InstrumentType } from '../stores/settingsStore'
import {
  VELOCITY_PATTERNS,
  FAMILY_LEVELS,
  INSTRUMENT_LEVELS,
  VELOCITY_FAMILY,
  type VelocityPattern,
} from '../data/velocityPatterns'

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

// Accent patterns (src/data/velocityPatterns.ts) — a player's loud/medium/soft shape over
// the arpeggio, replacing random jitter. Off = every note at the flat base velocity again.
const ENABLE_VELOCITY_PATTERNS = true

// Moving-voice accent: when a chord follows another, the voice(s) that moved lean forward
// and (chord playback only) the held voices sit back — the voice movement is the music in
// Eddy, so it should be audible. Deliberately its own flag, separate from the patterns.
//  - Arpeggios: a small boost (well under the 0.2 steps between L/M/S, so it can't reorder
//    them) on the *first* time each moved voice sounds in the cluster — the arrival of the
//    new note — leaving every repeat to the pattern so the groove isn't fought.
//  - Chord direction (no pattern, and what pads always play): the main phrasing tool, so
//    stronger — moved voices up, held voices down.
// Skipped when nothing moved or every voice moved (parallel motion: the boost would cancel
// out), and when there's no previous chord (a flow's first chord, a lone audition).
const ENABLE_MOVING_VOICE_ACCENT = true
const MOVING_VOICE = { arpeggioBoost: 0.05, chordBoost: 0.1, chordHeld: -0.05 }

// Humanization within a level: a performer never plays every "loud" note at exactly the
// same volume. Each patterned note gets a small random nudge — ±0.03, a fraction of the
// 0.2 steps between L/M/S, so it never changes which level a note reads as — rolled fresh
// at the moment the note is triggered (every pass of the arpeggio, every trip round the
// loop), not baked into the schedule. Only for notes a pattern shaped: flat instruments
// stay flat, since uncorrelated jitter on a flat line is what sounded sloppy before.
const ENABLE_VELOCITY_JITTER = true
const VELOCITY_JITTER = 0.03
// Which voices get it. A/B (Paul, 2026-10-21): 'lowest' = only the bottom voice — the one
// whose loud accents were jarring — with the upper voices exactly on their level; 'all' =
// every patterned note.
const JITTER_VOICES: 'lowest' | 'all' = 'all'

export function humanizeVelocity(velocity: number): number {
  if (!ENABLE_VELOCITY_JITTER) return velocity
  return Math.min(1, Math.max(0.3, velocity + (Math.random() * 2 - 1) * VELOCITY_JITTER))
}

export interface VelocityContext {
  cluster?: number[] // this cluster's voices, ascending — needed with previousCluster
  previousCluster?: number[] // the chord just before it in playback order; same voice count
  instrument?: InstrumentType
  direction: ArpeggioDirection
  beatsPerBar: number
  subdivision: number // notes per beat — slots in a bar = beatsPerBar * subdivision
  seed: number // per-flow, saved with it: picks among the eligible patterns
}

// Patterns that can play right now. A 'pass' pattern needs its cell to equal the pass
// length; a 'bar' pattern needs its cell to divide the bar's slots. If nothing qualifies,
// 'pass' patterns may tile the bar instead, so odd grids still get a groove where possible.
function eligiblePatterns(ctx: VelocityContext, passLength: number): VelocityPattern[] {
  const family = ctx.instrument && VELOCITY_FAMILY[ctx.instrument]
  if (!family || ctx.direction === 'chord') return []
  const meter = ctx.beatsPerBar === 3 ? '3/4' : '4/4'
  const slots = ctx.beatsPerBar * ctx.subdivision
  const slotsOk = Number.isInteger(slots) && slots >= 2
  const mine = VELOCITY_PATTERNS.filter(p => p.family === family && p.meter === meter)
  // Random order keeps the bottom voice first and shuffles the rest, so only the voice-style
  // ('pass') patterns make sense: they put the accent on the bass whichever way the upper
  // voices fall. A cell longer than the chord just uses its first letters. (Paul, 2026-10-21;
  // with no such pattern for this meter/voice count, the usual rules below apply.)
  if (ctx.direction === 'random') {
    const passOnly = mine.filter(p => p.anchor === 'pass')
    const fitting = passOnly.filter(p => p.cell.length >= passLength)
    // none long enough (4 voices in 3/4, whose voice cells are 3 long): the cell repeats
    if (fitting.length > 0 || passOnly.length > 0) return fitting.length > 0 ? fitting : passOnly
  }
  const tiles = (p: VelocityPattern) => slotsOk && slots % p.cell.length === 0
  const direct = mine.filter(p => (p.anchor === 'pass' ? p.cell.length === passLength : tiles(p)))
  if (direct.length > 0) return direct
  return mine.filter(p => p.anchor === 'pass' && tiles(p))
}

// The pattern a flow plays with right now (null = flat).
export function pickVelocityPattern(ctx: VelocityContext, passLength: number): VelocityPattern | null {
  if (!ENABLE_VELOCITY_PATTERNS) return null
  const eligible = eligiblePatterns(ctx, passLength)
  if (eligible.length === 0) return null
  return eligible[Math.abs(Math.floor(ctx.seed)) % eligible.length]
}

// Velocity for every note of every event (one event = one pass of the arpeggio, as
// buildClusterEvents returns them), aligned with `velocities[i][j]`. `jitter[i][j]` says that
// note should go through humanizeVelocity() as it's triggered (a pattern shaped it, and it's
// one of the voices JITTER_VOICES allows). `interval` is the
// seconds between notes — used to turn an event's start time back into a bar slot. Falls
// back to humanVelocity() (flat while it's disabled) whenever no pattern applies: chord
// direction, an instrument without a family, or a grid nothing tiles.
export function velocitiesForEvents(
  events: { time: number; notes: number[] }[],
  interval: number,
  ctx: VelocityContext
): { velocities: number[][]; jitter: boolean[][] } {
  const base = patternVelocities(events, interval, ctx)
  const lowest = ctx.cluster ? Math.min(...ctx.cluster) : Math.min(...events.flatMap(e => e.notes))
  return {
    velocities: applyMovingVoice(base.velocities, events, ctx),
    jitter: events.map(e =>
      e.notes.map(note => base.humanize && (JITTER_VOICES === 'all' || note === lowest))
    ),
  }
}

function patternVelocities(
  events: { time: number; notes: number[] }[],
  interval: number,
  ctx: VelocityContext
): { velocities: number[][]; humanize: boolean } {
  const flat = () => ({
    velocities: events.map(e => e.notes.map((_, i) => humanVelocity(0.72, i, e.notes.length))),
    humanize: false,
  })
  if (!ENABLE_VELOCITY_PATTERNS || events.length === 0 || interval <= 0) return flat()

  const passLength = events[0].notes.length // the first pass is always a full one
  const pattern = pickVelocityPattern(ctx, passLength)
  if (!pattern) return flat()

  const levels = { ...FAMILY_LEVELS[pattern.family], ...(ctx.instrument && INSTRUMENT_LEVELS[ctx.instrument]) }
  const cell = pattern.cell
  const slots = ctx.beatsPerBar * ctx.subdivision
  const byPass =
    pattern.anchor === 'pass' &&
    (cell.length === passLength || ctx.direction === 'random')
  const velocities = events.map(e => {
    const startSlot = Math.round(e.time / interval)
    return e.notes.map((_, i) => {
      const idx = byPass
        ? (ctx.direction === 'down' ? passLength - 1 - i : i % cell.length)
        : ((startSlot + i) % slots) % cell.length
      return levels[cell[idx] as 'L' | 'M' | 'S']
    })
  })
  return { velocities, humanize: true }
}

function applyMovingVoice(
  velocities: number[][],
  events: { time: number; notes: number[] }[],
  ctx: VelocityContext
): number[][] {
  const { cluster, previousCluster } = ctx
  if (!ENABLE_MOVING_VOICE_ACCENT || !cluster || !previousCluster) return velocities
  if (cluster.length !== previousCluster.length) return velocities
  const moved = new Set<number>()
  cluster.forEach((note, v) => {
    if (note !== previousCluster[v]) moved.add(note)
  })
  if (moved.size === 0 || moved.size === cluster.length) return velocities

  const isChord = ctx.direction === 'chord'
  const arrived = new Set<number>()
  return velocities.map((pass, k) =>
    pass.map((vel, i) => {
      const note = events[k].notes[i]
      let delta = 0
      if (moved.has(note)) {
        if (isChord) delta = MOVING_VOICE.chordBoost
        else if (!arrived.has(note)) delta = MOVING_VOICE.arpeggioBoost
        arrived.add(note)
      } else if (isChord) {
        delta = MOVING_VOICE.chordHeld
      }
      return Math.min(1, Math.max(0.3, vel + delta))
    })
  )
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
    case 'random': {
      // Bottom voice anchors the pattern — shuffling it in with the rest let the lowest
      // note (the one that grounds the ear's sense of the cluster) land anywhere,
      // including last, which read as too chaotic. Only the upper voices randomize.
      const [bottom, ...rest] = sorted
      return [bottom, ...rest.sort(() => Math.random() - 0.5)]
    }
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
