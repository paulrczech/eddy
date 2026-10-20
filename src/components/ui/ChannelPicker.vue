<template>
  <IonModal
    class="picker-modal"
    :is-open="isOpen"
    :style="{
      '--height': `calc(${view === 'key' ? 380 : 340}px + env(safe-area-inset-bottom, 0px))`,
      '--width': '100vw',
      '--border-radius': '12px 12px 0 0',
      '--fade-background-rgb': '5, 5, 5',
      alignItems: 'flex-end',
      overflow: 'hidden',
    }"
    @did-dismiss="emit('close')">
    <IonHeader>
      <IonToolbar>
        <IonButtons slot="start">
          <IonButton v-if="view === 'key'" @click="view = 'moods'">back</IonButton>
          <IonButton v-else @click="emit('close')">cancel</IonButton>
        </IonButtons>
        <div class="channel-title">the channel</div>
        <IonButtons slot="end">
          <IonButton v-if="view === 'key'" @click="confirmKey">done</IonButton>
        </IonButtons>
      </IonToolbar>
    </IonHeader>
    <IonContent :scroll-y="false">
      <div v-if="view === 'moods'" class="mood-sheet">
        <div class="mood-grid">
          <button class="mood-pill mood-pill--open" :class="{ selected: !settingsStore.keyLocked }" @click="chooseOpen">
            open
          </button>
          <button
            v-for="mood in MOODS"
            :key="mood.id"
            class="mood-pill"
            :class="{ selected: settingsStore.keyLocked && settingsStore.moodId === mood.id }"
            @click="chooseMood(mood.id)">
            {{ mood.label }}
          </button>
        </div>
        <button class="choose-key" @click="view = 'key'">choose a key…</button>
      </div>

      <div v-else class="key-lists">
        <div ref="rootColRef" class="key-col key-col--root">
          <button
            v-for="(name, pc) in NOTE_NAMES"
            :key="pc"
            class="key-row"
            :class="{ selected: draftRoot === pc }"
            @click="draftRoot = pc">
            {{ name }}
          </button>
        </div>
        <div ref="scaleColRef" class="key-col key-col--scale">
          <button
            v-for="scale in CHANNEL_SCALES"
            :key="scale.id"
            class="key-row"
            :class="{ selected: draftScale === scale.id }"
            @click="draftScale = scale.id">
            {{ scale.name }}
          </button>
        </div>
      </div>
    </IonContent>
  </IonModal>
</template>

<script setup lang="ts">
  // The channel drawer — Home's "the channel" row and SessionView's streams-header chip both
  // open this same drawer. Two views: the mood chooser (every word visible at once, tap one
  // to lock the channel to it with a rolled root; "open" = no lock), and "choose a key…" —
  // a key/scale pair in two scrolling columns, like Logic's Scale Quantize. The key view
  // works on a draft and only writes settingsStore on "done", same cancel/done contract as
  // the starting-notes picker, so backing out never leaves a half-changed lock behind. A mood
  // tap commits immediately (there's nothing to draft).
  import { ref, watch, nextTick } from 'vue'
  import { IonModal, IonHeader, IonToolbar, IonButtons, IonButton, IonContent } from '@ionic/vue'
  import { useSettingsStore } from '../../stores/settingsStore'
  import { SCALES } from '../../data/scales'
  import { MOODS } from '../../data/moods'
  import { NOTE_NAMES } from '../../data/notes'

  // `relock`: opened from the session's lock icon while the lock is off — the last mood
  // stays highlighted, and tapping it re-locks to it. `fitNotes`: the current cluster
  // mid-flow, so a chosen mood's rolled root keeps those notes in key where it can.
  const props = defineProps<{ isOpen: boolean; relock?: boolean; fitNotes?: number[] }>()
  // 'confirm' fires after the store is updated, so a parent can react to the new lock
  // (SessionView regenerates stream candidates); 'close' fires on any dismissal.
  const emit = defineEmits<{ (e: 'close'): void; (e: 'confirm'): void }>()

  // Chromatic is excluded from the scale column — it *is* the open state.
  const CHANNEL_SCALES = SCALES.filter(s => s.id !== 'chromatic')

  const settingsStore = useSettingsStore()
  const view = ref<'moods' | 'key'>('moods')
  const draftRoot = ref<number>(0)
  const draftScale = ref<string>(settingsStore.scaleId)

  watch(
    () => props.isOpen,
    open => {
      if (!open) return
      view.value = 'moods'
      draftRoot.value = settingsStore.keyRoot % 12
      draftScale.value = settingsStore.scaleId
    },
    { immediate: true }
  )

  // The key view scrolls two plain lists rather than an IonPicker wheel: Ionic hard-codes
  // its wheel at 200px (34px rows; the fade overlays, empty-row padding and scroll maths all
  // assume it), so it can't be made taller — and at 200px inside this drawer it read as
  // smushed. These keep the same two-column shape with 44px rows and ~6 visible at once. On
  // entering the view, each column is scrolled so its selected row sits mid-height.
  const rootColRef = ref<HTMLElement | null>(null)
  const scaleColRef = ref<HTMLElement | null>(null)
  function centerSelected(col: HTMLElement | null) {
    const row = col?.querySelector<HTMLElement>('.selected')
    if (!col || !row) return
    col.scrollTop = row.offsetTop - col.clientHeight / 2 + row.offsetHeight / 2
  }
  watch(view, async v => {
    if (v !== 'key') return
    await nextTick()
    centerSelected(rootColRef.value)
    centerSelected(scaleColRef.value)
  })

  function chooseOpen() {
    settingsStore.setKeyLocked(false)
    emit('confirm')
    emit('close')
  }

  function chooseMood(id: string) {
    settingsStore.applyMood(id, props.fitNotes)
    emit('confirm')
    emit('close')
  }

  function confirmKey() {
    settingsStore.setMoodId(null)
    settingsStore.setScaleId(draftScale.value)
    settingsStore.setKeyRoot(60 + draftRoot.value)
    settingsStore.setKeyLocked(true)
    emit('confirm')
    emit('close')
  }
</script>

<style scoped>
  .mood-sheet {
    padding: 0.75rem 1rem 0.5rem;
  }

  .mood-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
  }

  .mood-pill {
    min-height: var(--tap-min, 44px);
    padding: 0 0.5rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: var(--text-base);
    text-align: center;
  }

  .mood-pill--open {
    color: var(--color-text-dim);
  }

  .mood-pill.selected {
    background: var(--color-accent);
    border-color: var(--color-accent);
    color: var(--color-text);
  }

  .choose-key {
    display: block;
    margin: 0.75rem auto 0;
    min-height: var(--tap-min, 44px);
    padding: 0 1rem;
    background: none;
    border: none;
    color: var(--color-text-dim);
    font-family: var(--font-sans);
    font-size: var(--text-base);
  }

  /* Key view: two scrolling columns (root narrow, scale wide). Fixed height with the content
     taller than it, so the half-faded rows at each edge say "there's more". */
  .key-lists {
    display: flex;
    gap: 0.5rem;
    height: 100%;
    padding: 0 1rem;
  }

  .key-col {
    position: relative;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    padding: 0.75rem 0;
    -webkit-mask-image: linear-gradient(to bottom, transparent, #000 14%, #000 86%, transparent);
    mask-image: linear-gradient(to bottom, transparent, #000 14%, #000 86%, transparent);
  }
  .key-col::-webkit-scrollbar {
    display: none;
  }
  .key-col--root {
    flex: 0 0 5rem;
  }
  .key-col--scale {
    flex: 1;
  }

  .key-row {
    display: block;
    width: 100%;
    min-height: var(--tap-min, 44px);
    padding: 0 0.75rem;
    background: none;
    border: none;
    border-radius: 8px;
    color: var(--color-text-dim);
    font-family: var(--font-sans);
    font-size: 20px;
    text-align: left;
    white-space: nowrap;
  }
  .key-row.selected {
    background: var(--color-surface-2);
    color: var(--color-text);
  }

  .channel-title {
    text-align: center;
    font-size: var(--text-label);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--color-text-dim);
  }
</style>
