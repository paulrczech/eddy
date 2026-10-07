<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <button class="back-to-home" @click="goHome">
            <ion-icon :icon="arrowBack" /> new
          </button>
        </ion-buttons>
        <ion-title class="session-title">eddy</ion-title>
        <ion-buttons slot="end">
          <button
            class="icon-btn save-btn"
            :disabled="sequenceStore.sequence.length < 1"
            @click="save"
            title="save session">
            <ion-icon :icon="saveIcon" />
          </button>
          <button
            class="icon-btn"
            :disabled="!sequenceStore.canUndo"
            @click="goUndo"
            title="undo">
            <ion-icon :icon="arrowUndoIcon" />
          </button>
          <button
            class="icon-btn"
            :disabled="!sequenceStore.canRedo"
            @click="goRedo"
            title="redo">
            <ion-icon :icon="arrowRedoIcon" />
          </button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-alert
      :is-open="showResetConfirm"
      header="start fresh?"
      message="This clears the current flow. Anything unsaved will be lost."
      :buttons="resetAlertButtons"
      @didDismiss="showResetConfirm = false" />

    <ion-alert
      :is-open="showSaveConfirm"
      header="overwrite or save new?"
      :message="`This flow was already saved as &quot;${savedSessionName}&quot;. Overwrite it, or save this as a new flow?`"
      :buttons="saveAlertButtons"
      @didDismiss="showSaveConfirm = false" />

    <ion-alert
      :is-open="showExportScopeConfirm"
      :header="`${exportScopeVerb} this loop, or the whole flow?`"
      :buttons="exportScopeAlertButtons"
      @didDismiss="showExportScopeConfirm = false; pendingExportRun = null" />

    <IonToast
      :is-open="savedFlash"
      message="saved"
      :duration="1500"
      position="bottom"
      @did-dismiss="savedFlash = false" />

    <IonToast
      :is-open="recoveryToastOpen"
      :message="recoveryToastMessage"
      :duration="recoveryStatus === 'failed' ? 3000 : undefined"
      position="bottom"
      @did-dismiss="onRecoveryToastDismiss" />

    <ion-content class="ion-padding" fullscreen>
      <div class="session-layout">
        <!-- Loop resolved banner -->
        <div v-if="sequenceStore.loopResolved" class="loop-banner">
          a loop has formed — {{ sequenceStore.moveCount }} moves
        </div>

        <!-- Strategy card -->
        <StrategyCard
          v-if="activeStrategy && !sequenceStore.loopResolved"
          :strategy="activeStrategy" />

        <!-- Current cluster — the last confirmed move, always tappable to hear -->
        <button
          v-if="sequenceStore.currentCluster"
          ref="nowBlockRef"
          class="current-cluster-block"
          @click="playCurrentCluster">
          <p class="section-label">now</p>
          <div class="current-row">
            <ClusterDisplay :cluster="sequenceStore.currentCluster" />
            <IonIcon class="now-glyph" :icon="playOutline" aria-hidden="true" />
          </div>
        </button>

        <!-- Candidates -->
        <div
          v-if="!sequenceStore.loopResolved && candidates.length > 0"
          ref="candidatesBlockRef"
          class="candidates-block">
          <div class="candidates-header">
            <p class="section-label">streams — tap to hear</p>
            <div class="streams-actions">
              <button
                class="icon-btn refresh-streams-btn"
                aria-label="another"
                @click="redraw">
                <IonIcon :icon="refreshOutline" />
              </button>
              <button
                class="btn-outline multi-toggle"
                :class="{ active: multiSelect }"
                @click="toggleMultiSelect">
                multi
              </button>
            </div>
          </div>
          <div class="candidates-grid" :class="{ 'multi-active': multiSelect }">
            <button
              v-for="(cluster, i) in candidates"
              :key="clusterKey(cluster)"
              class="candidate-pill"
              :class="{ selected: selectionOrder(i) > 0, 'single-candidate': candidates.length === 1 }"
              @click="selectCandidate(cluster, i)">
              <span class="pill-order" v-if="selectionOrder(i) > 0">{{
                selectionOrder(i)
              }}</span>
              <span
                v-for="(midi, v) in cluster"
                :key="v"
                class="pill-note"
                :style="{ color: voiceColors[v] }"
                >{{ midiToName(midi) }}</span
              >
            </button>
          </div>
        </div>

        <!-- No candidates warning -->
        <div
          v-else-if="
            !sequenceStore.loopResolved &&
            candidates.length === 0 &&
            activeStrategy
          "
          class="no-candidates">
          <p>
            no valid moves —
            <button class="inline-btn" @click="redraw">try another</button>
          </p>
        </div>

        <!-- Sequence history — fills remaining space -->
        <div v-if="sequenceStore.sequence.length > 0" class="flow-section">
          <SequenceHistory
            :sequence="sequenceStore.sequence"
            :loop-point="sequenceStore.loopPoint"
            :playing-index="displayPlayingIndex"
            @audition="auditionHistoryCluster"
            @preview="auditionHistoryCluster"
            @delete="deleteCluster"
            @edit="editCluster"
            @reorder="reorderClusters"
            @range-change="setLoopRange"
            @range-mode-change="onRangeModeChange"
            @range-tap="stopIfPlaying"
            @reverse-change="onReverseChange"
            @duplicate="duplicateCluster"
            @duplicate-range="duplicateRangeClusters" />
        </div>
      </div>

      <!-- Confirm button — slot="fixed" pins it above the footer regardless of scroll
           position; a plain sticky div doesn't work here because ion-content scrolls
           via an internal shadow-DOM element that CSS position:sticky can't reach. -->
      <div
        v-if="selectedIndices.length > 0 && !sequenceStore.loopResolved"
        ref="confirmBlockRef"
        slot="fixed"
        class="confirm-block">
        <button class="btn-primary" @click="confirmSelection">
          {{
            selectedIndices.length === 1
              ? 'add to the flow'
              : 'add these ' + selectedIndices.length + ' to the flow'
          }}
        </button>
      </div>
    </ion-content>

    <ion-footer class="playback-footer">
      <div class="footer-bar">
        <button
          class="btn-icon-outline play-stop"
          :class="{ playing: isPlaying }"
          :disabled="sequenceStore.sequence.length < 1"
          @click="isPlaying ? audioEngine.stopLoop(true) : handlePlay()">
          <ion-icon :icon="isPlaying ? stopOutline : playOutline" />
        </button>
        <button
          class="btn-icon-outline loop-toggle"
          :class="{ active: loopActive }"
          @click="toggleLoop">
          <ion-icon :icon="infiniteOutline" />
        </button>
        <ion-select
          interface="action-sheet"
          :value="settingsStore.instrument"
          class="instrument-select"
          @ionChange="
            settingsStore.setInstrument(($event as CustomEvent).detail.value)
          ">
          <ion-select-option value="piano-salamander">piano</ion-select-option>
          <ion-select-option value="piano">felt piano</ion-select-option>
          <ion-select-option value="electric-piano">e-piano</ion-select-option>
          <ion-select-option value="guitar-acoustic">guitar</ion-select-option>
          <ion-select-option value="electric-guitar"
            >e-guitar</ion-select-option
          >
          <ion-select-option v-if="SHOW_HOLDSWORTHIAN_PAD" value="holdsworthian-pad"
            >ambient pad</ion-select-option
          >
          <ion-select-option value="retro-pad"
            >retro pad</ion-select-option
          >
        </ion-select>
        <button
          class="icon-btn footer-expand-btn"
          :class="{ open: footerExpanded }"
          @click="footerExpanded = !footerExpanded">
          <ion-icon
            :icon="footerExpanded ? chevronDownOutline : chevronUpOutline" />
        </button>
      </div>

      <div class="footer-tray" :class="{ open: footerExpanded }">
        <div class="tray-inner">
          <div class="tray-row playback-row">
            <span class="tray-label playback-label">playback</span>
            <div class="toggle-row">
              <button
                v-for="d in directionOptions"
                :key="d.value"
                class="btn-icon-outline toggle-btn"
                :class="{ active: settingsStore.arpeggioDirection === d.value }"
                :disabled="isPadInstrument && d.value !== 'chord'"
                :title="isPadInstrument && d.value !== 'chord' ? 'a pad only really works as a chord — held, not arpeggiated' : undefined"
                @click="settingsStore.setArpeggioDirection(d.value as any)">
                <ion-icon :icon="d.icon" />
              </button>
              <button
                class="btn-icon-outline toggle-btn latch-btn"
                :class="{ active: settingsStore.latchMode }"
                :disabled="settingsStore.arpeggioDirection === 'chord'"
                title="latch — repeat to fill the bar"
                @click="settingsStore.setLatchMode(!settingsStore.latchMode)">
                <ion-icon :icon="settingsStore.latchMode ? lockClosedOutline : lockOpenOutline" />
              </button>
            </div>
            <div class="tempo-control">
              <button
                class="btn-icon-outline adj-btn"
                @pointerdown="startTempoHold(-1)"
                @pointerup="stopTempoHold"
                @pointerleave="stopTempoHold"
                @pointercancel="stopTempoHold">
                <ion-icon :icon="removeOutline" />
              </button>
              <span class="tempo-value">{{ settingsStore.tempo }}</span>
              <button
                class="btn-icon-outline adj-btn"
                @pointerdown="startTempoHold(1)"
                @pointerup="stopTempoHold"
                @pointerleave="stopTempoHold"
                @pointercancel="stopTempoHold">
                <ion-icon :icon="addOutline" />
              </button>
              <span class="tempo-unit">bpm</span>
              <div class="time-signature-toggle">
                <button
                  v-for="sig in TIME_SIGNATURE_OPTIONS"
                  :key="sig"
                  class="btn-outline time-sig-btn"
                  :class="{ active: settingsStore.timeSignature === sig }"
                  @click="settingsStore.setTimeSignature(sig)">
                  {{ sig }}
                </button>
              </div>
            </div>
          </div>
          <div class="grid-section">
            <div class="tray-row subdivision-row">
              <span class="tray-label">grid</span>
              <span class="subdivision-current">{{ subdivisionLabel }}</span>
            </div>
            <ion-range
              class="subdivision-range"
              :min="0"
              :max="4"
              :step="1"
              snaps
              ticks
              :pin="false"
              :value="subdivisionIndex"
              @ionChange="onSubdivisionChange">
            </ion-range>
            <div class="subdivision-labels">
              <button
                v-for="(step, i) in SUBDIVISION_STEPS"
                :key="step.label"
                class="icon-btn subdivision-label-btn"
                :title="step.label"
                @click="settingsStore.setSubdivision(step.value)">
                <NoteGlyph
                  :type="step.glyph"
                  :active="i === subdivisionIndex" />
              </button>
            </div>
          </div>
          <div v-if="SHOW_AMBIENCE_CONTROL" class="ambience-section">
            <div class="tray-row ambience-row">
              <span class="tray-label">ambience</span>
              <span class="ambience-current">{{ ambiencePercent }}%</span>
            </div>
            <ion-range
              class="ambience-range"
              :min="0"
              :max="100"
              :step="1"
              :pin="false"
              :value="ambiencePercent"
              @ionInput="onAmbienceInput">
            </ion-range>
          </div>
          <div
            v-if="sequenceStore.sequence.length > 1"
            class="tray-row export-row">
            <button class="btn-outline export-btn" @click="requestExport(exportMidi)">
              <ion-icon :icon="downloadOutline" /> midi
            </button>
            <button
              class="btn-outline export-btn"
              :disabled="exportingAudio"
              @click="requestExport(exportAudio)">
              <ion-icon :icon="downloadOutline" /> {{ exportingAudio ? 'rendering…' : 'wav' }}
            </button>
            <button class="btn-outline export-btn" @click="requestExport(copyText, 'copy')">
              {{ copiedFlash ? 'copied!' : 'copy text' }}
            </button>
          </div>
        </div>
      </div>
    </ion-footer>
  </ion-page>
</template>

<script setup lang="ts">
  import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
  import { onIonViewWillEnter } from '@ionic/vue'
  import { useRouter } from 'vue-router'
  import {
    IonPage,
    IonHeader,
    IonFooter,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButtons,
    IonSelect,
    IonSelectOption,
    IonIcon,
    IonAlert,
    IonRange,
    IonToast,
  } from '@ionic/vue'
  import {
    save as saveIcon,
    arrowUndo as arrowUndoIcon,
    arrowRedo as arrowRedoIcon,
    playOutline,
    stopOutline,
    infiniteOutline,
    shuffleOutline,
    arrowUpOutline,
    arrowBack,
    arrowDownOutline,
    swapVerticalOutline,
    handRightOutline,
    chevronUpOutline,
    chevronDownOutline,
    addOutline,
    removeOutline,
    downloadOutline,
    refreshOutline,
    lockClosedOutline,
    lockOpenOutline,
  } from 'ionicons/icons'

  import ClusterDisplay from '../components/cluster/ClusterDisplay.vue'
  import StrategyCard from '../components/strategy/StrategyCard.vue'
  import SequenceHistory from '../components/sequence/SequenceHistory.vue'
  import NoteGlyph from '../components/ui/NoteGlyph.vue'

  import { useSequenceStore } from '../stores/sequenceStore'
  import { useSettingsStore, SHOW_HOLDSWORTHIAN_PAD, type Subdivision, type TimeSignature, TIME_SIGNATURE_BEATS, type InstrumentType, type ArpeggioDirection } from '../stores/settingsStore'
  import { useAudioEngine } from '../composables/useAudioEngine'
  import { useStrategyDeck } from '../composables/useStrategyDeck'
  import { useLoopDetection } from '../composables/useLoopDetection'
  import { generateCandidates } from '../composables/useVoiceLeading'

  import { midiToName, MIDI_MIN, MIDI_MAX } from '../data/notes'
  import type { Strategy } from '../data/strategies'
  import type { Cluster } from '../utils/noteUtils'
  import { sortCluster } from '../utils/noteUtils'
  import {
    saveSession,
    overwriteSession,
    listSessions,
  } from '../utils/sessionStorage'
  import {
    exportSequenceAsMidi,
    exportSequenceAsText,
  } from '../utils/midiUtils'
  import { exportSequenceAsWav } from '../utils/audioExport'

  const VOICE_COLORS = [
    'var(--voice-1)',
    'var(--voice-2)',
    'var(--voice-3)',
    'var(--voice-4)',
  ]

  const router = useRouter()
  const sequenceStore = useSequenceStore()
  const settingsStore = useSettingsStore()
  const audioEngine = useAudioEngine()
  const { isPlaying, playingIndex, recoveryStatus } = audioEngine

  // Surfaces the audio engine's context-recovery guards (dead AudioContext after a
  // screen lock/interruption) instead of leaving a dropout silent and unexplained — see
  // DOWNRIVER.md's playback-dropout entry. "recovering" has no fixed duration since it
  // tracks a real in-flight attempt; "failed" auto-dismisses via the toast's own duration
  // (handled below) since that's just a one-time notice, not an ongoing state.
  const recoveryToastOpen = computed(() => recoveryStatus.value !== 'idle')
  const recoveryToastMessage = computed(() =>
    recoveryStatus.value === 'failed'
      ? 'no sound? tap to try again'
      : 'finding the current again…'
  )
  function onRecoveryToastDismiss() {
    if (recoveryStatus.value === 'failed') {
      audioEngine.resetRecoveryStatus()
    }
  }

  const { draw, reset: resetDeck } = useStrategyDeck(
    () => settingsStore.keyLockActive
  )
  const { findLoopPoint } = useLoopDetection()

  const candidates = ref<Cluster[]>([])
  const activeStrategy = ref<Strategy | null>(null)
  const selectedIndices = ref<number[]>([]) // ordered by tap — drives add sequence
  const savedFlash = ref(false)
  const copiedFlash = ref(false)
  const footerExpanded = ref(false)
  const multiSelect = ref(false)
  const voiceColors = VOICE_COLORS

  // A selected stream (and the floating "add to the flow" button it summons) used to
  // persist until confirmed or replaced by another selection — no way to back out, and
  // the button sits right where other taps land, inviting an accidental confirm (Paul,
  // 2026-10-04). Tapping anywhere outside the candidates grid/header, the confirm button,
  // or the "now" block now clears it — "now" is included deliberately (Paul, 2026-10-05):
  // comparing the current cluster against a candidate you're considering is a normal part
  // of evaluating a stream, not a context switch away from it, so it shouldn't cost you
  // the selection. Every other tap (header, footer playback, the flow list) still clears
  // it. Candidates re-rendering out from under an open selection (redraw/advance) already
  // clears selectedIndices on its own — this only covers the *other* paths.
  const candidatesBlockRef = ref<HTMLElement | null>(null)
  const confirmBlockRef = ref<HTMLElement | null>(null)
  const nowBlockRef = ref<HTMLElement | null>(null)

  function handleOutsideClick(event: MouseEvent) {
    if (selectedIndices.value.length === 0) return
    const target = event.target as Node
    if (candidatesBlockRef.value?.contains(target)) return
    if (confirmBlockRef.value?.contains(target)) return
    if (nowBlockRef.value?.contains(target)) return
    selectedIndices.value = []
  }

  onMounted(() => document.addEventListener('click', handleOutsideClick))
  onUnmounted(() => document.removeEventListener('click', handleOutsideClick))

  const loopActive = ref(false)

  const directionOptions = [
    { value: 'up', icon: arrowUpOutline },
    { value: 'down', icon: arrowDownOutline },
    { value: 'updown', icon: swapVerticalOutline },
    { value: 'random', icon: shuffleOutline },
    { value: 'chord', icon: handRightOutline },
  ]

  // A pad's slow swell reads as unclear/muddy when arpeggiated — held together as a
  // chord is the only direction that actually suits it (Paul, 2026-09-30). Add any other
  // pad-type instrument here too.
  const PAD_INSTRUMENTS: ReadonlySet<InstrumentType> = new Set(['holdsworthian-pad', 'retro-pad'])
  const isPadInstrument = computed(() => PAD_INSTRUMENTS.has(settingsStore.instrument))

  // Remembers whatever direction was active before a pad forced 'chord', and restores it
  // on the way back out — same "preserve intent, don't silently clobber it" precedent
  // already established for latch surviving a trip through chord mode.
  let directionBeforePad: ArpeggioDirection | null = null

  // immediate: true — without it, this only reacts to isPadInstrument *changing*, never
  // to it already being true when the session starts (e.g. a pad saved as the default
  // instrument). Without a transition into "pad" to react to, the saved arpeggioDirection
  // just sat there uncorrected until the user manually touched a direction button (Paul,
  // 2026-10-05). Safe to run on every mount — the non-pad startup case is a no-op
  // (directionBeforePad is still null, isPad is false, neither branch does anything).
  watch(isPadInstrument, (isPad) => {
    if (isPad) {
      if (settingsStore.arpeggioDirection !== 'chord') {
        directionBeforePad = settingsStore.arpeggioDirection
        settingsStore.setArpeggioDirection('chord')
      }
    } else if (directionBeforePad) {
      settingsStore.setArpeggioDirection(directionBeforePad)
      directionBeforePad = null
    }
  }, { immediate: true })

  watch(
    () => settingsStore.arpeggioDirection,
    () => {
      if (isPlaying.value) {
        audioEngine.stopLoop(true)
        playLoop()
      }
    }
  )

  // Diagnostic toggle (Paul, 2026-10-06) — temporarily routes tempo changes through a full
  // stop/restart instead of setTempoLive()'s live Transport.bpm ramp, to test a hypothesis
  // on the real-device playback-dropout bug: live tempo ramping (shipped the same build as
  // loop-range select, 1.0(9)) is the one thing that touches Transport state live mid-loop,
  // a path nothing else in the engine exercises. If dropouts still happen with this true,
  // that clears live tempo ramping as a cause. Flip back to false to restore the live ramp
  // once this build's test is done — see DOWNRIVER.md's playback-dropout entry.
  const DISABLE_LIVE_TEMPO_RAMP = true

  // Tempo is the one playback setting that can change live without a restart — see
  // setTempoLive() in useAudioEngine.ts. Unlike direction/subdivision/latch/time-signature
  // below, a bpm change doesn't alter what plays or in what order, just how fast.
  watch(
    () => settingsStore.tempo,
    (bpm) => {
      if (!isPlaying.value) return
      if (DISABLE_LIVE_TEMPO_RAMP) {
        audioEngine.stopLoop(true)
        playLoop()
      } else {
        audioEngine.setTempoLive(bpm)
      }
    }
  )

  watch(
    () => settingsStore.subdivision,
    () => {
      if (isPlaying.value) {
        audioEngine.stopLoop(true)
        playLoop()
      }
    }
  )

  watch(
    () => settingsStore.latchMode,
    () => {
      if (isPlaying.value) {
        audioEngine.stopLoop(true)
        playLoop()
      }
    }
  )

  // Structural, not live-rampable like ambience — changes bar/cluster duration itself,
  // so it needs the same clean-restart treatment as direction/tempo/subdivision/latch.
  watch(
    () => settingsStore.timeSignature,
    () => {
      if (isPlaying.value) {
        audioEngine.stopLoop(true)
        playLoop()
      }
    }
  )

  watch(
    () => settingsStore.instrument,
    async (newInstrument) => {
      const wasPlaying = isPlaying.value
      audioEngine.stopLoop()
      await audioEngine.init(newInstrument)
      // init() rebuilds this instrument's reverb/chorus nodes at their full ceiling wet
      // value — reapply the current ambience level so a mid-session instrument switch
      // doesn't silently reset the dial's effect.
      audioEngine.setAmbience(settingsStore.ambience)
      if (wasPlaying) playLoop()
    }
  )

  // Ambience is a live-rampable wet-mix control (see setAmbience() in useAudioEngine.ts)
  // — unlike direction/tempo/subdivision/latch above, it never needs a playLoop() restart,
  // it just ramps the existing effect nodes. Also applies while not playing, so a single
  // preview tap or chord audition reflects the current dial position too.
  watch(
    () => settingsStore.ambience,
    (level) => {
      audioEngine.setAmbience(level)
    }
  )

  const playbackSettings = computed(() => ({
    bpm: settingsStore.tempo,
    direction: settingsStore.arpeggioDirection,
    subdivision: settingsStore.subdivision,
    latch: settingsStore.latchMode,
    beatsPerBar: TIME_SIGNATURE_BEATS[settingsStore.timeSignature],
  }))

  const TIME_SIGNATURE_OPTIONS: TimeSignature[] = ['4/4', '3/4']

  const SUBDIVISION_STEPS: {
    value: Subdivision
    label: string
    glyph: 'half' | 'quarter' | 'eighth' | 'triplet' | 'sixteenth'
  }[] = [
    { value: 0.5, label: 'half', glyph: 'half' },
    { value: 1, label: 'quarter', glyph: 'quarter' },
    { value: 2, label: '8th', glyph: 'eighth' },
    { value: 3, label: 'triplet', glyph: 'triplet' },
    { value: 4, label: '16th', glyph: 'sixteenth' },
  ]

  const subdivisionIndex = computed(() =>
    Math.max(
      0,
      SUBDIVISION_STEPS.findIndex((s) => s.value === settingsStore.subdivision)
    )
  )

  const subdivisionLabel = computed(
    () => SUBDIVISION_STEPS[subdivisionIndex.value].label
  )

  function onSubdivisionChange(event: Event) {
    const index = (event as CustomEvent).detail.value as number
    settingsStore.setSubdivision(SUBDIVISION_STEPS[index].value)
  }

  // Hidden per Paul's request (2026-09-29) — didn't feel like it paid off relative to the
  // screen space it took in the footer tray. Everything underneath stays fully wired:
  // settingsStore.ambience, useAudioEngine's setAmbience() live ramp, and save/restore
  // with a session all keep working exactly as before (still applies its 0.5 default to
  // the sound) — there's just no control to change it mid-session. Flipping this back to
  // true is the only step needed to bring the slider back.
  const SHOW_AMBIENCE_CONTROL = false

  const ambiencePercent = computed(() => Math.round(settingsStore.ambience * 100))

  // @ionInput (fires continuously while dragging), not @ionChange (fires once on
  // release) — unlike the subdivision range's discrete snap points, ambience is a
  // continuous feel control and the watcher above ramps the actual effect live, so it
  // should track the thumb in real time rather than waiting for the drag to end.
  function onAmbienceInput(event: Event) {
    const percent = (event as CustomEvent).detail.value as number
    settingsStore.setAmbience(percent / 100)
  }

  onIonViewWillEnter(() => {
    // Purely local UI convenience state, not meaningful to preserve across a trip back
    // through Home — Ionic keeps this component instance alive rather than destroying
    // it, so it doesn't reset on its own the way a fresh mount would.
    footerExpanded.value = false

    if (!sequenceStore.currentCluster) {
      router.replace('/')
      return
    }
    advance()
  })

  onUnmounted(() => {
    audioEngine.stopLoop(true)
    clearTempoHold()
  })

  function advance() {
    selectedIndices.value = []
    activeStrategy.value = null
    multiSelect.value = false
    if (!sequenceStore.currentCluster) return

    let attempts = 0
    let newCandidates: Cluster[] = []

    while (attempts < 5 && newCandidates.length === 0) {
      const drawn = draw()
      if (!drawn) break
      newCandidates = generateCandidates(sequenceStore.currentCluster, drawn, {
        keyLockActive: settingsStore.keyLockActive,
        keyRoot: settingsStore.keyRoot,
        scaleId: settingsStore.scaleId,
      })
      attempts++
      if (newCandidates.length > 0) activeStrategy.value = drawn
    }

    candidates.value = newCandidates
  }

  function redraw() {
    advance()
  }

  // Returns 1-based position in selection order, or 0 if not selected
  function selectionOrder(index: number): number {
    const pos = selectedIndices.value.indexOf(index)
    return pos === -1 ? 0 : pos + 1
  }

  function toggleMultiSelect() {
    multiSelect.value = !multiSelect.value
    selectedIndices.value = []
  }

  function playCurrentCluster() {
    if (!sequenceStore.currentCluster) return
    audioEngine.playCluster(
      sequenceStore.currentCluster,
      playbackSettings.value
    )
  }

  function selectCandidate(cluster: Cluster, index: number) {
    audioEngine.playCluster(cluster, playbackSettings.value)

    if (multiSelect.value) {
      const pos = selectedIndices.value.indexOf(index)
      if (pos === -1) {
        selectedIndices.value.push(index)
      } else {
        selectedIndices.value.splice(pos, 1)
      }
    } else {
      selectedIndices.value = [index]
    }
  }

  function confirmSelection() {
    if (selectedIndices.value.length === 0) return

    audioEngine.stopLoop(true)
    for (let i = 0; i < selectedIndices.value.length; i++) {
      const chosen = candidates.value[selectedIndices.value[i]]
      // Only the first confirm in a multi-select batch takes an undo snapshot — the
      // whole batch is one user action ("add these N"), so it should be one undo step.
      sequenceStore.confirm(chosen, { skipHistory: i > 0 })

      const loopIdx = findLoopPoint(sequenceStore.sequence)
      if (loopIdx !== -1) {
        sequenceStore.setLoopResolved(true, loopIdx)
        return
      }

      if (
        settingsStore.loopMode === 'capped' &&
        sequenceStore.moveCount >= settingsStore.maxMoves
      ) {
        sequenceStore.setLoopResolved(true, -1)
        return
      }
    }

    advance()
  }

  function goUndo() {
    audioEngine.stopLoop(true)
    // Only redraw a strategy / regenerate streams if the current (last) cluster
    // actually changed — undoing an edit to an earlier row shouldn't disturb streams
    // generated against a last cluster that never moved.
    if (sequenceStore.undo()) advance()
  }

  function goRedo() {
    audioEngine.stopLoop(true)
    if (sequenceStore.redo()) advance()
  }

  const showResetConfirm = ref(false)

  function goHome() {
    if (sequenceStore.sequence.length > 0) {
      showResetConfirm.value = true
      return
    }
    confirmGoHome()
  }

  function confirmGoHome() {
    audioEngine.stopLoop(true)
    sequenceStore.reset()
    resetDeck()
    router.push('/')
  }

  const resetAlertButtons = [
    { text: 'cancel', role: 'cancel' },
    { text: 'start fresh', role: 'destructive', handler: confirmGoHome },
  ]

  function toggleLoop() {
    loopActive.value = !loopActive.value
    if (isPlaying.value) handlePlay()
  }

  function handlePlay() {
    if (loopActive.value) {
      playLoop()
    } else {
      playOnce()
    }
  }

  // Loop-range select (SequenceHistory's "the flow" toggle): once both a start and end
  // point are marked, playback plays just that slice instead of the whole flow — v1 is
  // play-this-range only, doesn't touch the separate infiniteOutline loopActive toggle
  // (whether a range or the full flow repeats forever vs. plays once).
  const loopRange = ref<[number, number] | null>(null)

  function setLoopRange(range: [number, number] | null) {
    loopRange.value = range
  }

  // Entering range-select mode stops whatever's currently playing (Paul, 2026-10-01) —
  // continuing to play the old full-flow sequence while picking new loop points read as
  // disconnected from what you were actually doing. Also implies "loop this": auto-enable
  // the playback-loop button so hitting play afterward repeats the range without a second
  // toggle. Deliberately one-directional: leaving range-select mode doesn't turn
  // playback-loop back off, since by then it's just "loop the whole flow from the top,"
  // which is still what you'd want.
  function onRangeModeChange(active: boolean) {
    // Turning range-select mode OFF mid-loop-playback needs the same stop as turning it
    // on: the engine is still scheduled against the old sliced range, loopRange just went
    // null, and nothing re-triggers a reschedule — left running, the playhead highlight
    // reverts to sweeping the full flow from the top while the audio keeps playing only
    // the old range (Paul, 2026-10-04).
    stopIfPlaying()
    if (active && !loopActive.value) loopActive.value = true
  }

  // Also used whenever a marker tap lands mid-playback (see SequenceHistory's 'range-tap')
  // — the engine has no live way to re-point an already-scheduled Part at a new range, so
  // rather than let stale audio keep playing the old selection, force an explicit replay.
  function stopIfPlaying() {
    if (isPlaying.value) audioEngine.stopLoop(true)
  }

  // Reverse (SequenceHistory's "the flow" toggle, next to loop-range): playback-order
  // only, never touches sequenceStore.sequence or its undo history. Applied after range
  // slicing below so it composes with loop-range rather than one overriding the other —
  // "reverse whatever's currently selected to play," same principle as range selection
  // itself. MIDI/WAV export's "this loop" scope reuses playbackSequence directly, so it
  // inherits reverse for free; "whole flow" export deliberately still reads
  // sequenceStore.sequence directly — that scope means the canonical stored order.
  const reversePlayback = ref(false)

  function onReverseChange(reversed: boolean) {
    reversePlayback.value = reversed
    // Same reasoning as onRangeModeChange/stopIfPlaying below: the engine is scheduled
    // against the old order, and nothing re-triggers a reschedule on its own.
    stopIfPlaying()
  }

  const playbackSequence = computed(() => {
    const base = loopRange.value
      ? sequenceStore.sequence.slice(loopRange.value[0], loopRange.value[1] + 1)
      : sequenceStore.sequence
    return reversePlayback.value ? [...base].reverse() : base
  })

  // playingIndex from the engine is relative to whatever was actually scheduled (the
  // sliced range and/or reversed order, when active) — map it back to the full flow's
  // indices so SequenceHistory highlights the right row instead of always starting at
  // row 1, or counting backwards when reversed.
  const displayPlayingIndex = computed(() => {
    if (!isPlaying.value || playingIndex.value < 0) return -1
    const rangeOffset = loopRange.value ? loopRange.value[0] : 0
    const indexInSlice = reversePlayback.value
      ? playbackSequence.value.length - 1 - playingIndex.value
      : playingIndex.value
    return indexInSlice + rangeOffset
  })

  function playLoop() {
    audioEngine.playSequence(
      playbackSequence.value,
      playbackSettings.value,
      true
    )
  }

  function playOnce() {
    audioEngine.playSequence(
      playbackSequence.value,
      playbackSettings.value,
      false
    )
  }

  function auditionHistoryCluster(cluster: Cluster) {
    audioEngine.playCluster(cluster, playbackSettings.value)
  }

  function deleteCluster(index: number) {
    audioEngine.stopLoop(true)
    sequenceStore.deleteAt(index)
    sequenceStore.setLoopResolved(false)
  }

  // duplicateAt/duplicateRange never change the sequence's last cluster's value (they only
  // insert, never modify or remove an existing entry) — so unlike edit/reorder above,
  // there's no advance() call here, same reasoning as deleteCluster's non-last-row case.
  function duplicateCluster(index: number) {
    audioEngine.stopLoop(true)
    sequenceStore.duplicateAt(index)
    sequenceStore.setLoopResolved(false)
  }

  function duplicateRangeClusters(start: number, end: number) {
    audioEngine.stopLoop(true)
    sequenceStore.duplicateRange(start, end)
    sequenceStore.setLoopResolved(false)
  }

  // Global range, not the current instrument's narrower picker range — matches
  // SequenceHistory.vue's edit-picker bounds, see its editRange comment for why: the
  // voice-leading engine already generates candidates across the full global range
  // regardless of instrument, so an edit shouldn't be validated more strictly than what
  // the engine could already have placed there.
  const editBounds = { min: MIDI_MIN, max: MIDI_MAX }

  function editCluster(index: number, newCluster: Cluster) {
    audioEngine.stopLoop(true)
    sequenceStore.editClusterAt(index, newCluster, editBounds)
    if (index === sequenceStore.sequence.length - 1) {
      sequenceStore.setLoopResolved(false)
      advance()
    }
  }

  function reorderClusters(from: number, to: number) {
    audioEngine.stopLoop(true)
    sequenceStore.reorderSequence(from, to)
    sequenceStore.setLoopResolved(false)
    advance()
  }

  const showSaveConfirm = ref(false)

  const savedSessionName = computed(() => {
    const id = sequenceStore.savedSessionId
    if (!id) return ''
    return listSessions().find((s) => s.id === id)?.name ?? 'this flow'
  })

  function flashSaved() {
    savedFlash.value = true
  }

  function save() {
    if (sequenceStore.savedSessionId) {
      showSaveConfirm.value = true
      return
    }
    saveAsNew()
  }

  function saveAsNew() {
    const saved = saveSession(
      sequenceStore.sequence,
      settingsStore.voiceCount,
      settingsStore.instrument,
      undefined,
      settingsStore.tempo,
      settingsStore.arpeggioDirection,
      settingsStore.subdivision,
      settingsStore.latchMode,
      settingsStore.ambience,
      settingsStore.timeSignature
    )
    sequenceStore.setSavedSessionId(saved.id)
    flashSaved()
  }

  function overwriteSaved() {
    if (!sequenceStore.savedSessionId) return
    overwriteSession(
      sequenceStore.savedSessionId,
      sequenceStore.sequence,
      settingsStore.voiceCount,
      settingsStore.instrument,
      settingsStore.tempo,
      settingsStore.arpeggioDirection,
      settingsStore.subdivision,
      settingsStore.latchMode,
      settingsStore.ambience,
      settingsStore.timeSignature
    )
    flashSaved()
  }

  const saveAlertButtons = [
    { text: 'cancel', role: 'cancel' },
    { text: 'save as new', handler: saveAsNew },
    { text: 'overwrite', role: 'destructive', handler: overwriteSaved },
  ]

  function adjustTempo(delta: number) {
    settingsStore.setTempo(settingsStore.tempo + delta)
  }

  // Tempo +/- buttons: a tap moves by exactly 1 bpm (every value 40-200 must be
  // reachable — a fixed step of 5 from a multiple-of-5 starting point can never land
  // on e.g. 92). Holding down accelerates the step size the longer it's held, so a
  // big jump (60 -> 160) doesn't require holding through 100 individual increments.
  let tempoHoldTimeout: ReturnType<typeof setTimeout> | null = null
  let tempoHoldInterval: ReturnType<typeof setInterval> | null = null
  let tempoHoldStart = 0

  function clearTempoHold() {
    if (tempoHoldTimeout !== null) { clearTimeout(tempoHoldTimeout); tempoHoldTimeout = null }
    if (tempoHoldInterval !== null) { clearInterval(tempoHoldInterval); tempoHoldInterval = null }
  }

  function tempoStepForElapsed(elapsedMs: number): number {
    if (elapsedMs > 2200) return 10
    if (elapsedMs > 900) return 5
    return 1
  }

  function startTempoHold(direction: 1 | -1) {
    clearTempoHold()
    // The initial tap fires immediately at the fine step, so a single press always
    // means "exactly 1 bpm" — acceleration only kicks in once the press becomes a hold.
    adjustTempo(direction)
    tempoHoldStart = Date.now()
    tempoHoldTimeout = setTimeout(() => {
      tempoHoldInterval = setInterval(() => {
        adjustTempo(direction * tempoStepForElapsed(Date.now() - tempoHoldStart))
      }, 100)
    }, 350)
  }

  function stopTempoHold() {
    clearTempoHold()
  }

  // MIDI/WAV/copy-text export all default to the full flow — but if a loop range is set,
  // "export" becomes genuinely ambiguous (capture what's currently sounding vs. everything
  // you've built), so ask rather than silently picking one (Paul, 2026-10-05). Skipped
  // entirely when no range is active, since there's nothing to disambiguate — the three
  // export functions below all take the sequence to export as a parameter rather than
  // reading sequenceStore.sequence directly, so this is the one place that decides it.
  const pendingExportRun = ref<((sequence: Cluster[]) => void | Promise<void>) | null>(null)
  const showExportScopeConfirm = ref(false)
  // Copy-text isn't really an "export" in the user's own vocabulary — it's a copy. The
  // alert's header verb follows whichever action actually triggered it.
  const exportScopeVerb = ref('export')

  function requestExport(run: (sequence: Cluster[]) => void | Promise<void>, verb = 'export') {
    if (!loopRange.value) {
      run(sequenceStore.sequence)
      return
    }
    pendingExportRun.value = run
    exportScopeVerb.value = verb
    showExportScopeConfirm.value = true
  }

  function runPendingExport(sequence: Cluster[]) {
    pendingExportRun.value?.(sequence)
    pendingExportRun.value = null
  }

  const exportScopeAlertButtons = [
    { text: 'this loop', handler: () => runPendingExport(playbackSequence.value) },
    { text: 'whole flow', handler: () => runPendingExport(sequenceStore.sequence) },
  ]

  async function exportMidi(sequence: Cluster[]) {
    await exportSequenceAsMidi(sequence, {
      bpm: settingsStore.tempo,
      direction: settingsStore.arpeggioDirection,
      subdivision: settingsStore.subdivision,
      beatsPerBar: TIME_SIGNATURE_BEATS[settingsStore.timeSignature],
      latch: settingsStore.latchMode,
    })
  }

  // Rendering happens via Tone.Offline() (faster than real time, but not instant —
  // several seconds for a long latched sequence) — the button disables and relabels
  // itself while it runs rather than looking like a dead tap.
  const exportingAudio = ref(false)

  async function exportAudio(sequence: Cluster[]) {
    if (exportingAudio.value) return
    // Tone.Offline() temporarily swaps the *global* Tone context for the duration of the
    // render — if live playback's per-frame tick loop read Tone.getContext() mid-render,
    // it would observe the offline context instead of the live one. Stopping first avoids
    // that race entirely rather than relying on timing.
    if (isPlaying.value) audioEngine.stopLoop(true)
    exportingAudio.value = true
    try {
      await exportSequenceAsWav(
        audioEngine.renderSequenceToBuffer,
        sequence,
        settingsStore.instrument,
        playbackSettings.value,
        settingsStore.ambience
      )
    } catch (err) {
      console.error('Audio export failed:', err)
    } finally {
      exportingAudio.value = false
    }
  }

  function copyText(sequence: Cluster[]) {
    const text = exportSequenceAsText(sequence)
    navigator.clipboard.writeText(text)
    copiedFlash.value = true
    setTimeout(() => {
      copiedFlash.value = false
    }, 1500)
  }

  function clusterKey(cluster: Cluster): string {
    return sortCluster(cluster).join(',')
  }
</script>

<style scoped>
  .session-layout {
    display: flex;
    flex-direction: column;
    gap: 1.6rem;
    max-width: 500px;
    margin: 0 auto;
    padding-bottom: 6rem; /* last flow row scrolls clear of the pinned confirm button + footer */
  }

  /* slot="fixed" content is positioned by us, absolute within ion-content, immune to
     its internal scroll — pins the button reachable the moment something's selected,
     with a full streams grid and a tall flow list below it would otherwise be well out
     of reach. Reproduces ion-content's own padding/max-width since fixed-slot content
     bypasses the padded scroll area those would normally come from. */
  .confirm-block {
    position: absolute;
    left: 0;
    right: 0;
    text-align: center;
    bottom: 0;
    z-index: 2;
    padding: 0.8rem 1rem;
    background: linear-gradient(to top, var(--color-bg) 65%, transparent);
  }
  .confirm-block .btn-primary {
    max-width: 500px;
    margin: 0 auto;
  }

  .session-title {
    font-family: var(--font-serif);
    font-size: var(--text-lg);
    font-weight: 300;
    letter-spacing: 0.12em;
    text-align: center;
    color: var(--color-text-dim);
  }

  /* .icon-btn (box model, touch target) comes from theme/buttons.css — back-to-home
     is icon+text rather than icon-only, so it keeps its own layout, just adding the
     same tap-target floor rather than composing the icon-only shared class */
  .back-to-home {
    background: none;
    border: none;
    color: var(--color-text-dim);
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    cursor: pointer;
    padding: 0 0.4rem;
    font-family: inherit;
    transition: color 0.15s;
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-weight: 500;
    min-height: var(--tap-min);
  }
  .back-to-home:hover {
    color: var(--color-text);
  }

  .current-cluster-block {
    display: block;
    width: 100%;
    padding: 0.5rem 0 0;
    background: none;
    border: none;
    text-align: left;
    font-family: inherit;
    cursor: pointer;
    border-radius: 8px;
    transition: opacity 0.15s;
  }
  .current-cluster-block:active {
    opacity: 0.5;
    transition-duration: 0.05s;
  }

  .current-row {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
  }

  /* dim, borderless play glyph — signals "tap to hear" without turning the cluster into
     a boxed button; sits on the notes' baseline at the row's right edge */
  .now-glyph {
    font-size: var(--icon-md);
    color: var(--color-text-muted);
    margin-right: 0.25rem;
  }

  .loop-banner {
    background: rgba(69, 74, 104, 0.3);
    border: 1px solid var(--color-accent);
    border-radius: 10px;
    padding: 0.8rem 1rem;
    font-family: var(--font-serif);
    font-size: var(--text-md);
    font-weight: 300;
    font-style: italic;
    color: var(--color-accent);
    text-align: center;
  }

  .candidates-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
  }

  .candidate-pill {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    background: var(--color-surface);
    border: 1px solid var(--color-border-subtle);
    border-radius: 10px;
    min-height: var(--tap-min);
    padding: 0.65rem 0.75rem;
    cursor: pointer;
    transition:
      border-color 0.15s,
      background 0.15s;
    text-align: left;
    width: 100%;
    font-family: inherit;
  }
  .candidate-pill:hover {
    border-color: var(--color-text-dim);
  }
  .candidate-pill.selected {
    border-color: var(--color-accent);
    background: rgba(69, 74, 104, 0.2);
  }

  .pill-order {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.1rem;
    height: 1.1rem;
    border-radius: 50%;
    background: var(--color-accent);
    color: #e6dec8;
    font-size: var(--text-label);
    font-weight: 600;
    flex-shrink: 0;
    font-family: inherit;
    margin-right: 0.5rem;
  }

  .pill-note {
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    letter-spacing: 0.02em;
  }
  .pill-note + .pill-note::before {
    content: '·';
    color: var(--color-text-dim);
    margin: 0 0 0.1rem;
  }

  .candidate-pill.single-candidate {
    grid-column: 1 / -1;
  }

  .no-candidates {
    font-size: var(--text-sm);
    color: var(--color-text-dim);
    font-style: italic;
  }
  .inline-btn {
    background: none;
    border: none;
    color: var(--color-accent);
    font-size: inherit;
    cursor: pointer;
    padding: 0.2rem 0;
    font-family: inherit;
    text-decoration: underline;
  }

  /* Footer */
  .playback-footer {
    border-top: 1px solid var(--color-border);
    background: var(--color-bg);
  }

  .footer-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem;
  }

  /* .btn-icon-outline (box model, touch target) comes from theme/buttons.css —
     play-stop/loop-toggle only add their accent-tinted state treatments */
  .play-stop:not(:disabled):hover,
  .play-stop.playing {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }
  .loop-toggle.active {
    border-color: var(--color-accent);
    color: var(--color-accent);
    background: rgba(69, 74, 104, 0.15);
  }

  /* .icon-btn (box model, touch target) comes from theme/buttons.css */
  .footer-expand-btn {
    margin-left: auto;
  }
  .footer-expand-btn.open {
    color: var(--color-text);
  }

  .footer-tray {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 0.22s ease;
    overflow: hidden;
    border-top: 1px solid transparent;
    transition:
      grid-template-rows 0.22s ease,
      border-color 0.22s ease;
  }
  .footer-tray.open {
    grid-template-rows: 1fr;
    border-color: var(--color-border);
  }

  .tray-inner {
    overflow: hidden;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  /* open-only: padding on the always-present inner box would keep a sliver of the tray
     (the direction buttons) visible when collapsed to 0fr */
  .footer-tray.open .tray-inner {
    padding-bottom: 1.25rem; /* keeps the grid glyphs off the home indicator */
  }

  .tray-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: nowrap;
    &.export-row {
      border-top: 1px solid var(--color-border);
      padding: 1rem;
      margin: 0;
    }
    &.playback-row {
      flex-wrap: wrap;
      row-gap: 1rem;
      justify-content: space-between;
      padding: 1rem 1rem 0.6rem;
    }
  }

  .grid-section {
    border-top: 1px solid var(--color-border);
    padding: 0.8rem 1rem 1rem;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .instrument-select {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    color: var(--color-text-dim);
    font-size: var(--text-xs);
    font-family: inherit;
    cursor: pointer;
    flex: 1;
    min-height: var(--tap-min);
    padding: 0 1rem;
    &::part(inner) {
      width: 100%;
      justify-content: space-between;
    }
  }

  .tempo-control {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    flex: 1;
  }

  /* .adj-btn's box model (border, touch target) comes from theme/buttons.css'
     .btn-icon-outline — nothing unique left to style here */

  .tempo-value {
    font-size: var(--text-sm);
    font-family: var(--font-mono);
    color: var(--color-text);
    min-width: 2.2rem;
    text-align: center;
  }

  .tempo-unit {
    font-size: var(--text-label);
    letter-spacing: 0.1em;
    color: var(--color-text-dim);
  }

  .subdivision-row,
  .ambience-row {
    justify-content: space-between;
  }

  .tray-label {
    font-size: var(--text-label);
    letter-spacing: 0.12em;
    color: var(--color-text-dim);
  }

  /* Own full-width line, same as .toggle-row/.tempo-control below it (see the
     .toggle-row comment) — a third stacked row in .playback-row, always above the other
     two regardless of viewport width */
  .playback-label {
    flex: 1 1 100%;
    margin-bottom: 0.1rem;
  }

  /* Pushed to the far right of the tempo row (not just a small gap) — reads as related
     to bpm but its own independent setting, same visual language as .latch-btn's
     placement relative to the direction buttons */
  .time-signature-toggle {
    display: flex;
    gap: 0.3rem;
    margin-left: auto;
  }

  /* .btn-outline (box model, touch target, .active fill) comes from theme/buttons.css —
     only the tighter padding is unique to fitting two side by side in a label row */
  .time-sig-btn {
    padding: 0.4rem 0.7rem;
  }

  .subdivision-current,
  .ambience-current {
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    color: var(--color-text);
  }

  .subdivision-range {
    --bar-background: var(--color-border);
    --bar-background-active: var(--color-accent);
    --bar-height: 2px;
    --knob-background: var(--color-accent);
    --knob-size: 22px;
    --tick-background: var(--color-border);
    --tick-background-active: var(--color-accent);
    padding: 0 1rem;
  }

  /* Continuous feel control, no snap/tick marks — unlike subdivision's 5 discrete steps,
     any value along the range is meaningful */
  .ambience-section {
    border-top: 1px solid var(--color-border);
    padding: 0.8rem 1rem 1rem;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .ambience-range {
    --bar-background: var(--color-border);
    --bar-background-active: var(--color-accent);
    --bar-height: 2px;
    --knob-background: var(--color-accent);
    --knob-size: 22px;
    padding: 0 1rem;
  }

  .subdivision-labels {
    display: flex;
    justify-content: space-between;
    padding: 0 0.4rem;
    margin-top: -0.3rem;
  }

  /* .icon-btn (box model, touch target) comes from theme/buttons.css — align-items
     is the one unique need: aligns glyphs of different heights to a common baseline */
  .subdivision-label-btn {
    align-items: flex-end;
  }

  /* flex-basis 100% forces this to always claim the whole row by itself, pushing
     .tempo-control (bpm + time signature) onto its own line unconditionally — not just
     when a narrow viewport's content happens to overflow. Without this, a wide enough
     window (desktop) had enough spare width for both groups to fit on one shared line,
     which read as one crowded row instead of the two intentional ones. */
  .toggle-row {
    display: flex;
    flex: 1 1 100%;
    gap: 0.3rem;
  }

  /* .toggle-btn's box model (border, touch target) comes from theme/buttons.css'
     .btn-icon-outline — only .active (below) is unique to this instance */
  .candidates-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.6rem;
  }

  .candidates-header .section-label {
    margin-bottom: 0;
  }

  .streams-actions {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  /* .icon-btn (box model, touch target) comes from theme/buttons.css */
  .refresh-streams-btn {
    font-size: var(--icon-sm);
  }
  .refresh-streams-btn:hover {
    color: var(--color-accent);
  }

  /* .btn-outline (box model, touch target) comes from theme/buttons.css */
  .multi-toggle {
    letter-spacing: 0.12em;
  }

  .export-btn {
    letter-spacing: 0.1em;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .export-btn:hover {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }

  .toggle-btn.active {
    border-color: var(--color-accent);
    color: var(--color-text);
    background: var(--color-accent);
  }

  /* Pushed to the far right of the row (not just a small gap) — reads as related to
     the arpeggiator row but its own independent toggle, not a 6th direction option */
  .latch-btn {
    margin-left: auto;
  }
</style>
