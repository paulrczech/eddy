<template>
  <div class="sequence-history" ref="rootRef">
    <div class="flow-header">
      <p class="section-label">the flow</p>
      <button
        class="icon-btn range-toggle-btn"
        :class="{ active: rangeSelectActive }"
        :disabled="sequence.length < 2"
        :title="rangeSelectActive ? 'cancel loop range' : 'loop a range of the flow'"
        @click="toggleRangeSelect">
        <IonIcon :icon="repeatOutline" />
      </button>
    </div>
    <p v-if="rangeSelectActive" class="range-hint">
      {{
        rangeStart === null
          ? 'tap a start point'
          : rangeEnd === null
          ? 'tap an end point'
          : 'loop set — tap to start a new one'
      }}
    </p>
    <div class="history-scroll">
      <IonReorderGroup :disabled="false" @ionItemReorder="onReorder($event)">
        <IonItemSliding
          v-for="(cluster, i) in sequence"
          :key="i"
          :ref="(el) => setSlidingRef(i, el)"
          class="history-row"
          :class="{
            'range-block-start': rangeEdge(i) === 'start',
            'range-block-end': rangeEdge(i) === 'end',
            'range-block-middle': rangeEdge(i) === 'middle',
          }"
        >
          <IonItem lines="none" class="history-item-shim">
            <div
              class="history-entry"
              :class="{
                current: i === activeIndex,
                'loop-origin': i === loopPoint,
                playing: i === playingIndex,
                'in-range': isInRange(i),
                'range-block-start': rangeEdge(i) === 'start',
                'range-block-end': rangeEdge(i) === 'end',
                'range-block-middle': rangeEdge(i) === 'middle',
              }"
              @click="onEntryClick(cluster, i)"
            >
              <IonReorder class="reorder-handle" :style="{ opacity: sequence.length < 2 ? 0 : 0.4 }" />
              <span class="entry-index">{{ i + 1 }}</span>
              <span
                v-for="(midi, v) in sortCluster(cluster)"
                :key="v"
                class="entry-note"
                :style="{ color: voiceColors[v] }"
              >{{ midiToName(midi) }}</span>
              <div class="row-actions">
                <button class="icon-btn action-btn" @click.stop="startEdit(cluster, i)" title="edit notes">
                  <IonIcon :icon="createOutline" />
                </button>
              </div>
            </div>
          </IonItem>
          <IonItemOptions side="end">
            <IonItemOption color="danger" @click="confirmDelete(i)">
              <IonIcon slot="icon-only" :icon="trashOutline" />
            </IonItemOption>
          </IonItemOptions>
        </IonItemSliding>
      </IonReorderGroup>
    </div>
    <!-- Same toggle as the header one — both bind the same rangeSelectActive ref, so
         they're inherently in sync, no separate coordination needed. Exists purely so a
         long flow doesn't force a scroll back to the top just to start a range selection
         near the bottom (Paul, 2026-10-04). Same visibility/disabled rule as the header
         button (no separate "only if long" threshold — one less magic number). -->
    <div class="flow-footer">
      <button
        class="icon-btn range-toggle-btn"
        :class="{ active: rangeSelectActive }"
        :disabled="sequence.length < 2"
        :title="rangeSelectActive ? 'cancel loop range' : 'loop a range of the flow'"
        @click="toggleRangeSelect">
        <IonIcon :icon="repeatOutline" />
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
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
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
} from '@ionic/vue'
import { trashOutline, createOutline, playOutline, repeatOutline } from 'ionicons/icons'
import type { Cluster } from '../../utils/noteUtils'
import { sortCluster, isValidCluster, canTransposeOctave } from '../../utils/noteUtils'
import { midiToName, MAX_CLUSTER_SPREAD, MIDI_MIN, MIDI_MAX } from '../../data/notes'

const VOICE_COLORS = ['var(--voice-1)', 'var(--voice-2)', 'var(--voice-3)', 'var(--voice-4)']

const props = defineProps<{
  sequence: Cluster[]
  loopPoint?: number
  playingIndex?: number
}>()

const emit = defineEmits<{
  audition: [cluster: Cluster]
  preview: [cluster: Cluster]
  delete: [index: number]
  edit: [index: number, newCluster: Cluster]
  reorder: [from: number, to: number]
  'range-change': [range: [number, number] | null]
  'range-mode-change': [active: boolean]
  'range-tap': []
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

const activeIndex = ref(props.sequence.length - 1)

// A swiped-open delete (trash can) row only closed when you manually slid it back or
// swiped a different row open — tapping anywhere else in the app (play, a header button,
// another section entirely) left it sitting open (Paul, 2026-10-04). IonItemSliding has
// no built-in "close on any outside tap" behavior of its own (only "opening another row
// closes the previous one"), so this tracks every row's element and closes whichever is
// open the moment a click lands outside this component's own root.
const rootRef = ref<HTMLElement | null>(null)
const slidingRefs: Record<number, { $el: HTMLElement & { close: () => void } } | null> = {}

function setSlidingRef(i: number, el: unknown) {
  slidingRefs[i] = el as { $el: HTMLElement & { close: () => void } } | null
}

function closeAllSliding() {
  Object.values(slidingRefs).forEach((el) => el?.$el?.close?.())
}

function handleOutsideClick(event: MouseEvent) {
  if (!rootRef.value?.contains(event.target as Node)) closeAllSliding()
}

onMounted(() => document.addEventListener('click', handleOutsideClick))
onUnmounted(() => document.removeEventListener('click', handleOutsideClick))

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

function setRangeMode(active: boolean) {
  rangeSelectActive.value = active
  clearRange()
  // The "current" (last-tapped/audition) row marker reads as part of the same visual
  // language as the loop markers — leaving it lit on some unrelated row while picking a
  // range is confusing, especially once the range loops and that stray row is outside it.
  if (active) activeIndex.value = -1
  emit('range-mode-change', active)
}

function toggleRangeSelect() {
  setRangeMode(!rangeSelectActive.value)
}

watch(() => props.sequence.length, (len) => {
  activeIndex.value = len - 1
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

function onReorder(event: CustomEvent) {
  const { from, to } = event.detail
  event.detail.complete(false)
  if (from !== to) {
    if (rangeSelectActive.value) setRangeMode(false)
    emit('reorder', from, to)
  }
}

function onEntryClick(cluster: Cluster, index: number) {
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
  emit('audition', cluster)
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

.flow-footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 0.4rem;
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
</style>
