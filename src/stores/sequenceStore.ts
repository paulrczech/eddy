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

// A pool is a pure UI/organizational layer over `sequence` — never a separate copy of the
// clusters it contains. `range` is an inclusive [start, end] pair of indices into
// `sequence`, same shape as SessionView.vue's own loopRange, so a pool is really just a
// *named, persistent* version of a loop-range selection. Pools never nest or overlap —
// every index-shifting operation below (delete/insert/move) keeps that invariant, and any
// pool whose range would collapse to zero rows is dropped automatically.
export interface Pool {
  id: string
  name: string
  range: [number, number]
  expanded: boolean
}

let poolIdCounter = 0
function makePoolId(): string {
  return `pool-${Date.now()}-${poolIdCounter++}`
}

interface HistoryEntry {
  sequence: Cluster[]
  pools: Pool[]
}

export const useSequenceStore = defineStore('sequence', () => {
  const sequence = ref<Cluster[]>([])
  const pools = ref<Pool[]>([])
  // Full snapshots of both `sequence` and `pools`, taken before each mutation (confirm,
  // edit, delete, reorder, transpose, pool create/delete/ungroup) — undo/redo swap the
  // whole pair in and out together, so a pool's range always reverts in lockstep with the
  // sequence state it describes, without needing a separate inverse for each mutation type.
  const undoStack = ref<HistoryEntry[]>([])
  const redoStack = ref<HistoryEntry[]>([])
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

  function snapshotPools(): Pool[] {
    return pools.value.map(p => ({ ...p, range: [...p.range] as [number, number] }))
  }

  // Call before any mutation that should be a distinct undo step. A new mutation always
  // invalidates the redo branch — standard undo/redo semantics.
  function pushHistory() {
    undoStack.value.push({ sequence: snapshot(), pools: snapshotPools() })
    redoStack.value = []
  }

  // Shared by every operation that removes or inserts rows at a specific position —
  // delete/duplicate/reorder/pool-block-move all funnel through this so a pool's range
  // never drifts out of sync with the rows it's supposed to span. `size` is negative for
  // a removal, positive for an insertion; `at` is the position in the array *as it stood
  // before* this particular shift. A pool emptied out by a removal (range inverts) is
  // dropped by the caller via dissolveEmptyPools() below, not here — this function only
  // does the arithmetic.
  function shiftPoolRanges(at: number, size: number) {
    pools.value = pools.value.map(p => {
      let [s, e] = p.range
      if (size < 0) {
        // Removal: a row strictly before the pool shifts both ends; a row inside the
        // pool (including exactly at either edge) only shrinks it.
        if (at < s) { s += size; e += size }
        else if (at <= e) { e += size }
      } else {
        // Insertion: landing at-or-before the pool's start shifts both ends (the pool
        // moves down to make room); landing strictly inside grows the pool to absorb the
        // newly-inserted row(s) — this is exactly how dragging a plain row into an
        // expanded pool adds it, with no separate "add to pool" method needed (see
        // reorderSequence below, modeled as a remove-then-insert composition).
        if (at <= s) { s += size; e += size }
        else if (at <= e) { e += size }
      }
      return { ...p, range: [s, e] as [number, number] }
    })
    dissolveEmptyPools()
  }

  function dissolveEmptyPools() {
    pools.value = pools.value.filter(p => p.range[0] <= p.range[1])
  }

  function start(openingCluster: Cluster, bounds?: { min: number; max: number }) {
    // Always clear old session first — never let stale data leak through
    sequence.value = []
    pools.value = []
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
    redoStack.value.push({ sequence: snapshot(), pools: snapshotPools() })
    const entry = undoStack.value.pop()!
    sequence.value = entry.sequence
    pools.value = entry.pools
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
    undoStack.value.push({ sequence: snapshot(), pools: snapshotPools() })
    const entry = redoStack.value.pop()!
    sequence.value = entry.sequence
    pools.value = entry.pools
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

  // Modeled as a remove-then-insert, same splice convention Ionic's own reorder event
  // uses (`to` is the target's position *after* the removal, not before) — shiftPoolRanges
  // is applied the same way, so a pool's range composes correctly whether `from`/`to` sit
  // outside every pool, move a member within its own pool (nets out unchanged), or move a
  // plain row into an expanded pool's span (grows that pool to include it — see
  // shiftPoolRanges' own comment). SequenceHistory.vue is responsible for only ever
  // emitting a reorder here that respects "a pool member can't leave its own pool" —
  // this function itself just does the index arithmetic honestly for whatever it's given.
  function reorderSequence(from: number, to: number) {
    if (from === to) return
    pushHistory()
    const arr = [...sequence.value]
    const [moved] = arr.splice(from, 1)
    arr.splice(to, 0, moved)
    sequence.value = arr
    shiftPoolRanges(from, -1)
    shiftPoolRanges(to, 1)
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
    shiftPoolRanges(index + 1, 1)
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
    shiftPoolRanges(end + 1, copies.length)
    candidates.value = []
  }

  function deleteAt(index: number) {
    if (index < 0 || index >= sequence.value.length) return
    if (index === 0 && sequence.value.length === 1) return
    pushHistory()
    sequence.value.splice(index, 1)
    shiftPoolRanges(index, -1)
    candidates.value = []
  }

  // Pools — a pure organizational layer over `sequence`, see the Pool type's own comment
  // above. Creation reuses the loop-range-select UI's [start, end] marker; every method
  // here keeps the "pools never overlap or nest" invariant, either by refusing the
  // operation (createPool) or by construction (the others only ever touch one pool's
  // range at a time, via shiftPoolRanges for the rest).

  function poolsOverlap(start: number, end: number): boolean {
    return pools.value.some(p => start <= p.range[1] && end >= p.range[0])
  }

  function createPool(start: number, end: number): string | null {
    if (start < 0 || end >= sequence.value.length || start > end) return null
    if (poolsOverlap(start, end)) return null
    pushHistory()
    const id = makePoolId()
    pools.value.push({
      id,
      name: `pool ${pools.value.length + 1}`,
      range: [start, end],
      // Expanded by default — right after marking a range and creating a pool from it,
      // showing it collapsed would hide the very rows the user just selected.
      expanded: true,
    })
    return id
  }

  // Copies a pool's rows immediately after it (same "insert right after what was
  // selected" convention as duplicateAt/duplicateRange) and wraps the copy in a brand new
  // pool of its own — not just duplicated rows left ungrouped. Order matters here: the
  // existing pools' ranges are shifted *before* the new pool is added, otherwise the new
  // pool's own just-computed range would get caught and corrupted by that same shift.
  function duplicatePool(id: string): string | null {
    const pool = pools.value.find(p => p.id === id)
    if (!pool) return null
    const [s, e] = pool.range
    pushHistory()
    const copies = sequence.value.slice(s, e + 1).map(c => [...c] as Cluster)
    sequence.value.splice(e + 1, 0, ...copies)
    shiftPoolRanges(e + 1, copies.length)
    const newId = makePoolId()
    pools.value.push({
      id: newId,
      name: `${pool.name} copy`,
      range: [e + 1, e + copies.length],
      expanded: pool.expanded,
    })
    candidates.value = []
    return newId
  }

  // Destructive: removes the pool *and* every row inside it. Caller (SessionView.vue)
  // confirms first, mentioning the row count — ungroupPool below is the non-destructive
  // counterpart and needs no such confirmation.
  function deletePool(id: string) {
    const pool = pools.value.find(p => p.id === id)
    if (!pool) return
    const [s, e] = pool.range
    if (s === 0 && e === sequence.value.length - 1) return // would empty the whole flow
    pushHistory()
    sequence.value.splice(s, e - s + 1)
    pools.value = pools.value.filter(p => p.id !== id)
    shiftPoolRanges(s, -(e - s + 1))
    candidates.value = []
  }

  // Dissolves the pool wrapper only — every row it contained stays in the flow, in place,
  // untouched. Still a real undo step (cheap to include, and it's the only way to get a
  // deleted pool's custom name back without retyping it) even though nothing about
  // `sequence` itself changes.
  function ungroupPool(id: string) {
    if (!pools.value.some(p => p.id === id)) return
    pushHistory()
    pools.value = pools.value.filter(p => p.id !== id)
  }

  // Pure view state, not meaningful undo/redo content — same reasoning as why
  // SequenceHistory's own rangeSelectActive/activeIndex aren't part of history either.
  function togglePoolExpanded(id: string) {
    const pool = pools.value.find(p => p.id === id)
    if (pool) pool.expanded = !pool.expanded
  }

  function renamePool(id: string, name: string) {
    const pool = pools.value.find(p => p.id === id)
    if (!pool) return
    const trimmed = name.trim()
    if (!trimmed || trimmed === pool.name) return
    pushHistory()
    pool.name = trimmed
  }

  // Drags a collapsed pool as one atomic block to a new position. `targetIndex` is the
  // sequence index (in current, pre-move numbering) the block's first row should land at
  // or just before — SequenceHistory.vue resolves this from whatever's currently sitting
  // at the drop position, same as it does for a plain single-row reorder.
  function reorderPoolBlock(poolId: string, targetIndex: number) {
    const pool = pools.value.find(p => p.id === poolId)
    if (!pool) return
    const [s, e] = pool.range
    const size = e - s + 1
    if (targetIndex >= s && targetIndex <= e) return // dropped within itself — no-op
    pushHistory()
    const arr = [...sequence.value]
    const block = arr.splice(s, size)
    const insertAt = targetIndex > e ? targetIndex - size : targetIndex
    arr.splice(insertAt, 0, ...block)
    sequence.value = arr

    pools.value = pools.value.map(p => {
      if (p.id === poolId) return { ...p, range: [insertAt, insertAt + size - 1] as [number, number] }
      let [ps, pe] = p.range
      if (s < ps) { ps -= size; pe -= size }
      else if (s <= pe) { pe -= size }
      if (targetIndex <= ps) { ps += size; pe += size }
      else if (targetIndex <= pe) { pe += size }
      return { ...p, range: [ps, pe] as [number, number] }
    })
    dissolveEmptyPools()
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
    pools.value = []
    undoStack.value = []
    redoStack.value = []
    candidates.value = []
    loopResolved.value = false
    loopPoint.value = -1
    savedSessionId.value = null
  }

  return {
    sequence,
    pools,
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
    poolsOverlap,
    createPool,
    duplicatePool,
    deletePool,
    ungroupPool,
    togglePoolExpanded,
    renamePool,
    reorderPoolBlock,
  }
})
