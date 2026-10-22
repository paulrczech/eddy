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

          <!-- The channel (key/scale lock) — feeds the source below, so it sits above it -->
          <div class="trigger-row trigger-row--split">
            <button class="option-btn source-main" @click="channelOpen = true">
              <span class="trigger-label">the channel</span>
              <span class="trigger-value">
                <span class="trigger-hint-main">{{ channelLabel }}</span>
                <ion-icon v-if="!settingsStore.keyLocked" class="trigger-arrow" :icon="chevronForwardOutline" />
              </span>
            </button>
            <button
              v-if="settingsStore.keyLocked"
              class="row-edge-btn"
              @click="settingsStore.setKeyLocked(false)"
              title="open the channel (no lock)">
              <ion-icon :icon="closeOutline" />
            </button>
          </div>

          <!-- The source (starting notes) -->
          <div class="trigger-row trigger-row--split">
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
        <p v-else-if="sourceOutsideChannel" class="channel-note">
          some notes sit outside {{ channelLabel }} —<br />they settle in as voices move
        </p>
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

            <div class="sheet-group">
              <p class="sheet-label">starting streams</p>
              <IonSegment
                class="seed-count-segment"
                :value="settingsStore.seedStreamCount"
                @ionChange="settingsStore.setSeedStreamCount(Number(($event as CustomEvent).detail.value))">
                <IonSegmentButton v-for="n in [1, 2, 3, 4, 5, 6, 7, 8]" :key="n" :value="n">
                  <IonLabel>{{ n }}</IonLabel>
                </IonSegmentButton>
              </IonSegment>
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
              <span class="picker-opt-text">{{ midiToName(midi) }}</span>
            </IonPickerColumnOption>
          </IonPickerColumn>
        </IonPicker>
      </IonContent>
    </IonModal>

    <ChannelPicker :is-open="channelOpen" @close="channelOpen = false" />

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
  import ChannelPicker from '../components/ui/ChannelPicker.vue'
  import type { SavedSession } from '../utils/sessionStorage'
  import { listSessions } from '../utils/sessionStorage'
  import { useSettingsStore, SHOW_ANALOG_SYNTH_TEMP, SHOW_GUITAR_2_TEMP } from '../stores/settingsStore'
  import { useSequenceStore } from '../stores/sequenceStore'
  import { useAudioEngine, INSTRUMENT_NOTE_RANGE } from '../composables/useAudioEngine'
  import { useStrategyDeck } from '../composables/useStrategyDeck'
  import { generateCandidates } from '../composables/useVoiceLeading'
  import {
    midiToName,
    MAX_CLUSTER_SPREAD,
    NOTE_NAMES,
  } from '../data/notes'
  import { SCALE_MAP, getScaleNotes } from '../data/scales'
  import { MOOD_MAP } from '../data/moods'
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
    { label: 'piano', value: 'piano-salamander' },
    { label: 'felt piano', value: 'piano' },
    { label: 'acoustic guitar', value: 'guitar-acoustic' },
    ...(SHOW_GUITAR_2_TEMP ? [{ label: 'acoustic guitar 2 (temp)', value: 'guitar-acoustic-2-temp' }] : []),
    { label: 'electric guitar', value: 'electric-guitar' },
    { label: 'synth strings', value: 'synth-strings' },
    ...(SHOW_ANALOG_SYNTH_TEMP ? [{ label: 'analog synth', value: 'analog-synth-temp' }] : []),
  ]

  const router = useRouter()
  const settingsStore = useSettingsStore()
  const sequenceStore = useSequenceStore()
  const { init, playCluster, setAmbience } = useAudioEngine()

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

  const channelOpen = ref(false)
  // "open" = no key lock; a mood shows as its word (the root is rolled at flow start, so
  // no key to show); a hand-picked key as e.g. "C lydian" (sharps only, per the app-wide rule)
  const channelLabel = computed(() =>
    settingsStore.keyLocked
      ? (settingsStore.moodId && MOOD_MAP[settingsStore.moodId]?.label) ||
        `${NOTE_NAMES[settingsStore.keyRoot % 12]} ${(SCALE_MAP[settingsStore.scaleId]?.name ?? '').toLowerCase()}`
      : 'open'
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

  // A hand-entered source isn't blocked by the channel — the lock constrains movement, not
  // the seed — but say so when some of its notes sit outside it, since those notes only
  // settle in once their voice moves (a held voice keeps its note).
  const sourceOutsideChannel = computed(() => {
    // A mood's root is chosen to fit the source when the flow starts, so there's nothing to warn about
    if (!showManual.value || !settingsStore.keyLocked || settingsStore.moodId) return false
    const inKey = new Set(getScaleNotes(settingsStore.keyRoot, settingsStore.scaleId, 0, 127))
    return manualMidi.value.slice(0, voiceCount.value).some(n => !inKey.has(n))
  })

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
    // Reset here, before any note is picked, rather than in startManual() at confirm
    // time — resetting instrument that late could invalidate notes already chosen
    // against a different instrument's range. This way the picker itself reflects the
    // correct, already-reset instrument range from the moment it opens.
    settingsStore.resetPlaybackDefaults()
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
    setAmbience(settingsStore.ambience)
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

  // Auto-chains `count - 1` real voice-led steps onto whatever single cluster start()/
  // randomStart() just seeded, before the session ever becomes visible — a strategy
  // drawn, candidates generated from the previous step, one picked at random, confirmed,
  // repeat. Deliberately the exact same draw-generate-confirm shape SessionView.vue's own
  // advance() uses (same retry-on-dead-end bound, same VoiceLeadingOptions shape), just
  // run here with a random pick instead of a tap, and run in a tight loop instead of one
  // step per user action (Paul, 2026-10-10 — a workflow he'd found through real use:
  // generate several rough streams fast, then hand-edit each one, rather than one
  // strategy card at a time). A fresh useStrategyDeck() instance scoped to just this
  // call — entirely separate from the one SessionView.vue instantiates once the user
  // actually lands there, so nothing here leaks into or interferes with that screen's own
  // deck state. If a drawn strategy ever has no valid moves even after retrying, the
  // chain just stops early rather than looping forever or pushing an invalid cluster —
  // same "always have a bounded, safe fallback" principle randomStart() itself follows
  // for the seed cluster.
  function autoChainStreams(count: number) {
    if (count <= 1) return
    const { draw } = useStrategyDeck(() => settingsStore.keyLockActive)
    for (let i = 1; i < count; i++) {
      const current = sequenceStore.currentCluster
      if (!current) break
      let attempts = 0
      let candidates: Cluster[] = []
      while (attempts < 5 && candidates.length === 0) {
        const drawn = draw()
        if (!drawn) break
        candidates = generateCandidates(current, drawn, {
          keyLockActive: settingsStore.keyLockActive,
          keyRoot: settingsStore.keyRoot,
          scaleId: settingsStore.scaleId,
          movement: settingsStore.movementSize,
        })
        attempts++
      }
      if (candidates.length === 0) break
      sequenceStore.confirm(candidates[Math.floor(Math.random() * candidates.length)])
    }
  }

  async function startRandom() {
    // A new flow starts from the default playback settings, not whatever tempo/
    // direction/grid/instrument a previous flow happened to leave live in the store —
    // those have no "choose before starting" step on this screen the way voiceCount/
    // movementSize do, so without this they'd silently carry over stale.
    settingsStore.resetPlaybackDefaults()
    await init(settingsStore.instrument)
    setAmbience(settingsStore.ambience)
    settingsStore.rollMoodRoot()
    sequenceStore.randomStart(
      settingsStore.voiceCount,
      settingsStore.keyLocked
        ? { keyRoot: settingsStore.keyRoot, scaleId: settingsStore.scaleId }
        : undefined
    )
    autoChainStreams(settingsStore.seedStreamCount)
    router.push('/session')
  }

  async function loadSession(session: SavedSession) {
    sessionsOpen.value = false
    // Reset to defaults first, so an older save that predates tempo/direction/grid
    // being saved-with-a-flow falls back to the true default rather than to whatever
    // was left over from the session just prior to loading this one.
    settingsStore.resetPlaybackDefaults()
    if (session.instrument) settingsStore.setInstrument(session.instrument)
    if (session.tempo) settingsStore.setTempo(session.tempo)
    if (session.arpeggioDirection) settingsStore.setArpeggioDirection(session.arpeggioDirection)
    if (session.subdivision) settingsStore.setSubdivision(session.subdivision)
    if (session.timeSignature) settingsStore.setTimeSignature(session.timeSignature)
    // latchMode is a boolean — an explicit `false` is a meaningful saved value, not the
    // same as "this older save predates the field," so this can't use the same truthy
    // check as the fields above (which would wrongly treat a saved `false` as absent).
    if (session.latchMode !== undefined) settingsStore.setLatchMode(session.latchMode)
    // ambience is a 0-1 float — 0 is a meaningful saved value (fully dry), same reasoning
    // as the latchMode check above, so this can't use a truthy check either.
    if (session.ambience !== undefined) settingsStore.setAmbience(session.ambience)
    // Channel: older saves predate it (undefined -> open). Always assigned, never left over
    // from whatever the previous flow had locked.
    settingsStore.setKeyLocked(session.keyLocked ?? false)
    settingsStore.setMoodId(session.moodId ?? null)
    if (session.keyRoot !== undefined) settingsStore.setKeyRoot(session.keyRoot)
    if (session.scaleId) settingsStore.setScaleId(session.scaleId)
    await init(settingsStore.instrument)
    setAmbience(settingsStore.ambience)
    settingsStore.setVoiceCount(session.voiceCount as 3 | 4)
    sequenceStore.start(session.sequence[0], INSTRUMENT_NOTE_RANGE[settingsStore.instrument])
    // start() rolls a fresh accent pattern; a saved flow keeps its own (older saves: 0).
    sequenceStore.setVelocitySeed(session.velocitySeed ?? 0)
    for (let i = 1; i < session.sequence.length; i++) {
      sequenceStore.confirm(session.sequence[i])
    }
    // start()/confirm() above never touch pools — restore them after the sequence is
    // fully rebuilt (older saves predating pools just leave this empty, same optional-
    // field treatment as every other field above).
    sequenceStore.pools = session.pools ? session.pools.map(p => ({ ...p, range: [...p.range] as [number, number] })) : []
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
    setAmbience(settingsStore.ambience)
    settingsStore.rollMoodRoot(sorted)
    sequenceStore.start(sorted, range)
    autoChainStreams(settingsStore.seedStreamCount)
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

  /* Split rows (the channel, the source) — main action + reset button. Not itself an .option-btn
     (it wraps two separate buttons), so it doesn't pick up option-list's automatic
     .option-btn + .option-btn divider — add the same border explicitly. */
  .trigger-row--split {
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

  .channel-note {
    font-size: var(--text-xs);
    color: var(--color-text);
    margin: 0;
    text-align: center;
  }

  .error-msg {
    font-size: var(--text-xs);
    color: #e07878;
    margin: 0;
    text-align: center;
  }

  /* Settings sheet — HomeView-specific */
</style>
