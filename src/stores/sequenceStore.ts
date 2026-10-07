import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { Cluster, sortCluster, isValidCluster, clustersEqual, clusterDissonance } from '../utils/noteUtils'
import { MIDI_SEED_MIN, MIDI_SEED_MAX, MIDI_MIN, MIDI_MAX } from '../data/notes'

// Ceiling on a random seed's average pairwise dissonance rank (see clusterDissonance()).
// Keeps "let it flow" from ever handing a first-time listener a raw tone cluster — tuned
// by Monte Carlo so triads/7ths/sus chords pass comfortably and stacked-semitone clusters
// don't, without ever exhausting the retry loop below into the guaranteed fallback.
const SEED_DISSONANCE_CEILING = 6

// Floor on the random seed's *highest* voice — not a spread minimum. A tight, closely
// voiced cluster sounds fine once it's sitting at or above octave 3; it's specifically a
// cluster stuck entirely down in octave 2 that reads as muddy/hard to hear on small
// speakers (Paul, 2026-10-04). The seed zone's low end (MIDI_SEED_MIN, E2) needs up to 8
// semitones of lift to clear this — comfortably inside the existing 14-semitone max-spread
// cap below, so this never needs to loosen that cap, just require it actually gets used.
const SEED_MIN_TOP_VOICE = 48 // C3

export const useSequenceStore = defineStore('sequence', () => {
  const sequence = ref<Cluster[]>([])
  // Full-array snapshots of `sequence`, taken before each mutation (confirm, edit,
  // delete, reorder, transpose) — undo/redo swap the whole array in and out, so every
  // mutation type is covered without needing a separate inverse for each one.
  const undoStack = ref<Cluster[][]>([])
  const redoStack = ref<Cluster[][]>([])
  const candidates = ref<Cluster[]>([])
  const loopResolved = ref(false)
  const loopPoint = ref<number>(-1)
  const savedSessionId = ref<string | null>(null)

  const currentCluster = computed<Cluster | null>(() =>
    sequence.value.length > 0 ? sequence.value[sequence.value.length - 1] : null
  )

  const moveCount = computed(() => Math.max(0, sequence.value.length - 1))
  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  function snapshot(): Cluster[] {
    return sequence.value.map(c => [...c])
  }

  // Call before any mutation that should be a distinct undo step. A new mutation always
  // invalidates the redo branch — standard undo/redo semantics.
  function pushHistory() {
    undoStack.value.push(snapshot())
    redoStack.value = []
  }

  function start(openingCluster: Cluster, bounds?: { min: number; max: number }) {
    // Always clear old session first — never let stale data leak through
    sequence.value = []
    undoStack.value = []
    redoStack.value = []
    candidates.value = []
    loopResolved.value = false
    loopPoint.value = -1
    savedSessionId.value = null

    const sorted = sortCluster(openingCluster)
    if (!isValidCluster(sorted, bounds)) {
      console.warn('Invalid opening cluster', sorted)
      return
    }
    sequence.value = [sorted]
  }

  function randomStart(voiceCount: number) {
    let notes: number[] = []
    let found = false

    // Retry until we get exactly voiceCount valid, comfortably-consonant notes.
    // Previous approach broke early when notes went too high, producing silent failures.
    for (let attempt = 0; attempt < 30; attempt++) {
      notes = []
      // Seed within the dedicated seed zone (octave 2-3), leaving headroom for voices above
      const seedRange = MIDI_SEED_MAX - MIDI_SEED_MIN
      notes.push(MIDI_SEED_MIN + Math.floor(Math.random() * seedRange))

      while (notes.length < voiceCount) {
        const prev = notes[notes.length - 1]
        const spread = prev - notes[0]
        const remaining = voiceCount - notes.length
        // Reserve at least 1 semitone per remaining voice
        const maxStep = Math.min(14 - spread - (remaining - 1), 5)
        if (maxStep < 1) break
        const step = 1 + Math.floor(Math.random() * maxStep)
        notes.push(prev + step)
      }

      if (
        notes.length === voiceCount &&
        isValidCluster(notes) &&
        clusterDissonance(notes) <= SEED_DISSONANCE_CEILING &&
        notes[notes.length - 1] >= SEED_MIN_TOP_VOICE
      ) {
        found = true
        break
      }
    }

    // Guaranteed fallback — can never fail isValidCluster, and is itself well within the
    // dissonance ceiling (a major triad/seventh), so it's a safe substitute either way.
    if (!found) {
      const fallbacks: Record<number, Cluster> = {
        3: [60, 64, 67],  // C4 E4 G4
        4: [60, 64, 67, 71], // C4 E4 G4 B4
      }
      notes = fallbacks[voiceCount] ?? [60, 64, 67]
    }

    start(notes)
  }

  function setCandidates(newCandidates: Cluster[]) {
    candidates.value = newCandidates
  }

  // `skipHistory` lets a caller batch several confirms (e.g. multi-select) into one
  // undo step — only the first call in the batch should snapshot.
  function confirm(cluster: Cluster, options: { skipHistory?: boolean } = {}) {
    if (!options.skipHistory) pushHistory()
    sequence.value.push(sortCluster(cluster))
    candidates.value = []
  }

  // Only clear candidates/loop state when the *current* (last) cluster's value actually
  // changes — e.g. undoing an edit to an earlier row shouldn't disturb streams generated
  // against a last cluster that never moved. Returns whether it changed, so the caller
  // knows whether to redraw a strategy and regenerate candidates.
  function undo(): boolean {
    if (undoStack.value.length === 0) return false
    const prevLast = currentCluster.value
    redoStack.value.push(snapshot())
    sequence.value = undoStack.value.pop()!
    const changed = !prevLast || !currentCluster.value || !clustersEqual(prevLast, currentCluster.value)
    if (changed) {
      candidates.value = []
      loopResolved.value = false
    }
    return changed
  }

  function redo(): boolean {
    if (redoStack.value.length === 0) return false
    const prevLast = currentCluster.value
    undoStack.value.push(snapshot())
    sequence.value = redoStack.value.pop()!
    const changed = !prevLast || !currentCluster.value || !clustersEqual(prevLast, currentCluster.value)
    if (changed) {
      candidates.value = []
      loopResolved.value = false
    }
    return changed
  }

  // Returns whether an octave shift is possible in the given direction
  function canTransposeOctave(direction: 1 | -1): boolean {
    if (!currentCluster.value) return false
    return currentCluster.value.every(n => {
      const shifted = n + direction * 12
      return shifted >= MIDI_MIN && shifted <= MIDI_MAX
    })
  }

  function transposeOctave(direction: 1 | -1) {
    if (!canTransposeOctave(direction)) return
    pushHistory()
    const shifted = currentCluster.value!.map(n => n + direction * 12) as Cluster
    const lastIdx = sequence.value.length - 1
    sequence.value[lastIdx] = shifted
    candidates.value = []
  }

  function editClusterAt(index: number, newCluster: Cluster, bounds?: { min: number; max: number }) {
    if (index < 0 || index >= sequence.value.length) return
    const sorted = sortCluster(newCluster)
    if (!isValidCluster(sorted, bounds)) return
    if (clustersEqual(sorted, sequence.value[index])) return  // no-op edit, don't spend an undo step
    pushHistory()
    sequence.value[index] = sorted
  }

  function reorderSequence(from: number, to: number) {
    if (from === to) return
    pushHistory()
    const arr = [...sequence.value]
    const [moved] = arr.splice(from, 1)
    arr.splice(to, 0, moved)
    sequence.value = arr
    candidates.value = []
  }

  // Inserts a copy immediately after the original — no placement choice, matching how
  // duplicate works in most list UIs. Never changes the sequence's last cluster's value
  // (it only ever inserts, never modifies or removes an existing entry), so unlike
  // reorderSequence this never needs to trigger a candidates/advance refresh — only
  // setLoopResolved, left to the caller, same convention as deleteAt/editClusterAt.
  function duplicateAt(index: number) {
    if (index < 0 || index >= sequence.value.length) return
    pushHistory()
    const copy = [...sequence.value[index]] as Cluster
    sequence.value.splice(index + 1, 0, copy)
    candidates.value = []
  }

  // Duplicates a contiguous [start, end] span (inclusive), inserting the copies
  // immediately after `end` — same "insert right after what was selected" convention as
  // duplicateAt above, just for a range instead of a single row.
  function duplicateRange(start: number, end: number) {
    if (start < 0 || end >= sequence.value.length || start > end) return
    pushHistory()
    const copies = sequence.value.slice(start, end + 1).map(c => [...c] as Cluster)
    sequence.value.splice(end + 1, 0, ...copies)
    candidates.value = []
  }

  function deleteAt(index: number) {
    if (index < 0 || index >= sequence.value.length) return
    if (index === 0 && sequence.value.length === 1) return
    pushHistory()
    sequence.value.splice(index, 1)
    candidates.value = []
  }

  function setLoopResolved(resolved: boolean, point: number = -1) {
    loopResolved.value = resolved
    loopPoint.value = point
  }

  function setSavedSessionId(id: string | null) {
    savedSessionId.value = id
  }

  function reset() {
    sequence.value = []
    undoStack.value = []
    redoStack.value = []
    candidates.value = []
    loopResolved.value = false
    loopPoint.value = -1
    savedSessionId.value = null
  }

  return {
    sequence,
    candidates,
    loopResolved,
    loopPoint,
    savedSessionId,
    currentCluster,
    moveCount,
    canUndo,
    canRedo,
    start,
    randomStart,
    setCandidates,
    confirm,
    undo,
    redo,
    canTransposeOctave,
    transposeOctave,
    editClusterAt,
    duplicateAt,
    duplicateRange,
    deleteAt,
    reorderSequence,
    setLoopResolved,
    setSavedSessionId,
    reset,
  }
})
