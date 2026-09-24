<template>
  <ion-page>
    <ion-alert
      :is-open="showContinuePrompt"
      header="continue where you left off?"
      :message="activeFlowMessage"
      :buttons="continueAlertButtons"
      @didDismiss="showContinuePrompt = false" />

    <ion-content class="ion-padding" fullscreen>
      <button class="icon-btn about-btn" @click="showAbout = true">
        <IonIcon :icon="helpCircleOutline" />
      </button>
      <AboutModal :is-open="showAbout" @close="showAbout = false" />

      <div class="home-layout">
        <!-- Title -->
        <div class="title-block">
          <h1 class="app-title">eddy</h1>
          <p class="app-tagline">let the music move itself</p>
        </div>

        <!-- Trigger rows -->
        <div class="option-list secondary-block">
          <!-- The current (settings) -->
          <button class="option-btn trigger-row" @click="settingsOpen = true">
            <span class="trigger-label">the current</span>
            <span class="trigger-value"
              >{{ voiceCount }}v · {{ movementLabel }} ·
              {{ instrumentLabel }}</span
            >
            <ion-icon class="trigger-arrow" :icon="chevronForwardOutline" />
          </button>

          <!-- Past flows (saved sessions) -->
          <button class="option-btn trigger-row" @click="openSessions">
            <span class="trigger-label">past flows</span>
            <span class="trigger-value">{{
              sessionCount > 0 ? sessionCount : 'none'
            }}</span>
            <ion-icon class="trigger-arrow" :icon="chevronForwardOutline" />
          </button>

          <!-- The source (starting notes) -->
          <div class="trigger-row trigger-row--source">
            <button class="option-btn source-main" @click="openPicker">
              <span class="trigger-label">the source</span>
              <span
                class="trigger-value"
                :class="{ 'trigger-value--notes': showManual }">
                <template v-if="showManual">
                  <span
                    v-for="(midi, i) in manualMidi.slice(0, voiceCount)"
                    :key="i"
                    class="preview-note"
                    :style="{ color: voiceColors[i] }">
                    {{ midiToName(midi) }}
                  </span>
                </template>
                <template v-else>
                  <span class="trigger-hint-main">random</span>
                  <span class="trigger-hint-sub">tap to choose</span>
                </template>
              </span>
              <ion-icon v-if="!showManual" class="trigger-arrow" :icon="chevronForwardOutline" />
            </button>
            <button
              v-if="showManual"
              class="row-edge-btn"
              @click="resetToRandom"
              title="reset to random">
              <ion-icon :icon="closeOutline" />
            </button>
          </div>
        </div>

        <!-- Primary action -->
        <div class="start-block">
          <button
            class="btn-primary"
            @click="showManual ? startManual() : startRandom()">
            {{ showManual ? 'flow from here' : 'let it flow' }}
          </button>
        </div>

        <p v-if="manualError" class="error-msg">{{ manualError }}</p>
      </div>

      <!-- Settings sheet -->
      <IonModal
        :is-open="settingsOpen"
        :breakpoints="[0, 1]"
        :initial-breakpoint="1"
        :handle="true"
        @did-dismiss="settingsOpen = false">
        <ion-content>
          <div class="sheet-content">
            <p class="sheet-title">the current</p>

            <div class="sheet-group">
              <p class="sheet-label">voices</p>
              <IonSegment
                :value="voiceCount"
                @ionChange="settingsStore.setVoiceCount(Number(($event as CustomEvent).detail.value) as 3 | 4)">
                <IonSegmentButton v-for="n in [3, 4]" :key="n" :value="n">
                  <IonLabel>{{ n }}</IonLabel>
                </IonSegmentButton>
              </IonSegment>
            </div>

            <div class="sheet-group">
              <p class="sheet-label">drift</p>
              <IonSegment
                class="drift-segment"
                :value="movementSize"
                @ionChange="settingsStore.setMovementSize(($event as CustomEvent).detail.value)">
                <IonSegmentButton v-for="m in movementOptions" :key="m.value" :value="m.value">
                  <IonLabel>{{ m.label }}</IonLabel>
                </IonSegmentButton>
              </IonSegment>
            </div>

            <div class="sheet-group">
              <p class="sheet-label">sound</p>
              <div class="option-list">
                <button
                  v-for="inst in instrumentOptions"
                  :key="inst.value"
                  class="option-btn"
                  :class="{ active: settingsStore.instrument === inst.value }"
                  @click="settingsStore.setInstrument(inst.value as any)">
                  {{ inst.label }}
                </button>
              </div>
            </div>

            <button class="btn-primary" @click="saveDefault()">
              save as default
            </button>
          </div>
        </ion-content>
      </IonModal>

      <!-- Past flows sheet -->
      <IonModal
        :is-open="sessionsOpen"
        :breakpoints="[0, 0.6, 1]"
        :initial-breakpoint="1"
        :handle="true"
        @did-dismiss="sessionsOpen = false">
        <ion-content>
          <div class="sheet-content">
            <SavedSessions @load="loadSession" />
          </div>
        </ion-content>
      </IonModal>
    </ion-content>

    <!-- Note picker modal -->
    <IonModal
      class="picker-modal"
      :is-open="pickerOpen"
      style="
        --height: 244px;
        --width: 100vw;
        --border-radius: 12px 12px 0 0;
        --fade-background-rgb: 5, 5, 5;
        align-items: flex-end;
        overflow: hidden;
      "
      @did-dismiss="onPickerDismiss">
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton @click="cancelPicker">cancel</IonButton>
          </IonButtons>
          <div class="octave-transpose">
            <button
              class="icon-btn transpose-btn"
              :disabled="!canTransposeDown"
              title="down an octave"
              @click="transposePicker(-1)">−12</button>
            <button
              class="icon-btn transpose-btn"
              :disabled="!canTransposeUp"
              title="up an octave"
              @click="transposePicker(1)">+12</button>
          </div>
          <IonButtons slot="end">
            <IonButton @click="previewPicker">
              <IonIcon slot="icon-only" :icon="playOutline" />
            </IonButton>
            <IonButton @click="confirmPicker">done</IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent :scroll-y="false">
        <IonPicker>
          <IonPickerColumn
            v-for="(_, i) in Array(voiceCount)"
            :key="i"
            :value="manualMidi[i]"
            @ion-change="onColumnChange(i, $event)">
            <IonPickerColumnOption
              v-for="midi in validMidiRange"
              :key="midi"
              :value="midi"
              :style="{ color: voiceColors[i] }">
              {{ midiToName(midi) }}
            </IonPickerColumnOption>
          </IonPickerColumn>
        </IonPicker>
      </IonContent>
    </IonModal>

    <!-- Save default toast -->
    <IonToast
      :is-open="toastOpen"
      message="default saved"
      :duration="2000"
      position="bottom"
      @did-dismiss="toastOpen = false" />
  </ion-page>
</template>

<script setup lang="ts">
  import { ref, computed, watch, onMounted } from 'vue'
  import { useRouter } from 'vue-router'
  import { onIonViewWillEnter } from '@ionic/vue'
  import {
    IonPage,
    IonContent,
    IonModal,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonButton,
    IonIcon,
    IonPicker,
    IonPickerColumn,
    IonPickerColumnOption,
    IonToast,
    IonAlert,
    IonSegment,
    IonSegmentButton,
    IonLabel,
  } from '@ionic/vue'
  import { playOutline, helpCircleOutline, closeOutline, chevronForwardOutline } from 'ionicons/icons'
  import AboutModal from '../components/ui/AboutModal.vue'
  import SavedSessions from '../components/ui/SavedSessions.vue'
  import type { SavedSession } from '../utils/sessionStorage'
  import { listSessions } from '../utils/sessionStorage'
  import { useSettingsStore } from '../stores/settingsStore'
  import { useSequenceStore } from '../stores/sequenceStore'
  import { useAudioEngine, INSTRUMENT_NOTE_RANGE } from '../composables/useAudioEngine'
  import {
    midiToName,
    MAX_CLUSTER_SPREAD,
  } from '../data/notes'
  import type { Cluster } from '../utils/noteUtils'
  import { isValidCluster, sortCluster, canTransposeOctave } from '../utils/noteUtils'

  const VOICE_COLORS = [
    'var(--voice-1)',
    'var(--voice-2)',
    'var(--voice-3)',
    'var(--voice-4)',
  ]

  const movementOptions = [
    { label: '½ step', value: 'half' },
    { label: '½–1 step', value: 'step' },
    { label: '1 step', value: 'whole' },
    { label: '≤ 3rd', value: 'third' },
    { label: 'free', value: 'free' },
  ]

  const instrumentOptions = [
    { label: 'piano', value: 'piano' },
    { label: 'electric piano', value: 'electric-piano' },
    { label: 'acoustic guitar', value: 'guitar-acoustic' },
    { label: 'electric guitar', value: 'electric-guitar' },
    { label: 'holdsworthian pad', value: 'holdsworthian-pad' },
  ]

  const router = useRouter()
  const settingsStore = useSettingsStore()
  const sequenceStore = useSequenceStore()
  const { init, playCluster } = useAudioEngine()

  const voiceCount = computed(() => settingsStore.voiceCount)
  const movementSize = computed(() => settingsStore.movementSize)
  const voiceColors = VOICE_COLORS

  const movementLabel = computed(
    () =>
      movementOptions.find((m) => m.value === movementSize.value)?.label ??
      movementSize.value
  )

  const instrumentLabel = computed(
    () =>
      instrumentOptions.find((i) => i.value === settingsStore.instrument)
        ?.label ?? settingsStore.instrument
  )

  const showAbout = ref(false)
  const showManual = ref(false)
  const settingsOpen = ref(false)
  const sessionsOpen = ref(false)
  const pickerOpen = ref(false)
  const manualError = ref('')
  const sessionCount = ref(0)

  const manualMidi = ref<number[]>([48, 52, 55, 59])
  const instrumentRange = computed(() => INSTRUMENT_NOTE_RANGE[settingsStore.instrument])
  const validMidiRange = computed(() => {
    const { min, max } = instrumentRange.value
    return Array.from({ length: max - min + 1 }, (_, i) => min + i)
  })

  // Keep manual selections inside the picker range if the instrument changes underneath them
  watch(instrumentRange, ({ min, max }) => {
    manualMidi.value = manualMidi.value.map(midi => Math.min(Math.max(midi, min), max))
  })

  const canTransposeUp = computed(() =>
    canTransposeOctave(manualMidi.value.slice(0, voiceCount.value), 1, instrumentRange.value)
  )
  const canTransposeDown = computed(() =>
    canTransposeOctave(manualMidi.value.slice(0, voiceCount.value), -1, instrumentRange.value)
  )

  function transposePicker(direction: 1 | -1) {
    if (!canTransposeOctave(manualMidi.value.slice(0, voiceCount.value), direction, instrumentRange.value)) return
    for (let i = 0; i < voiceCount.value; i++) {
      manualMidi.value[i] += direction * 12
    }
  }

  const pickerSnapshot = ref<{ midi: number[]; showManual: boolean } | null>(
    null
  )
  const pickerConfirmed = ref(false)
  const toastOpen = ref(false)
  const showContinuePrompt = ref(false)

  onMounted(() => {
    settingsStore.loadDefaults()
    sessionCount.value = listSessions().length
  })

  onIonViewWillEnter(() => {
    sessionCount.value = listSessions().length
    // The source picker is single-use pre-session config — never let a prior manual
    // selection linger once we're back at Home (Ionic keeps this component instance
    // alive across the round trip, so local refs don't reset on their own).
    showManual.value = false
    manualMidi.value = [48, 52, 55, 59]
    if (sequenceStore.sequence.length > 0) {
      showContinuePrompt.value = true
    }
  })

  const activeFlowMessage = computed(() => {
    const id = sequenceStore.savedSessionId
    if (!id) return "You have an active flow that hasn't been saved. Continue it, or start fresh?"
    const name = listSessions().find(s => s.id === id)?.name ?? 'this flow'
    return `You have an active flow (saved as "${name}"). Continue it, or start fresh?`
  })

  function continueFlow() {
    showContinuePrompt.value = false
    router.push('/session')
  }

  function startFreshFromHome() {
    sequenceStore.reset()
    showContinuePrompt.value = false
  }

  const continueAlertButtons = [
    { text: 'start fresh', role: 'destructive', handler: startFreshFromHome },
    { text: 'continue', handler: continueFlow },
  ]

  function openPicker() {
    pickerSnapshot.value = {
      midi: [...manualMidi.value],
      showManual: showManual.value,
    }
    pickerConfirmed.value = false
    pickerOpen.value = true
    showManual.value = true
  }

  function confirmPicker() {
    pickerConfirmed.value = true
    pickerOpen.value = false
  }

  function cancelPicker() {
    pickerOpen.value = false
  }

  async function previewPicker() {
    await init(settingsStore.instrument)
    const cluster = manualMidi.value.slice(0, settingsStore.voiceCount) as Cluster
    playCluster(cluster, {
      bpm: settingsStore.tempo,
      direction: settingsStore.arpeggioDirection,
      subdivision: settingsStore.subdivision,
    })
  }

  function resetToRandom() {
    showManual.value = false
    manualError.value = ''
  }

  function onPickerDismiss() {
    pickerOpen.value = false
    if (!pickerConfirmed.value) {
      const snap = pickerSnapshot.value
      if (snap) {
        manualMidi.value = [...snap.midi]
        showManual.value = snap.showManual
      }
    }
  }

  function saveDefault() {
    settingsStore.saveAsDefault()
    settingsOpen.value = false
    toastOpen.value = true
  }

  function openSessions() {
    sessionCount.value = listSessions().length
    sessionsOpen.value = true
  }

  function onColumnChange(voiceIndex: number, event: CustomEvent) {
    manualMidi.value[voiceIndex] = event.detail.value
  }

  async function startRandom() {
    await init(settingsStore.instrument)
    sequenceStore.randomStart(settingsStore.voiceCount)
    router.push('/session')
  }

  async function loadSession(session: SavedSession) {
    sessionsOpen.value = false
    if (session.instrument) settingsStore.setInstrument(session.instrument)
    await init(settingsStore.instrument)
    settingsStore.setVoiceCount(session.voiceCount as 3 | 4)
    sequenceStore.start(session.sequence[0], INSTRUMENT_NOTE_RANGE[settingsStore.instrument])
    for (let i = 1; i < session.sequence.length; i++) {
      sequenceStore.confirm(session.sequence[i])
    }
    sequenceStore.setSavedSessionId(session.id)
    router.push('/session')
  }

  async function startManual() {
    manualError.value = ''
    const selected = manualMidi.value.slice(0, settingsStore.voiceCount)
    const sorted = sortCluster(selected)
    const range = instrumentRange.value

    const outOfRange = sorted.find(n => n < range.min || n > range.max)
    if (outOfRange !== undefined) {
      manualError.value = `invalid cluster — note out of range for this instrument (${midiToName(range.min)}–${midiToName(range.max)})`
      return
    }
    const spread = sorted[sorted.length - 1] - sorted[0]
    if (spread > MAX_CLUSTER_SPREAD) {
      manualError.value = `invalid cluster — spread too wide (max ${MAX_CLUSTER_SPREAD} semitones)`
      return
    }
    if (new Set(sorted).size !== sorted.length) {
      manualError.value = 'invalid cluster — duplicate notes'
      return
    }
    if (!isValidCluster(sorted, range)) {
      manualError.value = 'invalid cluster'
      return
    }

    await init(settingsStore.instrument)
    sequenceStore.start(sorted, range)
    router.push('/session')
  }
</script>

<style scoped>
  /* .icon-btn (touch target, borderless base) comes from theme/buttons.css — about-btn
     adds the border/circle/position that make it read as a standalone floating
     affordance rather than toolbar chrome */
  .about-btn {
    position: absolute;
    top: calc(env(safe-area-inset-top, 0px) + 0.5rem);
    right: 1rem;
    border: 1px solid var(--color-border);
    border-radius: 50%;
    font-size: var(--icon-sm);
    z-index: 10;
  }
  .about-btn:hover {
    border-color: var(--color-text-dim);
  }

  .home-layout {
    display: flex;
    flex-direction: column;
    gap: 2.5rem;
    max-width: 420px;
    margin: 0 auto;
    padding-top: 6rem;
  }

  /* Title */
  .title-block {
    text-align: center;
  }

  .app-title {
    font-family: var(--font-serif);
    font-size: var(--text-2xl);
    font-weight: 300;
    letter-spacing: 0.08em;
    color: var(--color-text);
    margin: 0 0 0.4rem;
  }

  .app-tagline {
    font-family: var(--font-serif);
    font-size: var(--text-base);
    font-style: italic;
    font-weight: 300;
    letter-spacing: 0.06em;
    color: var(--color-text-dim);
    margin: 0;
  }

  /* Trigger rows — .option-list/.option-btn (box model, touch target) come from
     sheets.css; these rules only set the 3-column label/value/arrow content layout
     that's unique to this row shape */
  .trigger-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  /* Source row — split into main action + reset button. Not itself an .option-btn
     (it wraps two separate buttons), so it doesn't pick up option-list's automatic
     .option-btn + .option-btn divider — add the same border explicitly. */
  .trigger-row--source {
    display: flex;
    padding: 0;
    gap: 0;
    background: var(--color-surface);
    border-top: 1px solid var(--color-border);
  }

  .source-main {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
  }

  /* .row-edge-btn (box model, touch target) comes from theme/buttons.css */

  .trigger-label {
    font-size: var(--text-label);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--color-text-dim);
    flex-shrink: 0;
    white-space: nowrap;
    width: 5.5rem;
  }

  .trigger-value {
    font-size: var(--text-sm);
    color: var(--color-text);
    font-family: var(--font-mono);
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .trigger-hint-main {
    font-size: var(--text-sm);
    color: var(--color-text);
    font-family: var(--font-mono);
  }

  .trigger-hint-sub {
    font-size: var(--text-label);
    color: var(--color-text-dim);
    letter-spacing: 0.08em;
    font-family: inherit;
    flex-shrink: 0;
  }

  .trigger-arrow {
    font-size: var(--icon-sm);
    color: var(--color-text-dim);
    flex-shrink: 0;
  }

  .trigger-value--notes {
    justify-content: flex-start;
    gap: 0;
  }

  .preview-note {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    letter-spacing: 0.04em;
  }
  .preview-note + .preview-note::before {
    content: '·';
    color: var(--color-text-dim);
    margin: 0 0.35rem;
  }

  /* Primary button */
  .start-block {
    width: 100%;
  }

  .error-msg {
    font-size: var(--text-xs);
    color: #e07878;
    margin: 0;
    text-align: center;
  }

  /* Settings sheet — HomeView-specific */
</style>
