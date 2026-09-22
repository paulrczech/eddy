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

    <IonToast
      :is-open="savedFlash"
      message="saved"
      :duration="1500"
      position="bottom"
      @did-dismiss="savedFlash = false" />

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
          class="current-cluster-block"
          @click="playCurrentCluster">
          <p class="section-label">now</p>
          <ClusterDisplay :cluster="sequenceStore.currentCluster" />
        </button>

        <!-- Candidates -->
        <div
          v-if="!sequenceStore.loopResolved && candidates.length > 0"
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
              :class="{ selected: selectionOrder(i) > 0 }"
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
            :playing-index="isPlaying ? playingIndex : -1"
            @audition="auditionHistoryCluster"
            @preview="auditionHistoryCluster"
            @delete="deleteCluster"
            @edit="editCluster"
            @reorder="reorderClusters" />
        </div>
      </div>

      <!-- Confirm button — slot="fixed" pins it above the footer regardless of scroll
           position; a plain sticky div doesn't work here because ion-content scrolls
           via an internal shadow-DOM element that CSS position:sticky can't reach. -->
      <div
        v-if="selectedIndices.length > 0 && !sequenceStore.loopResolved"
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
          <ion-select-option value="piano">piano</ion-select-option>
          <ion-select-option value="electric-piano">e-piano</ion-select-option>
          <ion-select-option value="guitar-acoustic">guitar</ion-select-option>
          <ion-select-option value="electric-guitar"
            >e-guitar</ion-select-option
          >
          <ion-select-option value="holdsworthian-pad">pad</ion-select-option>
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
            <div class="toggle-row">
              <button
                v-for="d in directionOptions"
                :key="d.value"
                class="btn-icon-outline toggle-btn"
                :class="{ active: settingsStore.arpeggioDirection === d.value }"
                @click="settingsStore.setArpeggioDirection(d.value as any)">
                <ion-icon :icon="d.icon" />
              </button>
            </div>
            <div class="tempo-control">
              <button class="btn-icon-outline adj-btn" @click="adjustTempo(-5)">
                <ion-icon :icon="removeOutline" />
              </button>
              <span class="tempo-value">{{ settingsStore.tempo }}</span>
              <button class="btn-icon-outline adj-btn" @click="adjustTempo(5)">
                <ion-icon :icon="addOutline" />
              </button>
              <span class="tempo-unit">bpm</span>
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
          <div
            v-if="sequenceStore.sequence.length > 1"
            class="tray-row export-row">
            <button class="btn-outline export-btn" @click="exportMidi">
              <ion-icon :icon="downloadOutline" /> midi
            </button>
            <button class="btn-outline export-btn" @click="copyText">
              {{ copiedFlash ? 'copied!' : 'copy text' }}
            </button>
          </div>
        </div>
      </div>
    </ion-footer>
  </ion-page>
</template>

<script setup lang="ts">
  import { ref, computed, watch, onUnmounted } from 'vue'
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
  } from 'ionicons/icons'

  import ClusterDisplay from '../components/cluster/ClusterDisplay.vue'
  import StrategyCard from '../components/strategy/StrategyCard.vue'
  import SequenceHistory from '../components/sequence/SequenceHistory.vue'
  import NoteGlyph from '../components/ui/NoteGlyph.vue'

  import { useSequenceStore } from '../stores/sequenceStore'
  import { useSettingsStore, type Subdivision } from '../stores/settingsStore'
  import {
    useAudioEngine,
    INSTRUMENT_NOTE_RANGE,
  } from '../composables/useAudioEngine'
  import { useStrategyDeck } from '../composables/useStrategyDeck'
  import { useLoopDetection } from '../composables/useLoopDetection'
  import { generateCandidates } from '../composables/useVoiceLeading'

  import { midiToName } from '../data/notes'
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
  const { isPlaying, playingIndex } = audioEngine

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

  const loopActive = ref(false)

  const directionOptions = [
    { value: 'up', icon: arrowUpOutline },
    { value: 'down', icon: arrowDownOutline },
    { value: 'updown', icon: swapVerticalOutline },
    { value: 'random', icon: shuffleOutline },
    { value: 'chord', icon: handRightOutline },
  ]

  watch(
    () => settingsStore.arpeggioDirection,
    () => {
      if (isPlaying.value) {
        audioEngine.stopLoop(true)
        playLoop()
      }
    }
  )

  watch(
    () => settingsStore.tempo,
    () => {
      if (isPlaying.value) {
        audioEngine.stopLoop(true)
        playLoop()
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
    () => settingsStore.instrument,
    async (newInstrument) => {
      const wasPlaying = isPlaying.value
      audioEngine.stopLoop()
      await audioEngine.init(newInstrument)
      if (wasPlaying) playLoop()
    }
  )

  const playbackSettings = computed(() => ({
    bpm: settingsStore.tempo,
    direction: settingsStore.arpeggioDirection,
    subdivision: settingsStore.subdivision,
  }))

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

  onIonViewWillEnter(() => {
    if (!sequenceStore.currentCluster) {
      router.replace('/')
      return
    }
    advance()
  })

  onUnmounted(() => {
    audioEngine.stopLoop(true)
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

  function playLoop() {
    audioEngine.playSequence(
      sequenceStore.sequence,
      playbackSettings.value,
      true
    )
  }

  function playOnce() {
    audioEngine.playSequence(
      sequenceStore.sequence,
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

  const instrumentRange = computed(
    () => INSTRUMENT_NOTE_RANGE[settingsStore.instrument]
  )

  function editCluster(index: number, newCluster: Cluster) {
    sequenceStore.editClusterAt(index, newCluster, instrumentRange.value)
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
      settingsStore.instrument
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
      settingsStore.instrument
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

  function exportMidi() {
    exportSequenceAsMidi(sequenceStore.sequence, {
      bpm: settingsStore.tempo,
      direction: settingsStore.arpeggioDirection,
      subdivision: settingsStore.subdivision,
    })
  }

  function copyText() {
    const text = exportSequenceAsText(sequenceStore.sequence)
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
    padding-bottom: 2rem;
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
  .current-cluster-block:hover,
  .current-cluster-block:active {
    opacity: 0.75;
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
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .candidate-pill {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border-subtle);
    border-radius: 10px;
    min-height: var(--tap-min);
    padding: 0.65rem 1rem;
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
  }

  .pill-note {
    font-size: var(--text-base);
    font-family: var(--font-mono);
    letter-spacing: 0.04em;
  }
  .pill-note + .pill-note::before {
    content: '·';
    color: var(--color-text-dim);
    margin-right: 0.4rem;
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

  .subdivision-row {
    justify-content: space-between;
  }

  .tray-label {
    font-size: var(--text-label);
    letter-spacing: 0.12em;
    color: var(--color-text-dim);
  }

  .subdivision-current {
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

  .toggle-row {
    display: flex;
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
</style>
