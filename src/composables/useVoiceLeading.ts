import { Strategy } from '../data/strategies'
import { getScaleNotes } from '../data/scales'
import { MIDI_MIN, MIDI_MAX } from '../data/notes'
import {
  Cluster,
  sortCluster,
  isValidCluster,
  mostDissonantVoiceIndex,
  reachableNotes,
  deduplicateClusters,
} from '../utils/noteUtils'

export interface VoiceLeadingOptions {
  keyLockActive: boolean
  keyRoot?: number        // MIDI root note (pitch class only used)
  scaleId?: string        // scale id from scales.ts
}

const MAX_CANDIDATES = 6  // max options returned to the user

// Resolve interval bounds from a movementType string
function intervalBounds(movementType: string): { min: number; max: number } {
  switch (movementType) {
    case 'half':              return { min: 1, max: 1 }
    case 'whole':             return { min: 2, max: 2 }
    case 'step':              return { min: 1, max: 2 }
    case 'group-step':        return { min: 1, max: 2 }
    case 'group-shift':       return { min: 1, max: 3 }  // half step, whole step, minor third
    case 'parallel-quality':  return { min: 1, max: 2 }
    case 'resolve-iv':        return { min: 1, max: 2 }
    case 'third':             return { min: 1, max: 4 }
    case 'tritone':           return { min: 6, max: 6 }
    case 'chromatic-approach':return { min: 1, max: 1 }
    case 'free':              return { min: 1, max: 7 }
    // 'power' allows 0 (a voice already on the root/fifth pitch class can stay) up to a
    // full octave — a small step often lands exactly on an already-occupied voice (e.g.
    // C-E-G: E's nearest root/fifth notes are the existing C and G themselves), and the
    // duplicate-note constraint then rejects every combination; a full octave's reach
    // reliably finds a free root/fifth slot instead. See generatePowerChordCandidates.
    case 'power':             return { min: 0, max: 12 }
    default:                  return { min: 1, max: 2 }
  }
}

// Quality bucket used only to resolve "parallel" (same root, opposite major/minor
// quality) for parallel-mode — Eddy's other scales don't have one canonical parallel,
// so they're bucketed to whichever binary quality they read closest to.
const MINOR_QUALITY_SCALES = new Set([
  'minor', 'dorian', 'phrygian', 'locrian', 'harmonic_minor', 'pentatonic_minor',
])

function parallelScaleId(scaleId: string): string {
  return MINOR_QUALITY_SCALES.has(scaleId) ? 'major' : 'minor'
}

// Determine which voice indices are allowed to move given the strategy rule
function movableVoiceIndices(strategy: Strategy, cluster: Cluster): number[] {
  const n = cluster.length
  const all = Array.from({ length: n }, (_, i) => i)

  switch (strategy.voicesAllowedToMove) {
    case 'all':
      return all
    case 'all-but-one':
      // Will be handled per-candidate: hold each voice in turn
      return all
    case 'one':
      return all  // caller picks one at a time
    case 'two':
      return all  // caller picks two at a time
    case 'top':
      return [n - 1]
    case 'bottom':
      return [0]
    case 'upper':
      return all.slice(1)
    case 'lower':
      return all.slice(0, n - 1)
    case 'most-dissonant-held': {
      const heldIdx = mostDissonantVoiceIndex(cluster)
      return all.filter(i => i !== heldIdx)
    }
    case 'least-expected-held': {
      // Hold a non-outer voice (middle voice in 3-voice; random inner for 4+)
      const innerIndices = all.slice(1, n - 1)
      const heldIdx = innerIndices.length > 0
        ? innerIndices[Math.floor(Math.random() * innerIndices.length)]
        : 1
      return all.filter(i => i !== heldIdx)
    }
    case 'third':
      // Index 1 (second from the bottom) is "the 3rd" regardless of voice count — for a
      // 3-voice cluster this is also the true positional middle; for 4+ it's still the
      // interval a third above the bass, which is what the strategy actually means by
      // "the middle voice." Previously this strategy used the generic 'one' case, which
      // let ANY single voice move — most candidates moved the bass or top instead, only
      // coincidentally touching the middle voice some of the time.
      return n > 1 ? [1] : all

    default:
      return all
  }
}

// Build the set of allowed MIDI notes (full range or scale-filtered)
function buildAllowedNoteSet(
  options: VoiceLeadingOptions,
  bounds: { min: number; max: number }
): Set<number> | undefined {
  if (!options.keyLockActive || !options.scaleId || options.keyRoot === undefined) {
    return undefined  // no restriction
  }
  const notes = getScaleNotes(options.keyRoot, options.scaleId, bounds.min, bounds.max)
  return new Set(notes)
}

// Generate candidate clusters for strategies where exactly one voice moves
function generateSingleVoiceCandidates(
  cluster: Cluster,
  strategy: Strategy,
  allowedNotes: Set<number> | undefined,
  bounds: { min: number; max: number }
): Cluster[] {
  const { min, max } = intervalBounds(strategy.movementType)
  const candidates: Cluster[] = []
  const movable = movableVoiceIndices(strategy, cluster)

  for (const voiceIdx of movable) {
    const targets = reachableNotes(cluster[voiceIdx], min, max, allowedNotes, bounds)
    for (const target of targets) {
      const newCluster = [...cluster]
      newCluster[voiceIdx] = target
      const sorted = sortCluster(newCluster)
      if (isValidCluster(sorted, bounds)) {
        candidates.push(sorted)
      }
    }
  }
  return candidates
}

// Generate candidates where all voices move together by the same interval, in the same
// direction — cluster shape is preserved, just transposed. One candidate per (interval
// size, direction) pair, so a movementType with a range (e.g. 'group-shift', half step
// through minor third) offers a few shift sizes rather than just one.
function generateAllVoiceSameDirection(
  cluster: Cluster,
  strategy: Strategy,
  allowedNotes: Set<number> | undefined,
  bounds: { min: number; max: number }
): Cluster[] {
  const { min, max } = intervalBounds(strategy.movementType)
  const candidates: Cluster[] = []

  for (let step = min; step <= max; step++) {
    for (const dir of [1, -1]) {
      const newCluster = cluster.map(note => note + dir * step)
      const sorted = sortCluster(newCluster)
      if (isValidCluster(sorted, bounds)) {
        if (!allowedNotes || newCluster.every(n => allowedNotes.has(n))) {
          candidates.push(sorted)
        }
      }
    }
  }
  return candidates
}

// Generate candidates where every voice moves independently by step — no voice held,
// no shared interval (contrast with generateAllVoiceSameDirection, which forces one
// uniform interval so the cluster's shape is preserved). Each voice picks its own
// reachable target within `allowedNotes`, if given.
function generateAllVoicesIndependentCandidates(
  cluster: Cluster,
  strategy: Strategy,
  allowedNotes: Set<number> | undefined,
  bounds: { min: number; max: number }
): Cluster[] {
  const { min, max } = intervalBounds(strategy.movementType)
  const targetSets = cluster.map(note => reachableNotes(note, min, max, allowedNotes, bounds))
  const combos = cartesianProduct(targetSets)

  const candidates: Cluster[] = []
  for (const combo of combos) {
    const sorted = sortCluster(combo)
    if (isValidCluster(sorted, bounds)) {
      candidates.push(sorted)
    }
  }
  return candidates
}

// Generate candidates that collapse the cluster toward root + fifth (power-chord special
// case). The bass voice is treated as the root and held fixed; every voice above it
// independently steps to the nearest note whose pitch class matches the root or the
// fifth above it.
function generatePowerChordCandidates(cluster: Cluster, bounds: { min: number; max: number }): Cluster[] {
  const { min, max } = intervalBounds('power')
  const root = cluster[0]
  const rootPc = root % 12
  const fifthPc = (rootPc + 7) % 12

  const targetNotes = new Set<number>()
  for (let midi = bounds.min; midi <= bounds.max; midi++) {
    const pc = midi % 12
    if (pc === rootPc || pc === fifthPc) targetNotes.add(midi)
  }

  const movingIndices = cluster.map((_, i) => i).slice(1)
  const targetSets = movingIndices.map(idx => reachableNotes(cluster[idx], min, max, targetNotes, bounds))
  const combos = cartesianProduct(targetSets)

  const candidates: Cluster[] = []
  for (const combo of combos) {
    const newCluster = [...cluster]
    movingIndices.forEach((voiceIdx, i) => { newCluster[voiceIdx] = combo[i] })
    const sorted = sortCluster(newCluster)
    if (isValidCluster(sorted, bounds)) {
      candidates.push(sorted)
    }
  }
  return candidates
}

// Generate candidates where one voice is held and all others move (all-but-one)
function generateAllButOneCandidates(
  cluster: Cluster,
  strategy: Strategy,
  allowedNotes: Set<number> | undefined,
  bounds: { min: number; max: number }
): Cluster[] {
  const { min, max } = intervalBounds(strategy.movementType)
  const n = cluster.length
  const candidates: Cluster[] = []

  // Try holding each voice in turn
  for (let heldIdx = 0; heldIdx < n; heldIdx++) {
    const movingIndices = Array.from({ length: n }, (_, i) => i).filter(i => i !== heldIdx)

    // Generate all combinations of target notes for moving voices
    const targetSets: number[][] = movingIndices.map(idx =>
      reachableNotes(cluster[idx], min, max, allowedNotes, bounds)
    )

    // Cartesian product of target sets (bounded — movingIndices.length is small)
    const combos = cartesianProduct(targetSets)
    for (const combo of combos) {
      const newCluster = [...cluster]
      movingIndices.forEach((voiceIdx, i) => {
        newCluster[voiceIdx] = combo[i]
      })
      const sorted = sortCluster(newCluster)
      if (isValidCluster(sorted, bounds)) {
        candidates.push(sorted)
      }
    }
  }
  return candidates
}

// Cartesian product of arrays — used for multi-voice movement
function cartesianProduct(arrays: number[][]): number[][] {
  if (arrays.length === 0) return [[]]
  return arrays.reduce<number[][]>(
    (acc, arr) => acc.flatMap(combo => arr.map(val => [...combo, val])),
    [[]]
  )
}

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5)
}

// Select a random subset of candidates when there are too many, biased so options that
// move an outer voice (top or bottom) aren't crowded out by chance. A strategy can
// generate far more inner-voice-only candidates than outer-voice ones, and outer-voice
// movement is what actually changes the cluster's register/spread — the more audible,
// interesting change. Reserve up to half the slots for the outer-voice pool (when it has
// enough to fill them) before filling the rest randomly from whatever's left.
function sampleCandidates(candidates: Cluster[], max: number, baseline: Cluster): Cluster[] {
  if (candidates.length <= max) return candidates

  const topIdx = baseline.length - 1
  const touchesOuterVoice = (c: Cluster) => c[0] !== baseline[0] || c[topIdx] !== baseline[topIdx]

  const outerPool = shuffle(candidates.filter(touchesOuterVoice))
  const innerPool = shuffle(candidates.filter(c => !touchesOuterVoice(c)))

  const outerQuota = Math.min(Math.ceil(max / 2), outerPool.length)
  const picked = outerPool.slice(0, outerQuota)
  const rest = shuffle([...outerPool.slice(outerQuota), ...innerPool])
  picked.push(...rest.slice(0, max - picked.length))

  return shuffle(picked)
}

// Main export: given current cluster + strategy + options, return candidate clusters
export function generateCandidates(
  cluster: Cluster,
  strategy: Strategy,
  options: VoiceLeadingOptions
): Cluster[] {
  // Skip key-lock-required strategies if key lock is not active
  if (strategy.requiresKeyLock && !options.keyLockActive) {
    return []
  }

  // Widen the global range just enough to cover the current cluster's own register —
  // otherwise a session started outside [MIDI_MIN, MIDI_MAX] (piano's wider picker
  // range) strands every voice with zero reachable notes. Reduces to the plain global
  // range whenever the cluster is already inside it, so ordinary sessions are unaffected.
  const bounds = {
    min: Math.min(MIDI_MIN, ...cluster),
    max: Math.max(MIDI_MAX, ...cluster),
  }

  const allowedNotes = buildAllowedNoteSet(options, bounds)
  let candidates: Cluster[] = []

  switch (strategy.voicesAllowedToMove) {
    case 'all':
      if (strategy.movementType === 'half' || strategy.movementType === 'whole' || strategy.movementType === 'group-shift' || strategy.movementType === 'tritone') {
        // uniform interval, same for every voice — shape preserved, just transposed.
        // For 'tritone': under key lock this naturally restricts to voices sitting on
        // scale degrees 4 or 7, the two notes that actually share a tritone within a
        // diatonic scale — the harmonic basis of a real tritone substitution.
        candidates = generateAllVoiceSameDirection(cluster, strategy, allowedNotes, bounds)
      } else if (strategy.movementType === 'group-step') {
        // every voice moves independently by step, filtered to the current scale (the
        // relative major/minor of a diatonic mode shares the exact same notes, so no
        // separate scale lookup is needed — see relative-shift in strategies.ts)
        candidates = generateAllVoicesIndependentCandidates(cluster, strategy, allowedNotes, bounds)
      } else if (strategy.movementType === 'parallel-quality') {
        // every voice moves independently by step, filtered to the PARALLEL scale
        // (same root, opposite major/minor quality) rather than the current one
        const parallelNotes = options.keyRoot !== undefined
          ? new Set(getScaleNotes(options.keyRoot, parallelScaleId(options.scaleId ?? 'major'), bounds.min, bounds.max))
          : undefined
        candidates = generateAllVoicesIndependentCandidates(cluster, strategy, parallelNotes, bounds)
      } else if (strategy.movementType === 'resolve-iv') {
        // every voice moves independently by step, filtered to the scale rooted a
        // fourth above the current key (the IV/subdominant) rather than the tonic
        const ivNotes = options.keyRoot !== undefined
          ? new Set(getScaleNotes(options.keyRoot + 5, options.scaleId ?? 'major', bounds.min, bounds.max))
          : undefined
        candidates = generateAllVoicesIndependentCandidates(cluster, strategy, ivNotes, bounds)
      } else if (strategy.movementType === 'power') {
        candidates = generatePowerChordCandidates(cluster, bounds)
      } else {
        candidates = generateSingleVoiceCandidates(cluster, strategy, allowedNotes, bounds)
      }
      break

    case 'all-but-one':
      candidates = generateAllButOneCandidates(cluster, strategy, allowedNotes, bounds)
      break

    case 'one':
    case 'top':
    case 'bottom':
    case 'upper':
    case 'lower':
    case 'most-dissonant-held':
    case 'least-expected-held':
      candidates = generateSingleVoiceCandidates(cluster, strategy, allowedNotes, bounds)
      break

    default:
      candidates = generateSingleVoiceCandidates(cluster, strategy, allowedNotes, bounds)
  }

  // Remove duplicates, remove the current cluster itself, cap results
  const unique = deduplicateClusters(candidates)
  const sortedCluster = sortCluster(cluster)
  const filtered = unique.filter(c => !c.every((n, i) => n === sortedCluster[i]))
  return sampleCandidates(filtered, MAX_CANDIDATES, sortedCluster)
}
