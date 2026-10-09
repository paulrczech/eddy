<template>
  <div class="sequence-history" ref="rootRef">
    <div class="flow-header">
      <p class="section-label">the flow</p>
      <div class="flow-header-actions">
        <button
          class="icon-btn duplicate-toggle-btn"
          :class="{ active: duplicateModeActive }"
          :disabled="sequence.length < 1 || rangeSelectActive"
          :title="duplicateModeActive ? 'stop duplicating' : 'duplicate streams'"
          @click="toggleDuplicateMode">
          <IonIcon :icon="copyOutline" />
        </button>
        <button
          class="icon-btn range-toggle-btn"
          :class="{ active: rangeSelectActive }"
          :disabled="sequence.length < 2 || duplicateModeActive"
          :title="rangeSelectActive ? 'cancel loop range' : 'loop a range of the flow'"
          @click="toggleRangeSelect">
          <IonIcon :icon="repeatOutline" />
        </button>
        <button
          class="icon-btn reverse-toggle-btn"
          :class="{ active: reversed }"
          :disabled="sequence.length < 2"
          :title="reversed ? 'play in order' : 'play in reverse'"
          @click="toggleReverse">
          <IonIcon :icon="swapVerticalOutline" />
        </button>
      </div>
    </div>
    <div v-if="rangeSelectActive" class="range-hint-row">
      <p class="range-hint">{{ rangeHintText }}</p>
      <template v-if="rangeComplete">
        <button
          class="icon-btn action-btn range-duplicate-btn"
          title="duplicate this range"
          @click="duplicateRange">
          <IonIcon :icon="copyOutline" />
        </button>
        <button
          v-if="!rangeOverlapsPool"
          class="icon-btn action-btn range-pool-btn"
          title="create a pool from this range"
          @click="createPoolFromRange">
          <IonIcon :icon="folderOutline" />
        </button>
      </template>
    </div>
    <div v-else-if="duplicateModeActive" class="range-hint-row">
      <p class="range-hint">tap a stream to duplicate it</p>
    </div>
    <div v-else-if="reversed" class="range-hint-row">
      <p class="range-hint">playing in reverse</p>
    </div>
    <div class="history-scroll">
      <IonReorderGroup :disabled="false" @ionItemReorder="onReorder($event)">
        <template v-for="item in displayItems" :key="item.type === 'pool-header' ? `pool-${item.poolId}` : `row-${item.seqIndex}`">
          <!-- Plain row, or one row of an expanded pool's members -->
          <IonItemSliding
            v-if="item.type !== 'pool-header'"
            :ref="(el) => setSlidingRef(item.seqIndex, el)"
            class="history-row"
            :class="{
              'range-block-start': rangeEdge(item.seqIndex) === 'start',
              'range-block-end': rangeEdge(item.seqIndex) === 'end',
              'range-block-middle': rangeEdge(item.seqIndex) === 'middle',
            }"
          >
            <IonItem lines="none" class="history-item-shim">
              <div
                class="history-entry"
                :class="{
                  current: item.seqIndex === activeIndex,
                  'loop-origin': item.seqIndex === loopPoint,
                  playing: item.seqIndex === playingIndex,
                  'in-range': isInRange(item.seqIndex),
                  'range-block-start': rangeEdge(item.seqIndex) === 'start',
                  'range-block-end': rangeEdge(item.seqIndex) === 'end',
                  'range-block-middle': rangeEdge(item.seqIndex) === 'middle',
                  'row-stripe': item.seqIndex % 2 === 0,
                  'pool-member': item.type === 'pool-member',
                }"
                @click="onEntryClick(sequence[item.seqIndex], item.seqIndex)"
              >
                <IonReorder class="reorder-handle" :style="{ opacity: sequence.length < 2 ? 0 : 0.4 }" />
                <span class="entry-index">{{ item.seqIndex + 1 }}</span>
                <span
                  v-for="(midi, v) in sortCluster(sequence[item.seqIndex])"
                  :key="v"
                  class="entry-note"
                  :style="{ color: voiceColors[v] }"
                >{{ midiToName(midi) }}</span>
                <div class="row-actions">
                  <button class="icon-btn action-btn" @click.stop="startEdit(sequence[item.seqIndex], item.seqIndex)" title="edit notes">
                    <IonIcon :icon="createOutline" />
                  </button>
                </div>
              </div>
            </IonItem>
            <IonItemOptions side="end">
              <IonItemOption color="danger" @click="confirmDelete(item.seqIndex)">
                <IonIcon slot="icon-only" :icon="trashOutline" />
              </IonItemOption>
            </IonItemOptions>
          </IonItemSliding>

          <!-- Pool header — shown whether the pool is collapsed or expanded -->
          <IonItemSliding
            v-else
            :ref="(el) => setPoolSlidingRef(item.poolId!, el)"
            class="history-row pool-row"
          >
            <IonItem lines="none" class="history-item-shim">
              <div class="history-entry pool-header-entry">
                <IonReorder class="reorder-handle" style="opacity: 0.4" />
                <button
                  class="icon-btn pool-chevron-btn"
                  :title="poolById(item.poolId!)?.expanded ? 'collapse pool' : 'expand pool'"
                  @click.stop="togglePoolExpanded(item.poolId!)">
                  <IonIcon :icon="poolById(item.poolId!)?.expanded ? chevronDownOutline : chevronForwardOutline" />
                </button>
                <input
                  v-if="renamingPoolId === item.poolId"
                  ref="renameInputRef"
                  v-model="renameValue"
                  class="pool-name-input"
                  maxlength="40"
                  @click.stop
                  @keyup.enter="commitRename(item.poolId!)"
                  @keyup.esc="cancelRename"
                  @blur="commitRename(item.poolId!)" />
                <span v-else class="pool-name">{{ poolById(item.poolId!)?.name }}</span>
                <span class="pool-count">{{ poolSize(item.poolId!) }}</span>
                <div class="row-actions">
                  <button
                    v-if="renamingPoolId !== item.poolId"
                    class="icon-btn action-btn"
                    title="rename pool"
                    @click.stop="startRenamePool(item.poolId!)">
                    <IonIcon :icon="createOutline" />
                  </button>
                </div>
              </div>
            </IonItem>
            <IonItemOptions side="end">
              <IonItemOption @click="ungroupPoolAction(item.poolId!)">
                <IonIcon slot="icon-only" :icon="folderOpenOutline" />
              </IonItemOption>
              <IonItemOption color="danger" @click="deletePoolPrompt(item.poolId!)">
                <IonIcon slot="icon-only" :icon="trashOutline" />
              </IonItemOption>
            </IonItemOptions>
          </IonItemSliding>
        </template>
      </IonReorderGroup>
    </div>
    <!-- Same toggle as the header one — both bind the same rangeSelectActive ref, so
         they're inherently in sync, no separate coordination needed. Exists purely so a
         long flow doesn't force a scroll back to the top just to start a range selection
         near the bottom (Paul, 2026-10-04). Same visibility/disabled rule as the header
         button (no separate "only if long" threshold — one less magic number). -->
    <div class="flow-footer">
      <div v-if="rangeSelectActive" class="range-hint-row range-hint-row--footer">
        <p class="range-hint">{{ rangeHintText }}</p>
        <template v-if="rangeComplete">
          <button
            class="icon-btn action-btn range-duplicate-btn"
            title="duplicate this range"
            @click="duplicateRange">
            <IonIcon :icon="copyOutline" />
          </button>
          <button
            v-if="!rangeOverlapsPool"
            class="icon-btn action-btn range-pool-btn"
            title="create a pool from this range"
            @click="createPoolFromRange">
            <IonIcon :icon="folderOutline" />
          </button>
        </template>
      </div>
      <div v-else-if="duplicateModeActive" class="range-hint-row range-hint-row--footer">
        <p class="range-hint">tap a stream to duplicate it</p>
      </div>
      <div v-else-if="reversed" class="range-hint-row range-hint-row--footer">
        <p class="range-hint">playing in reverse</p>
      </div>
      <button
        class="icon-btn duplicate-toggle-btn"
        :class="{ active: duplicateModeActive }"
        :disabled="sequence.length < 1 || rangeSelectActive"
        :title="duplicateModeActive ? 'stop duplicating' : 'duplicate streams'"
        @click="toggleDuplicateMode">
        <IonIcon :icon="copyOutline" />
      </button>
      <button
        class="icon-btn range-toggle-btn"
        :class="{ active: rangeSelectActive }"
        :disabled="sequence.length < 2 || duplicateModeActive"
        :title="rangeSelectActive ? 'cancel loop range' : 'loop a range of the flow'"
        @click="toggleRangeSelect">
        <IonIcon :icon="repeatOutline" />
      </button>
      <button
        class="icon-btn reverse-toggle-btn"
        :class="{ active: reversed }"
        :disabled="sequence.length < 2"
        :title="reversed ? 'play in order' : 'play in reverse'"
        @click="toggleReverse">
        <IonIcon :icon="swapVerticalOutline" />
      </button>
    </div>
  </div>

  <!-- Edit picker modal -->
  <IonModal
    :is-open="pickerOpen"
    class="picker-modal"
    style="
      --height: 284px;
      --width: 100vw;
      --border-radius: 12px 12px 0 0;
      align-items: flex-end;
      overflow: hidden;
    "
    @did-dismiss="cancelEdit">
    <IonHeader>
      <IonToolbar>
        <IonButtons slot="start">
          <IonButton @click="cancelEdit">cancel</IonButton>
        </IonButtons>
        <div class="octave-transpose">
          <button
            class="icon-btn transpose-btn"
            :disabled="!canTransposeDown"
            title="down an octave"
            @click="transposeEdit(-1)">−12</button>
          <button
            class="icon-btn transpose-btn"
            :disabled="!canTransposeUp"
            title="up an octave"
            @click="transposeEdit(1)">+12</button>
        </div>
        <IonButtons slot="end">
          <IonButton @click="emitPreview">
            <IonIcon slot="icon-only" :icon="playOutline" />
          </IonButton>
          <IonButton @click="commitEdit">done</IonButton>
        </IonButtons>
      </IonToolbar>
    </IonHeader>
    <IonContent :scroll-y="false">
      <p v-if="editError" class="edit-error">{{ editError }}</p>
      <IonPicker>
        <IonPickerColumn
          v-for="(_, v) in editValues"
          :key="v"
          :value="editValues[v]"
          @ion-change="onColumnChange(v, $event)">
          <IonPickerColumnOption
            v-for="midi in validMidiRange"
            :key="midi"
            :value="midi"
            :style="{ color: voiceColors[v] }">
            {{ midiToName(midi) }}
          </IonPickerColumnOption>
        </IonPickerColumn>
      </IonPicker>
    </IonContent>
  </IonModal>

  <!-- Pool delete confirmation — ungroup (swipe action above) needs none of this, since
       nothing is actually lost; this is specifically for the destructive "remove the pool
       and its streams" action, which needs the row count stated up front (Paul, 2026-10-09). -->
  <IonAlert
    :is-open="deleteConfirmPoolId !== null"
    header="delete pool?"
    :message="deleteConfirmMessage"
    :buttons="[
      { text: 'cancel', role: 'cancel', handler: cancelDeletePool },
      { text: 'delete', role: 'destructive', handler: confirmDeletePool },
    ]"
    @did-dismiss="cancelDeletePool" />
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import {
  IonReorderGroup,
  IonReorder,
  IonItemSliding,
  IonItem,
  IonItemOptions,
  IonItemOption,
  IonIcon,
  IonModal,
  IonHeader,
  IonToolbar,
  IonButtons,
  IonButton,
  IonContent,
  IonPicker,
  IonPickerColumn,
  IonPickerColumnOption,
  IonAlert,
} from '@ionic/vue'
import {
  trashOutline,
  createOutline,
  playOutline,
  repeatOutline,
  swapVerticalOutline,
  copyOutline,
  folderOutline,
  folderOpenOutline,
  chevronDownOutline,
  chevronForwardOutline,
} from 'ionicons/icons'
import type { Cluster } from '../../utils/noteUtils'
import { sortCluster, isValidCluster, canTransposeOctave } from '../../utils/noteUtils'
import { midiToName, MAX_CLUSTER_SPREAD, MIDI_MIN, MIDI_MAX } from '../../data/notes'
import type { Pool } from '../../stores/sequenceStore'

const VOICE_COLORS = ['var(--voice-1)', 'var(--voice-2)', 'var(--voice-3)', 'var(--voice-4)']

const props = defineProps<{
  sequence: Cluster[]
  pools: Pool[]
  loopPoint?: number
  playingIndex?: number
}>()

const emit = defineEmits<{
  audition: [cluster: Cluster, index: number]
  preview: [cluster: Cluster]
  delete: [index: number]
  edit: [index: number, newCluster: Cluster]
  reorder: [from: number, to: number]
  'range-change': [range: [number, number] | null]
  'range-mode-change': [active: boolean]
  'range-tap': []
  'reverse-change': [reversed: boolean]
  duplicate: [index: number]
  'duplicate-range': [start: number, end: number]
  'duplicate-mode-change': [active: boolean]
  'create-pool': [start: number, end: number]
  'toggle-pool-expanded': [id: string]
  'rename-pool': [id: string, name: string]
  'delete-pool': [id: string]
  'ungroup-pool': [id: string]
  'reorder-pool-block': [id: string, targetIndex: number]
}>()

const voiceColors = VOICE_COLORS

// The edit picker deliberately uses the global MIDI range, not the current instrument's
// narrower INSTRUMENT_NOTE_RANGE — the voice-leading engine already generates candidates
// across the full global range regardless of instrument (by design: switching instruments
// mid-flow never changes which moves are reachable, see INSTRUMENT_NOTE_RANGE's comment in
// useAudioEngine.ts), so a note like E2 on piano-salamander (whose picker range starts at
// F2) can already be offered as a candidate and confirmed into the flow today. Validating
// edits against the narrower instrument range created a real dead end Paul hit: a note the
// engine legitimately placed into the flow couldn't be re-selected or even left unchanged
// through the edit picker. Matching the engine's own range here closes that gap rather than
// narrowing the engine to match the picker (which would make instrument choice silently
// shrink which moves are available — the thing INSTRUMENT_NOTE_RANGE's design explicitly
// avoids).
const editRange = { min: MIDI_MIN, max: MIDI_MAX }
const validMidiRange = computed(() => {
  const { min, max } = editRange
  return Array.from({ length: max - min + 1 }, (_, i) => min + i)
})

// -1 (nothing "current" yet) rather than defaulting to the last row — same reasoning as
// the length-change watcher below: only an explicit tap should ever light this up.
const activeIndex = ref(-1)

// A swiped-open delete (trash can) row only closed when you manually slid it back or
// swiped a different row open — tapping anywhere else in the app (play, a header button,
// another section entirely) left it sitting open (Paul, 2026-10-04). IonItemSliding has
// no built-in "close on any outside tap" behavior of its own (only "opening another row
// closes the previous one"), so this tracks every row's element and closes whichever is
// open the moment a click lands outside this component's own root.
const rootRef = ref<HTMLElement | null>(null)
const slidingRefs: Record<number, { $el: HTMLElement & { close: () => void } } | null> = {}
const poolSlidingRefs: Record<string, { $el: HTMLElement & { close: () => void } } | null> = {}

function setSlidingRef(i: number, el: unknown) {
  slidingRefs[i] = el as { $el: HTMLElement & { close: () => void } } | null
}

function setPoolSlidingRef(id: string, el: unknown) {
  poolSlidingRefs[id] = el as { $el: HTMLElement & { close: () => void } } | null
}

function closeAllSliding() {
  Object.values(slidingRefs).forEach((el) => el?.$el?.close?.())
  Object.values(poolSlidingRefs).forEach((el) => el?.$el?.close?.())
}

function handleOutsideClick(event: MouseEvent) {
  if (!rootRef.value?.contains(event.target as Node)) closeAllSliding()
}

onMounted(() => document.addEventListener('click', handleOutsideClick))
onUnmounted(() => document.removeEventListener('click', handleOutsideClick))

// Pools — a pure display/organizational grouping over `sequence`, never a separate copy
// of its clusters (see the Pool type's own comment in sequenceStore.ts). The flat
// `sequence` prop is walked once into a list of display items — a plain row, a pool's
// header (shown whether collapsed or expanded), or one of an expanded pool's member
// rows — which IonReorderGroup renders as a single flat list, same as it always has.
// This is the one piece of indirection every pool-aware interaction (rendering, tap
// targets, drag resolution) is built on.
interface DisplayItem {
  type: 'row' | 'pool-header' | 'pool-member'
  seqIndex: number
  poolId?: string
}

const displayItems = computed<DisplayItem[]>(() => {
  const items: DisplayItem[] = []
  const poolByIndex = new Map<number, Pool>()
  for (const p of props.pools) {
    for (let i = p.range[0]; i <= p.range[1]; i++) poolByIndex.set(i, p)
  }
  let i = 0
  while (i < props.sequence.length) {
    const pool = poolByIndex.get(i)
    if (pool) {
      items.push({ type: 'pool-header', seqIndex: pool.range[0], poolId: pool.id })
      if (pool.expanded) {
        for (let j = pool.range[0]; j <= pool.range[1]; j++) {
          items.push({ type: 'pool-member', seqIndex: j, poolId: pool.id })
        }
      }
      i = pool.range[1] + 1
    } else {
      items.push({ type: 'row', seqIndex: i })
      i++
    }
  }
  return items
})

function poolById(id: string): Pool | undefined {
  return props.pools.find(p => p.id === id)
}

function poolSize(id: string): number {
  const p = poolById(id)
  return p ? p.range[1] - p.range[0] + 1 : 0
}

function togglePoolExpanded(id: string) {
  emit('toggle-pool-expanded', id)
}

const renamingPoolId = ref<string | null>(null)
const renameValue = ref('')
const renameInputRef = ref<HTMLInputElement[] | null>(null)

function startRenamePool(id: string) {
  const pool = poolById(id)
  if (!pool) return
  renamingPoolId.value = id
  renameValue.value = pool.name
  nextTick(() => renameInputRef.value?.[0]?.focus())
}

function commitRename(id: string) {
  if (renamingPoolId.value !== id) return
  const value = renameValue.value
  renamingPoolId.value = null
  emit('rename-pool', id, value)
}

function cancelRename() {
  renamingPoolId.value = null
}

function ungroupPoolAction(id: string) {
  emit('ungroup-pool', id)
}

const deleteConfirmPoolId = ref<string | null>(null)
const deleteConfirmMessage = computed(() => {
  const pool = poolById(deleteConfirmPoolId.value ?? '')
  if (!pool) return ''
  const n = pool.range[1] - pool.range[0] + 1
  return `Delete "${pool.name}" and its ${n} stream${n === 1 ? '' : 's'}?`
})

function deletePoolPrompt(id: string) {
  deleteConfirmPoolId.value = id
}

function cancelDeletePool() {
  deleteConfirmPoolId.value = null
}

function confirmDeletePool() {
  if (deleteConfirmPoolId.value) emit('delete-pool', deleteConfirmPoolId.value)
  deleteConfirmPoolId.value = null
}

// Loop-range select: a flag toggle (not a plain tap, which is already "audition this
// cluster") that puts row taps into start/end-marking mode instead — first tap sets the
// start, second sets the end (swapped into order if tapped out of order), a third tap
// after both are set begins a fresh range. Indices go stale the moment the flow's length
// changes (delete/advance/undo-that-changes-length) or rows get reordered, so both exit
// the mode entirely rather than leave the toggle lit over an invalidated selection — an
// in-place edit (same length, same positions) is the one case that's still safe to leave
// alone, since the range's *positions* are still meaningful even if their content changed.
const rangeSelectActive = ref(false)
const rangeStart = ref<number | null>(null)
const rangeEnd = ref<number | null>(null)

function clearRange() {
  rangeStart.value = null
  rangeEnd.value = null
  emit('range-change', null)
}

// Reuses the loop-range marker rather than a separate multi-select mode (Paul, 2026-10-08)
// — contiguous span selection is already exactly what loop-range does, so this is just a
// second action available once a range is marked, not a new selection paradigm. Clears
// the range afterward (same as a completed loop-range normally invites "tap to start a new
// one") rather than leaving it pointed at indices that no longer mean what they did once
// the flow's length has changed underneath it.
function duplicateRange() {
  if (rangeStart.value === null || rangeEnd.value === null) return
  emit('duplicate-range', rangeStart.value, rangeEnd.value)
  clearRange()
}

function setRangeMode(active: boolean) {
  rangeSelectActive.value = active
  clearRange()
  // The "current" (last-tapped/audition) row marker reads as part of the same visual
  // language as the loop markers — leaving it lit on some unrelated row while picking a
  // range is confusing, especially once the range loops and that stray row is outside it.
  if (active) {
    activeIndex.value = -1
    // Mutually exclusive with duplicate-mode (Paul, 2026-10-08) — both repurpose what a
    // row-tap means (mark a boundary vs. duplicate it), so only one can own taps at a
    // time. setDuplicateMode(false)'s own `if (active)` branch never runs here (we're
    // passing false), so this can't recurse back into setRangeMode.
    //
    // This is now belt-and-suspenders, not the primary guard: the template also disables
    // each toggle button outright while the other mode is active, so a user can no longer
    // tap one mode "over" the other silently — the two identical copy-outline icons
    // on-screen at once (this toggle + the contextual "duplicate this range" button) read
    // as genuinely confusing without that, since nothing signaled they could conflict
    // before you tapped (Paul, 2026-10-08, on-device). Kept here anyway in case some
    // future caller ever reaches these functions without going through the disabled
    // button.
    if (duplicateModeActive.value) setDuplicateMode(false)
  }
  emit('range-mode-change', active)
}

function toggleRangeSelect() {
  setRangeMode(!rangeSelectActive.value)
}

// Duplicate-mode: a global toggle (not the old per-row icon, removed 2026-10-08 — it made
// every row visibly busier, worse the more voices a cluster had) that repurposes every row
// tap into "duplicate this row immediately," repeatable without limit — built specifically
// for one-handed, thumb-only use (Paul: "run down the list duplicating streams I want"),
// since a tap-anywhere-on-the-row gesture is both a larger and more reachable target than a
// small icon at a fixed row edge. No sound preview while active (SessionView.vue disables
// the main play control and stops anything currently playing) — deliberately silent for
// now; revisit if that turns out to hurt the workflow.
const duplicateModeActive = ref(false)

function setDuplicateMode(active: boolean) {
  duplicateModeActive.value = active
  if (active) {
    activeIndex.value = -1
    if (rangeSelectActive.value) setRangeMode(false)
  }
  emit('duplicate-mode-change', active)
}

function toggleDuplicateMode() {
  setDuplicateMode(!duplicateModeActive.value)
}

// Playback order only — never touches props.sequence or its undo history. SessionView.vue
// reverses whatever's about to actually play (the full flow, or the loop-range slice) at
// the point of playback/export, so this composes with range selection rather than one
// silently overriding the other.
const reversed = ref(false)
function toggleReverse() {
  reversed.value = !reversed.value
  emit('reverse-change', reversed.value)
}

watch(() => props.sequence.length, (len) => {
  // Previously always jumped to the new last row on any length change at all — add,
  // delete, duplicate, didn't matter — meant as a reasonable-looking default for "nothing
  // tapped yet," but in practice it persistently bordered the last row after every single
  // confirm even though nothing was actually tapped to preview it (Paul, 2026-10-08: "that
  // just doesn't feel right"). A duplicate makes this more clearly wrong too — duplicating
  // row 2 of a 10-row flow would light up row 11, nowhere near what was actually touched.
  // Now this only clamps a now-out-of-bounds index after the flow shrinks; it never
  // invents a new "current" row on growth — only an actual tap does that (onEntryClick).
  if (activeIndex.value >= len) activeIndex.value = -1
  if (rangeSelectActive.value) setRangeMode(false)
})

// Clear the "current" marker the moment playback actually starts (playingIndex going from
// -1 to a real row), not just on range-mode entry — otherwise whatever you last tapped to
// audition stays bordered/lit for the entire session regardless of what's now playing.
watch(() => props.playingIndex, (idx, prev) => {
  if ((idx ?? -1) >= 0 && (prev ?? -1) < 0) activeIndex.value = -1
})

function isInRange(i: number): boolean {
  if (!rangeSelectActive.value || rangeStart.value === null) return false
  // Only a start point picked yet — light up just that row so picking it reads as a
  // registered choice instead of looking like the tap did nothing until the end lands too.
  if (rangeEnd.value === null) return i === rangeStart.value
  return i >= rangeStart.value && i <= rangeEnd.value
}

// Which edge of the highlighted block (if any) row i sits on — drives both the left-bar
// extent and which corners of the row stay rounded vs. flatten to read as one continuous
// loop segment instead of separate pills (Paul, 2026-10-01).
function rangeEdge(i: number): 'start' | 'end' | 'middle' | 'single' | null {
  if (!isInRange(i)) return null
  const s = rangeStart.value as number
  const e = rangeEnd.value
  if (e === null || s === e) return 'single'
  if (i === s) return 'start'
  if (i === e) return 'end'
  return 'middle'
}

// Shared by both the header and footer range-select toggles (same hint, same wording)
// so the two can't drift out of sync with each other.
const rangeHintText = computed(() =>
  rangeStart.value === null
    ? 'tap a start point'
    : rangeEnd.value === null
    ? 'tap an end point'
    : 'loop set — tap to start a new one'
)
const rangeComplete = computed(() => rangeStart.value !== null && rangeEnd.value !== null)

// Gates the "create pool" icon — a pool can't be created from a range that touches an
// already-pooled row at all, full or partial overlap alike (Paul, 2026-10-09): rather
// than defining merge/absorb behavior for every overlap shape, pool creation simply isn't
// offered there. Deliberately doesn't gate anything else — range-select itself (and
// loop/duplicate/export built on it) stays completely pool-agnostic.
const rangeOverlapsPool = computed(() => {
  if (rangeStart.value === null || rangeEnd.value === null) return false
  return props.pools.some(p => rangeStart.value! <= p.range[1] && rangeEnd.value! >= p.range[0])
})

// Same "consume and clear, don't exit range-select mode" treatment as duplicateRange()
// above — "loop set — tap to start a new one" still applies afterward.
function createPoolFromRange() {
  if (rangeStart.value === null || rangeEnd.value === null) return
  emit('create-pool', rangeStart.value, rangeEnd.value)
  clearRange()
}

const pickerOpen = ref(false)
const editingIndex = ref<number | null>(null)
const editValues = ref<number[]>([])
const editError = ref('')

function startEdit(cluster: Cluster, index: number) {
  editingIndex.value = index
  editValues.value = [...sortCluster(cluster)]
  editError.value = ''
  pickerOpen.value = true
}

function onColumnChange(voiceIndex: number, event: CustomEvent) {
  editValues.value[voiceIndex] = event.detail.value
  editError.value = ''
}

const canTransposeUp = computed(() => canTransposeOctave(editValues.value, 1, editRange))
const canTransposeDown = computed(() => canTransposeOctave(editValues.value, -1, editRange))

function transposeEdit(direction: 1 | -1) {
  if (!canTransposeOctave(editValues.value, direction, editRange)) return
  editValues.value = editValues.value.map(n => n + direction * 12)
  editError.value = ''
}

function emitPreview() {
  emit('preview', [...editValues.value] as Cluster)
}

function commitEdit() {
  const newCluster = [...editValues.value] as Cluster
  const sorted = sortCluster(newCluster)
  const range = editRange

  const outOfRange = sorted.find(n => n < range.min || n > range.max)
  if (outOfRange !== undefined) {
    editError.value = `note out of range (${midiToName(range.min)}–${midiToName(range.max)})`
    return
  }
  const spread = sorted[sorted.length - 1] - sorted[0]
  if (spread > MAX_CLUSTER_SPREAD) {
    editError.value = `spread too wide (max ${MAX_CLUSTER_SPREAD} semitones)`
    return
  }
  if (new Set(sorted).size !== sorted.length) {
    editError.value = 'duplicate notes'
    return
  }
  if (!isValidCluster(newCluster, range)) {
    editError.value = 'invalid cluster'
    return
  }

  pickerOpen.value = false
  emit('edit', editingIndex.value!, newCluster)
  editingIndex.value = null
}

function cancelEdit() {
  pickerOpen.value = false
  editingIndex.value = null
  editError.value = ''
}

// displayItems-based: `from`/`to` from Ionic are positions in the rendered list, not raw
// sequence indices, so every case below first figures out which real sequence index (or,
// for a whole collapsed pool, which store method) the drop actually means. complete(false)
// is always called first regardless of what happens next — nothing here ever lets Ionic's
// own DOM reorder persist; a real mutation (or nothing, for a rejected drop) always comes
// from the emit instead, same as the rest of this app's "stop and let the data drive the
// re-render" convention.
function onReorder(event: CustomEvent) {
  const { from, to } = event.detail
  event.detail.complete(false)
  if (from === to) return
  if (rangeSelectActive.value) setRangeMode(false)

  const items = displayItems.value
  const fromItem = items[from]
  const toItem = items[to]
  if (!fromItem || !toItem) return

  if (fromItem.type === 'pool-header') {
    // Can't drop one pool's block into the middle of another expanded pool — pools never
    // nest or overlap (see createPool's own overlap guard in sequenceStore.ts).
    if (toItem.type === 'pool-member') return
    const targetSeqIndex =
      toItem.type === 'pool-header'
        ? (to > from ? poolById(toItem.poolId!)!.range[1] + 1 : poolById(toItem.poolId!)!.range[0])
        : (to > from ? toItem.seqIndex + 1 : toItem.seqIndex)
    emit('reorder-pool-block', fromItem.poolId!, targetSeqIndex)
    return
  }

  if (fromItem.type === 'pool-member') {
    // v1: a member row reorders only among its own pool's other members — dragging a
    // single interior row out isn't supported (see createPool's comment on why: it'd
    // break the contiguous-range model every pool is built on). Ungrouping the whole
    // pool is the only way a row leaves one.
    if (toItem.type !== 'pool-member' || toItem.poolId !== fromItem.poolId) return
    emit('reorder', fromItem.seqIndex, toItem.seqIndex)
    return
  }

  // fromItem.type === 'row' — a plain, unpooled row.
  if (toItem.type === 'pool-header') {
    const toPool = poolById(toItem.poolId!)!
    const targetSeqIndex = to > from ? toPool.range[1] + 1 : toPool.range[0]
    emit('reorder', fromItem.seqIndex, targetSeqIndex)
    return
  }
  // Landing among an expanded pool's member rows (toItem.type === 'pool-member') is
  // exactly how a plain row gets added to a pool — see shiftPoolRanges' own comment in
  // sequenceStore.ts for why no separate "add to pool" method is needed for this.
  emit('reorder', fromItem.seqIndex, toItem.seqIndex)
}

function onEntryClick(cluster: Cluster, index: number) {
  if (duplicateModeActive.value) {
    emit('duplicate', index)
    return
  }
  if (rangeSelectActive.value) {
    // Setting any marker while a loop range is actively playing leaves the engine still
    // scheduled against the *old* range — nothing currently re-triggers playback just
    // because the selection changed, so the old range keeps sounding until the next
    // explicit play. Stopping here instead of trying to hot-swap the scheduled Part
    // (Paul, 2026-10-01): simpler and avoids guessing at a reschedule that might itself
    // glitch.
    emit('range-tap')
    if (rangeStart.value === null) {
      rangeStart.value = index
    } else if (rangeEnd.value === null) {
      if (index < rangeStart.value) {
        rangeEnd.value = rangeStart.value
        rangeStart.value = index
      } else {
        rangeEnd.value = index
      }
      emit('range-change', [rangeStart.value, rangeEnd.value])
    } else {
      rangeStart.value = index
      rangeEnd.value = null
    }
    return
  }
  activeIndex.value = index
  emit('audition', cluster, index)
}

function confirmDelete(index: number) {
  emit('delete', index)
}
</script>

<style scoped>
.sequence-history { width: 100%; }

.flow-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.flow-header-actions {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.flow-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.3rem;
  padding-top: 0.4rem;
}

/* Wraps the hint text (and, once a range is fully marked, the contextual "duplicate this
   range" button) — used for both the loop-range hint and "playing in reverse", even when
   the latter has no button, specifically so both states occupy identical height. Without
   this, .icon-btn's 44px min-height (--tap-min) only stretches the row when a button is
   actually present, so the two hint states rendered at different heights and the
   align-items:center text sat at different depths within each, reading as mismatched top
   AND bottom spacing around the visible text even though the row's own margin is identical
   either way (Paul, 2026-10-08) — min-height here, not just the button, is what fixes it.
   Header variant keeps the standalone .range-hint's old vertical rhythm (now on the row
   instead of the <p>, which is reset to 0 below); footer variant needs flex:1 to fill the
   leading space, same reasoning as every other footer hint in this file. */
.range-hint-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-height: var(--tap-min);
  margin: -0.2rem 0 0.3rem;
}
.range-hint-row .range-hint {
  margin: 0;
}
.range-hint-row--footer {
  flex: 1;
  min-width: 0;
  min-height: 0;
  margin: 0;
}
.range-duplicate-btn,
.range-pool-btn {
  font-size: var(--icon-sm);
  flex-shrink: 0;
}

.range-toggle-btn {
  font-size: var(--icon-sm);
  border: 1px solid transparent;
  border-radius: 8px;
}
.range-toggle-btn.active {
  border-color: var(--color-accent);
  color: var(--color-text);
  background: var(--color-accent);
}
.range-toggle-btn:disabled { opacity: 0.3; }

.reverse-toggle-btn {
  font-size: var(--icon-sm);
  border: 1px solid transparent;
  border-radius: 8px;
}
.reverse-toggle-btn.active {
  border-color: var(--color-accent);
  color: var(--color-text);
  background: var(--color-accent);
}
.reverse-toggle-btn:disabled { opacity: 0.3; }

.duplicate-toggle-btn {
  font-size: var(--icon-sm);
  border: 1px solid transparent;
  border-radius: 8px;
}
.duplicate-toggle-btn.active {
  border-color: var(--color-accent);
  color: var(--color-text);
  background: var(--color-accent);
}
.duplicate-toggle-btn:disabled { opacity: 0.3; }

.range-hint {
  font-size: var(--text-xs);
  color: var(--color-text-dim);
  margin: -0.2rem 0 0.3rem;
}

.history-scroll {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-x: hidden;
}

.history-row {
  position: relative;
  border-radius: 6px;
  overflow: hidden;
}

.history-entry {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  min-height: 2.75rem;
  padding: 0.35rem 0.5rem;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid transparent;
  background: transparent;
  position: relative;
  z-index: 1;
  will-change: transform;
  touch-action: pan-y;
}

/* Very subtle alternating tint so a long flow (20-30+ streams) stays easy to keep your
   bearings in while scrolling a single-line list (Paul, 2026-10-08) — kept deliberately
   faint, this is meant to read as "is that even there," not an obvious stripe. Declared
   ahead of .current/.in-range/.playing below so any active state's own background wins
   the cascade outright on a striped row that's also selected/playing — same precedent as
   .in-range being declared ahead of .playing for the same reason. Tuned by eye: 0.025 in
   the simulator, down to 0.010 on first real-device look, bumped to 0.015 when 0.010 read
   as too faint — then back to 0.010 once Paul realized his device brightness had been
   turned down for the first on-device check, not a real rendering difference (2026-10-08).
   Settled at 0.010.
   Striping display row 1 (i % 2 === 0, not 1 — array index is 0-based, display numbering
   isn't) rather than row 2: a single-stream flow has only array index 0, so under the
   original i % 2 === 1 rule it never got the tint at all and read as floating text with no
   boundary whatsoever (Paul, 2026-10-08, screenshot). Starting the stripe on the very
   first row fixes that and costs nothing for longer flows — it's still a pure alternation,
   just shifted by one. */
.history-entry.row-stripe {
  background: rgba(255, 255, 255, 0.010);
}

/* iOS WebKit fires :hover on tap with no real mouse to leave it with, so it sticks until
   some other tap clears it — including, confusingly, overlapping with the loop/playing
   highlights. Scoping to real hover-capable pointers stops it triggering on a touch tap
   at all, rather than trying to react to it after the fact (there's no JS hook that can
   force-clear a native :hover state anyway). */
@media (hover: hover) and (pointer: fine) {
  .history-entry:hover { background: var(--color-surface); }
}
.history-entry.current {
  background: var(--color-surface);
  border-color: var(--color-border);
}
.history-entry.loop-origin { border-color: var(--color-accent); }

/* One continuous bar + tint across the whole selected range, not just its ends — declared
   ahead of .playing below so that rule's background/border-color win the cascade on a row
   that's both in-range and currently playing (equal specificity, later wins): the bar's
   width survives untouched (playing doesn't set border-width) and just recolors to the
   playing hue, while the wash switches fully to "now playing." Reads as one signal with a
   momentary accent, not two competing highlights. */
.history-entry.in-range {
  border-left-width: 3px;
  border-left-color: var(--color-accent);
  padding-left: calc(0.5rem - 2px);
  background: rgba(69, 74, 104, 0.12);
}
/* Flattens the touching corners of a multi-row range so .history-row's independent
   border-radius per row doesn't carve it back into separate rounded pills — applied to
   both the row (clips via overflow:hidden) and the entry (its own matching radius). */
.history-row.range-block-start,
.history-entry.range-block-start {
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}
.history-row.range-block-end,
.history-entry.range-block-end {
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}
.history-row.range-block-middle,
.history-entry.range-block-middle {
  border-radius: 0;
}

.history-entry.playing {
  background: rgba(126, 184, 212, 0.08);
  border-color: rgba(126, 184, 212, 0.35);
}

.entry-index {
  font-size: var(--text-label);
  color: var(--color-text-dim);
  width: 1.4rem;
  text-align: right;
  flex-shrink: 0;
  font-family: var(--font-mono);
}

.entry-note {
  font-size: var(--text-sm);
  font-family: var(--font-mono);
  letter-spacing: 0.04em;
}
.entry-note + .entry-note::before {
  content: '·';
  color: var(--color-text-dim);
  margin-right: 0.4rem;
}

.reorder-handle {
  flex-shrink: 0;
  color: var(--color-text-dim);
  opacity: 0.4;
}

.row-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 0.1rem;
  flex-shrink: 0;
}

/* .icon-btn (box model, touch target) comes from theme/buttons.css — action-btn only
   sets the compact in-content glyph size and hover tint */
.action-btn {
  font-size: var(--icon-sm);
}
.action-btn:hover { color: var(--color-accent); }
.action-btn.delete-btn:hover { color: #e07878; }

.edit-error {
  font-size: var(--text-xs);
  color: #e07878;
  text-align: center;
  padding: 0.4rem 1rem 0;
  margin: 0;
}

/* Pools — a pool's header row reuses .history-entry's own box model (height, padding,
   radius) via .pool-header-entry, just with its own content layout instead of
   index/notes/edit-icon. */
.pool-row { border: 1px solid var(--color-border); }
.pool-header-entry {
  background: var(--color-surface);
}
.pool-chevron-btn {
  font-size: var(--icon-sm);
  flex-shrink: 0;
  color: var(--color-text-dim);
}
.pool-name {
  font-size: var(--text-sm);
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1 1 auto;
}
.pool-name-input {
  font: inherit;
  font-size: var(--text-sm);
  color: var(--color-text);
  background: var(--color-bg);
  border: 1px solid var(--color-accent);
  border-radius: 4px;
  padding: 0.15rem 0.4rem;
  min-width: 0;
  flex: 1;
}
.pool-count {
  font-size: var(--text-label);
  color: var(--color-text-dim);
  font-family: var(--font-mono);
  flex-shrink: 0;
}

/* Member rows of an expanded pool — indented and left-bordered so they read as nested
   under their pool's header without needing a separate container/box per pool (which
   would fight IonReorderGroup's flat-list requirement). */
.history-entry.pool-member {
  margin-left: 1.25rem;
  width: calc(100% - 1.25rem);
  border-left: 2px solid var(--color-border);
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}
</style>
