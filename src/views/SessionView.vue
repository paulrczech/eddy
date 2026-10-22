<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <button class="back-to-home" @click="goHome">
            <ion-icon :icon="arrowBack" /> new
          </button>
        </ion-buttons>
        <ion-title class="session-title">
          <input
            v-if="isEditingTitle"
            ref="titleInputRef"
            v-model="editTitleName"
            class="session-title-input"
            @keydown.enter="commitTitleRename"
            @keydown.escape="cancelTitleRename"
            @blur="commitTitleRename" />
          <span
            v-else
            class="session-title-text"
            :class="{ editable: !!sequenceStore.savedSessionId }"
            @click="startEditTitle">
            {{ headerTitle }}
          </span>
        </ion-title>
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

    <!-- The loop banner sits at the top, easy to miss while looking at the streams or the
         flow — a toast says it once, when it happens. -->
    <IonToast
      :is-open="loopFlash"
      message="a loop has formed"
      :duration="2500"
      position="bottom"
      @did-dismiss="loopFlash = false" />

    <IonToast
      :is-open="duplicateFlash"
      :message="duplicateFlashMessage"
      :duration="1500"
      position="bottom"
      @did-dismiss="duplicateFlash = false" />

    <!-- Shown every time a pool is created, not just the first — pool creation is
         inherently an occasional, deliberate action (same reasoning duplicateFlash above
         already rests on), and swipe-to-ungroup has no other visible affordance anywhere
         on the pool header itself (Paul, 2026-10-09). Longer duration than the other
         toasts here since there's real instructional text to read, not just a one-word
         confirmation. -->
    <IonToast
      :is-open="poolCreatedFlash"
      :message="poolCreatedMessage"
      :duration="3000"
      position="bottom"
      @did-dismiss="poolCreatedFlash = false" />

    <IonToast
      :is-open="recoveryToastOpen"
      :message="recoveryToastMessage"
      :duration="recoveryStatus === 'failed' ? 3000 : undefined"
      position="bottom"
      @did-dismiss="onRecoveryToastDismiss" />

    <ChannelPicker :is-open="channelOpen" :relock="channelRelock" :fit-notes="sequenceStore.currentCluster ?? undefined" @close="channelOpen = false; channelRelock = false" @confirm="advance" />

    <ion-content class="ion-padding" fullscreen>
      <div class="session-layout">
        <!-- Loop resolved banner -->
        <div v-if="sequenceStore.loopResolved" class="loop-banner">
          a loop has formed — {{ sequenceStore.moveCount }} moves
          <!-- A loop closes the flow on purpose, but it shouldn't be a dead end: loopPoint -1
               is the capped-moves ending, which would just re-close on the next move. -->
          <p v-if="sequenceStore.loopPoint !== -1" class="loop-banner-actions">
            <button class="inline-btn" @click="keepGoing">keep going</button>
            <template v-if="settingsStore.keyLocked">
              or
              <button class="inline-btn" @click="openChannelAndKeepGoing">open the channel</button>
            </template>
          </p>
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
                class="icon-btn refresh-streams-btn lock-streams-btn"
                :class="{ 'is-locked': settingsStore.keyLocked }"
                :aria-label="settingsStore.keyLocked ? 'open the channel' : 'lock to the channel'"
                :title="settingsStore.keyLocked ? 'open the channel (unlock)' : 'lock to a scale'"
                @click="toggleChannelLock">
                <IonIcon :icon="settingsStore.keyLocked ? lockClosedOutline : lockOpenOutline" />
              </button>
              <button
                class="icon-btn refresh-streams-btn"
                aria-label="another"
                title="another set of streams"
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
          <button v-if="settingsStore.keyLocked" class="channel-chip" @click="channelRelock = false; channelOpen = true">
            {{ channelLabel }}
          </button>
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
            <template v-if="settingsStore.keyLocked">
              or
              <button class="inline-btn" @click="toggleChannelLock">open the channel</button>
            </template>
          </p>
        </div>

        <!-- Sequence history — fills remaining space -->
        <div v-if="sequenceStore.sequence.length > 0" class="flow-section">
          <SequenceHistory
            :sequence="sequenceStore.sequence"
            :pools="sequenceStore.pools"
            :pattern-label="velocityPatternLabel"
            :loop-point="sequenceStore.loopPoint"
            :playing-index="displayPlayingIndex"
            :just-duplicated-index="justDuplicatedIndex ?? undefined"
            :current-pool-repeat="currentPoolRepeat"
            :pool-playback-context-id="poolPlaybackContextId"
            @audition="onHistoryAudition"
            @preview="auditionHistoryCluster"
            @delete="deleteCluster"
            @edit="editCluster"
            @reorder="reorderClusters"
            @range-change="setLoopRange"
            @range-mode-change="onRangeModeChange"
            @range-tap="stopIfPlaying"
            @play-order-change="onPlayOrderChange"
            @duplicate="duplicateCluster"
            @duplicate-range="duplicateRangeClusters"
            @duplicate-mode-change="onDuplicateModeChange"
            @create-pool="createPool"
            @delete-pool="deletePoolRows"
            @ungroup-pool="ungroupPool"
            @duplicate-pool="duplicatePool"
            @toggle-pool-expanded="togglePoolExpanded"
            @rename-pool="renamePool"
            @reorder-pool-block="reorderPoolBlock"
            @open-pool-playback="openPoolPlayback" />
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
          :title="isPlaying ? 'stop' : 'play'"
          :disabled="sequenceStore.sequence.length < 1 || duplicateModeActive"
          @click="isPlaying ? audioEngine.stopLoop(true) : handlePlay()">
          <ion-icon :icon="isPlaying ? stopOutline : playOutline" />
        </button>
        <button
          class="btn-icon-outline loop-toggle"
          :class="{ active: loopActive }"
          :title="loopActive ? 'loop on — tap to play once' : 'play once — tap to loop'"
          @click="toggleLoop">
          <ion-icon :icon="infiniteOutline" />
        </button>
        <ion-select
          interface="action-sheet"
          :value="settingsStore.instrument"
          class="instrument-select"
          :disabled="!!poolPlaybackContext"
          @ionChange="
            settingsStore.setInstrument(($event as CustomEvent).detail.value)
          ">
          <ion-select-option value="piano-salamander">piano</ion-select-option>
          <ion-select-option value="piano">felt piano</ion-select-option>
          <ion-select-option value="guitar-acoustic">guitar</ion-select-option>
          <ion-select-option value="electric-guitar"
            >e-guitar</ion-select-option
          >
          <ion-select-option value="synth-strings"
            >synth strings</ion-select-option
          >
          <ion-select-option v-if="SHOW_ANALOG_SYNTH_TEMP" value="analog-synth-temp"
            >analog synth</ion-select-option
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

      <div ref="footerTrayRef" class="footer-tray" :class="{ open: footerExpanded }">
        <div class="tray-inner">
          <div class="tray-row playback-row">
            <span class="tray-label playback-label">{{
              poolPlaybackContext ? `playback - ${poolPlaybackContext.name}` : 'playback'
            }}</span>
            <div class="toggle-row">
              <button
                v-for="d in directionOptions"
                :key="d.value"
                class="btn-icon-outline toggle-btn"
                :class="{ active: drawerDirection === d.value }"
                :disabled="isPadInstrument && d.value !== 'chord'"
                :title="isPadInstrument && d.value !== 'chord' ? 'a pad only really works as a chord — held, not arpeggiated' : DIRECTION_TITLES[d.value]"
                @click="drawerDirection = d.value as any">
                <ion-icon :icon="d.icon" />
              </button>
              <button
                class="btn-icon-outline toggle-btn latch-btn"
                :class="{ active: drawerLatch }"
                :disabled="drawerDirection === 'chord'"
                title="latch — repeat to fill the bar"
                @click="drawerLatch = !drawerLatch">
                <ion-icon :icon="drawerLatch ? lockClosedOutline : lockOpenOutline" />
              </button>
            </div>
            <div v-if="poolPlaybackContext" class="pool-adjust-row">
              <div class="adjust-group">
                <span class="tray-label">repeat</span>
                <div class="adjust-buttons">
                  <button
                    v-for="n in [1, 2, 3, 4]"
                    :key="n"
                    class="btn-icon-outline toggle-btn repeat-btn"
                    :class="{ active: drawerRepeatCount === n }"
                    @click="drawerRepeatCount = n">
                    {{ n }}
                  </button>
                </div>
              </div>
              <div class="adjust-group">
                <span class="tray-label">shift</span>
                <div class="adjust-buttons">
                  <button
                    class="btn-icon-outline toggle-btn shift-btn"
                    :disabled="!canShiftPoolDown"
                    title="shift pool down an octave"
                    @click="shiftPoolOctave(-1)">
                    −12
                  </button>
                  <button
                    class="btn-icon-outline toggle-btn shift-btn"
                    :disabled="!canShiftPoolUp"
                    title="shift pool up an octave"
                    @click="shiftPoolOctave(1)">
                    +12
                  </button>
                </div>
              </div>
            </div>
            <div class="tempo-control">
              <button
                class="btn-icon-outline adj-btn"
                :disabled="!!poolPlaybackContext"
                @pointerdown="startTempoHold(-1)"
                @pointerup="stopTempoHold"
                @pointerleave="stopTempoHold"
                @pointercancel="stopTempoHold">
                <ion-icon :icon="removeOutline" />
              </button>
              <span class="tempo-value">{{ settingsStore.tempo }}</span>
              <button
                class="btn-icon-outline adj-btn"
                :disabled="!!poolPlaybackContext"
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
                  :disabled="!!poolPlaybackContext"
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
              :disabled="!!poolPlaybackContext"
              :value="subdivisionIndex"
              @ionChange="onSubdivisionChange">
            </ion-range>
            <div class="subdivision-labels">
              <button
                v-for="(step, i) in SUBDIVISION_STEPS"
                :key="step.label"
                class="icon-btn subdivision-label-btn"
                :disabled="!!poolPlaybackContext"
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
            <!-- Export reads the global flow/loop-range scope — pool repeats and each pool's
                 direction/latch included, exactly as playback plays them (2026-10-22) — never
                 a pool's own range on its own. Still disabled while the drawer reads
                 "playback - pool 'x'" so the label never implies a pool-only export. -->
            <button class="btn-outline export-btn" :disabled="!!poolPlaybackContext" @click="requestExport(exportMidi)">
              <ion-icon :icon="downloadOutline" /> midi
            </button>
            <button
              class="btn-outline export-btn"
              :disabled="exportingAudio || !!poolPlaybackContext"
              @click="requestExport(exportAudio)">
              <ion-icon :icon="downloadOutline" /> {{ exportingAudio ? 'rendering…' : 'wav' }}
            </button>
            <button class="btn-outline export-btn" :disabled="!!poolPlaybackContext" @click="requestExport(copyText, 'copy')">
              {{ copiedFlash ? 'copied!' : 'copy text' }}
            </button>
          </div>
        </div>
      </div>
    </ion-footer>
  </ion-page>
</template>

<script setup lang="ts">
  import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
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
  import ChannelPicker from '../components/ui/ChannelPicker.vue'

  import { useSequenceStore, type Pool } from '../stores/sequenceStore'
  import { useSettingsStore, SHOW_ANALOG_SYNTH_TEMP, SHOW_VELOCITY_PATTERN_LABEL, type Subdivision, type TimeSignature, type PlayOrder, TIME_SIGNATURE_BEATS, type InstrumentType, type ArpeggioDirection } from '../stores/settingsStore'
  import { useAudioEngine } from '../composables/useAudioEngine'
  import { useStrategyDeck } from '../composables/useStrategyDeck'
  import { useLoopDetection } from '../composables/useLoopDetection'
  import { generateCandidates } from '../composables/useVoiceLeading'

  import { midiToName, MIDI_MIN, MIDI_MAX, NOTE_NAMES } from '../data/notes'
  import { SCALE_MAP } from '../data/scales'
  import { pickVelocityPattern } from '../utils/arpeggioEngine'
  import { MOOD_MAP } from '../data/moods'
  import type { Strategy } from '../data/strategies'
  import type { Cluster } from '../utils/noteUtils'
  import { sortCluster } from '../utils/noteUtils'
  import {
    saveSession,
    overwriteSession,
    listSessions,
    renameSession,
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
  const loopFlash = ref(false)
  const duplicateFlash = ref(false)
  const duplicateFlashMessage = ref('')
  const poolCreatedFlash = ref(false)
  const poolCreatedMessage = ref('')
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
  // The footer tray itself — used below so tapping its own controls (direction, latch,
  // repeat count) never counts as "tapping away" from pool-context mode. The pool
  // header's own playback-settings icon never reaches this handler at all regardless
  // (it's bound with .stop), so switching straight from one pool's context to another's
  // is handled entirely by openPoolPlayback() itself, not by this outside-click reset.
  const footerTrayRef = ref<HTMLElement | null>(null)

  function handleOutsideClick(event: MouseEvent) {
    const target = event.target as Node
    if (selectedIndices.value.length > 0) {
      const insideCandidateUi =
        candidatesBlockRef.value?.contains(target) ||
        confirmBlockRef.value?.contains(target) ||
        nowBlockRef.value?.contains(target)
      if (!insideCandidateUi) selectedIndices.value = []
    }
    // "Tap outside the pool header [or the drawer itself] resets to global playback"
    // (Paul, 2026-10-10) — rather than requiring the same icon be tapped again to back
    // out of pool-context mode.
    if (poolPlaybackContextId.value && !footerTrayRef.value?.contains(target)) {
      poolPlaybackContextId.value = null
    }
  }

  onMounted(() => document.addEventListener('click', handleOutsideClick))
  onUnmounted(() => document.removeEventListener('click', handleOutsideClick))

  const loopActive = ref(false)

  // Which pool (if any) the footer tray's direction/latch/repeat controls currently
  // target — null means the normal, global-settings drawer. Entered via a pool header's
  // own playback-settings icon (SequenceHistory.vue's openPoolPlayback emit below),
  // exited by tapping that same icon again. Auto-clears if the targeted pool stops
  // existing (deleted/ungrouped) while open, so the drawer can never silently keep
  // editing a pool that's no longer there.
  const poolPlaybackContextId = ref<string | null>(null)
  const poolPlaybackContext = computed(() =>
    poolPlaybackContextId.value
      ? sequenceStore.pools.find((p) => p.id === poolPlaybackContextId.value) ?? null
      : null
  )
  watch(poolPlaybackContext, (pool) => {
    if (!pool && poolPlaybackContextId.value) poolPlaybackContextId.value = null
  })

  function openPoolPlayback(id: string) {
    poolPlaybackContextId.value = poolPlaybackContextId.value === id ? null : id
    if (poolPlaybackContextId.value) footerExpanded.value = true
  }

  // Effective direction/latch/repeat-count for the drawer: the targeted pool's own
  // override when set (falling back to the global value for display only, same as any
  // ungrouped row would use), or the plain global setting when not in pool context.
  // Setting either while in pool context writes a per-pool override and restarts
  // playback itself if something's currently playing — the existing arpeggioDirection/
  // latchMode watchers below only ever fire for the *global* setter, so the pool branch
  // can't rely on them and has to trigger its own restart explicitly.
  const drawerDirection = computed<ArpeggioDirection>({
    get: () => poolPlaybackContext.value?.playback?.direction ?? settingsStore.arpeggioDirection,
    set: (d) => {
      const pool = poolPlaybackContext.value
      if (pool) {
        sequenceStore.setPoolPlayback(pool.id, { direction: d })
        if (isPlaying.value) {
          audioEngine.stopLoop(true)
          playLoop()
        }
      } else {
        settingsStore.setArpeggioDirection(d)
      }
    },
  })

  const drawerLatch = computed<boolean>({
    get: () => poolPlaybackContext.value?.playback?.latchMode ?? settingsStore.latchMode,
    set: (v) => {
      const pool = poolPlaybackContext.value
      if (pool) {
        sequenceStore.setPoolPlayback(pool.id, { latchMode: v })
        if (isPlaying.value) {
          audioEngine.stopLoop(true)
          playLoop()
        }
      } else {
        settingsStore.setLatchMode(v)
      }
    },
  })

  // Only meaningful in pool context — there's no "global repeat count" concept, so
  // reading this outside pool context (shouldn't happen, the control is v-if'd away)
  // would just fall back to 1.
  const drawerRepeatCount = computed<number>({
    get: () => poolPlaybackContext.value?.playback?.repeatCount ?? 1,
    set: (n) => {
      const pool = poolPlaybackContext.value
      if (!pool) return
      sequenceStore.setPoolPlayback(pool.id, { repeatCount: n })
      if (isPlaying.value) {
        audioEngine.stopLoop(true)
        playLoop()
      }
    },
  })

  // Pool octave shift — an immediate edit to the pool's actual notes (not a persisted
  // playback setting like direction/latch/repeatCount above), so there's no writable
  // computed here, just a disabled check + a one-shot action. Same all-or-nothing/restart-
  // if-playing treatment as the settings above.
  const canShiftPoolDown = computed(() =>
    !!poolPlaybackContext.value && sequenceStore.canTransposePoolOctave(poolPlaybackContext.value.id, -1)
  )
  const canShiftPoolUp = computed(() =>
    !!poolPlaybackContext.value && sequenceStore.canTransposePoolOctave(poolPlaybackContext.value.id, 1)
  )
  function shiftPoolOctave(direction: 1 | -1) {
    const pool = poolPlaybackContext.value
    if (!pool) return
    sequenceStore.transposePoolOctave(pool.id, direction)
    if (isPlaying.value) {
      audioEngine.stopLoop(true)
      playLoop()
    }
  }

  // Hover titles for the arpeggio-direction buttons (note order *within* each chord — not to
  // be confused with the flow's play-order button, which reuses the same arrows for row order).
  const DIRECTION_TITLES: Record<string, string> = {
    up: 'arpeggio up',
    down: 'arpeggio down',
    updown: 'arpeggio up and down',
    random: 'arpeggio random',
    chord: 'play as a chord',
  }

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
  const PAD_INSTRUMENTS: ReadonlySet<InstrumentType> = new Set(['synth-strings'])
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
    velocitySeed: sequenceStore.velocitySeed,
  }))

  // Which accent pattern is playing, shown beside "the flow" (SHOW_VELOCITY_PATTERN_LABEL):
  // the letters first so they survive truncation, then the pattern's name. Recomputed as
  // direction/grid/meter/instrument change, since the eligible patterns do.
  const velocityPatternLabel = computed(() => {
    if (!SHOW_VELOCITY_PATTERN_LABEL) return ''
    const voices = sequenceStore.currentCluster?.length ?? settingsStore.voiceCount
    const direction = settingsStore.arpeggioDirection
    const passLength = direction === 'updown' ? Math.max(1, voices * 2 - 2) : voices
    const pattern = pickVelocityPattern(
      {
        instrument: settingsStore.instrument,
        direction,
        beatsPerBar: TIME_SIGNATURE_BEATS[settingsStore.timeSignature],
        subdivision: settingsStore.subdivision,
        seed: sequenceStore.velocitySeed,
      },
      passLength
    )
    return pattern ? `${pattern.cell} · ${pattern.name}` : 'flat'
  })

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
    if (justDuplicatedTimeout) clearTimeout(justDuplicatedTimeout)
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
        movement: settingsStore.movementSize,
      })
      attempts++
      if (newCandidates.length > 0) activeStrategy.value = drawn
    }

    candidates.value = newCandidates
  }

  function redraw() {
    advance()
  }

  const channelOpen = ref(false)
  const channelLabel = computed(
    () =>
      (settingsStore.moodId && MOOD_MAP[settingsStore.moodId]?.label) ||
      `${NOTE_NAMES[settingsStore.keyRoot % 12]} ${(SCALE_MAP[settingsStore.scaleId]?.name ?? '').toLowerCase()}`
  )

  // Lock icon in the streams header: locked -> open instantly (the scale stays remembered);
  // open -> the channel drawer, preselected to the last key/scale, so locking is always a
  // visible choice and "done" straight away re-locks to the same one. Streams regenerate
  // after either (via @confirm on the drawer, or directly here), since the current ones were
  // drawn under the old rule.
  const channelRelock = ref(false)
  function toggleChannelLock() {
    if (settingsStore.keyLocked) {
      settingsStore.setKeyLocked(false)
      advance()
    } else {
      channelRelock.value = true
      channelOpen.value = true
    }
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
    audioEngine.playCluster(sequenceStore.currentCluster, {
      ...playbackSettings.value,
      previousCluster: sequenceStore.sequence[sequenceStore.sequence.length - 2],
    })
  }

  function selectCandidate(cluster: Cluster, index: number) {
    // A stream is a move from the current chord — audition it with that context so its
    // moving-voice accent sounds the way it will in the flow.
    audioEngine.playCluster(cluster, {
      ...playbackSettings.value,
      previousCluster: sequenceStore.currentCluster ?? undefined,
    })

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
        loopFlash.value = true
        return
      }

      if (
        settingsStore.loopMode === 'capped' &&
        sequenceStore.moveCount >= settingsStore.maxMoves
      ) {
        sequenceStore.setLoopResolved(true, -1)
        loopFlash.value = true
        return
      }
    }

    advance()
  }

  // A loop closes the flow, but the banner offers a way on: clear it and draw fresh streams
  // from the repeated cluster (loop detection only compares the newest move, so continuing
  // doesn't re-trigger it). Opening the channel too is for when the lock is what keeps
  // circling back.
  function keepGoing() {
    sequenceStore.setLoopResolved(false)
    advance()
  }
  function openChannelAndKeepGoing() {
    settingsStore.setKeyLocked(false)
    keepGoing()
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

  // Play order (SequenceHistory's "the flow" order button, next to loop-range): playback-
  // order only, never touches sequenceStore.sequence or its undo history. Applied after
  // range slicing below so it composes with loop-range rather than one overriding the
  // other — "reorder whatever's currently selected to play," same principle as range
  // selection itself. 'bounce' is forward then back without repeating the end rows
  // (1-2-3-4-3-2, looping), so a loop never doubles a voicing; the one-shot version adds
  // the final return to row 1. MIDI/WAV export follows the order too, in both scopes (see
  // exportScopeFor()); only copy-text's "whole flow" keeps the plain stored rows.
  const playOrder = ref<PlayOrder>('forward')

  function onPlayOrderChange(order: PlayOrder) {
    playOrder.value = order
    // Same reasoning as onRangeModeChange/stopIfPlaying below: the engine is scheduled
    // against the old order, and nothing re-triggers a reschedule on its own.
    stopIfPlaying()
  }

  // Duplicate-mode (SequenceHistory's global toggle, replacing the old per-row icon):
  // deliberately silent and playback-free for now (Paul, 2026-10-08) — stops anything
  // currently playing the same way entering range-select already does, and the play
  // button itself is disabled below for the duration so there's no way to start new
  // playback while a row-tap means "duplicate" instead of "preview."
  const duplicateModeActive = ref(false)

  function onDuplicateModeChange(active: boolean) {
    duplicateModeActive.value = active
    stopIfPlaying()
  }

  // Export-facing scope only ("this loop" in the export menu, plus whatever MIDI/WAV
  // export reads) — loop-range (explicit, persistent user intent) plus reverse, nothing
  // else.
  const playbackSequence = computed(() => {
    const base = loopRange.value
      ? sequenceStore.sequence.slice(loopRange.value[0], loopRange.value[1] + 1)
      : sequenceStore.sequence
    if (playOrder.value === 'reverse') return [...base].reverse()
    if (playOrder.value === 'bounce') return [...base, ...base.slice(1, -1).reverse()]
    return base
  })

  // Pool-aware playback: resolves pool direction/latch overrides and repeat counts into
  // a flat, already-expanded timeline that the engine schedules directly — the engine
  // itself never needs to know pools exist (see PlaybackSettings.directionOverrides/
  // latchOverrides in useAudioEngine.ts). realIndex/repeatInfo let displayPlayingIndex
  // and the pool header's live repeat counter map an engine position back to "which real
  // row, which repeat" (Paul, 2026-10-10).
  interface PlaybackPlan {
    clusters: Cluster[]
    directionOverrides: (ArpeggioDirection | undefined)[]
    latchOverrides: (boolean | undefined)[]
    realIndex: number[]
    repeatInfo: ([current: number, total: number] | null)[]
  }

  function poolContaining(i: number): Pool | undefined {
    return sequenceStore.pools.find((p) => i >= p.range[0] && i <= p.range[1])
  }

  // `order` defaults to the live play order; export's "whole flow" passes 'forward' so it stays
  // the canonical stored order regardless of the reverse/bounce toggle.
  function buildPlaybackPlan(
    range: [number, number] | null,
    loop = true,
    order: PlayOrder = playOrder.value
  ): PlaybackPlan {
    const seq = sequenceStore.sequence
    const lo = range ? range[0] : 0
    const hi = range ? range[1] : seq.length - 1

    const clusters: Cluster[] = []
    const directionOverrides: (ArpeggioDirection | undefined)[] = []
    const latchOverrides: (boolean | undefined)[] = []
    const realIndex: number[] = []
    const repeatInfo: ([number, number] | null)[] = []

    function pushRow(r: number, pool: Pool | undefined, info: [number, number] | null) {
      clusters.push(seq[r])
      directionOverrides.push(pool?.playback?.direction)
      latchOverrides.push(pool?.playback?.latchMode)
      realIndex.push(r)
      repeatInfo.push(info)
    }

    if (order === 'reverse') {
      // Repeats aren't supported in reverse yet (Paul's "continue the repeats" ask was
      // specifically about the forward start-from-selected case) — every row plays once,
      // in reverse order, same as before; direction/latch overrides still apply since
      // they don't depend on play order.
      for (let i = hi; i >= lo; i--) pushRow(i, poolContaining(i), null)
      return { clusters, directionOverrides, latchOverrides, realIndex, repeatInfo }
    }

    let i = lo
    // Starting partway through a pool that has repeats: the partial first pass (from
    // here to the pool's end) counts as repeat 1, then the pool plays in full for
    // whatever repeats remain — "continue with the repeats from where it is, not from
    // the beginning" (Paul, 2026-10-10) — rather than silently dropping the repeat count
    // just because playback didn't start at the pool's own first row.
    const startingPool = poolContaining(lo)
    if (
      startingPool &&
      lo > startingPool.range[0] &&
      startingPool.range[1] <= hi &&
      (startingPool.playback?.repeatCount ?? 1) > 1
    ) {
      const total = startingPool.playback?.repeatCount ?? 1
      for (let r = lo; r <= startingPool.range[1]; r++) pushRow(r, startingPool, [1, total])
      for (let rep = 2; rep <= total; rep++) {
        for (let r = startingPool.range[0]; r <= startingPool.range[1]; r++) {
          pushRow(r, startingPool, [rep, total])
        }
      }
      i = startingPool.range[1] + 1
    }

    while (i <= hi) {
      const pool = poolContaining(i)
      // Only a pool fully contained within the playing range repeats — one straddling
      // the range's edge just plays its in-range rows once, same as an ungrouped row,
      // rather than defining partial-repeat semantics for a boundary case.
      const fullyContained = !!pool && pool.range[0] >= lo && pool.range[1] <= hi
      const repeatCount = fullyContained ? (pool!.playback?.repeatCount ?? 1) : 1
      if (pool && repeatCount > 1 && i === pool.range[0]) {
        for (let rep = 1; rep <= repeatCount; rep++) {
          for (let r = pool.range[0]; r <= pool.range[1]; r++) pushRow(r, pool, [rep, repeatCount])
        }
        i = pool.range[1] + 1
      } else {
        pushRow(i, pool, null)
        i++
      }
    }

    // Bounce: the return pass, each row once (like reverse, no repeats). Looping stops one
    // short of row `lo` since the loop itself wraps back to it; a one-shot ends there.
    if (order === 'bounce') {
      for (let r = hi - 1; r >= (loop ? lo + 1 : lo); r--) pushRow(r, poolContaining(r), null)
    }

    return { clusters, directionOverrides, latchOverrides, realIndex, repeatInfo }
  }

  // What actually got scheduled on the engine for the current/most recent play — mirrors
  // activePlaybackRange's old role (mapping engine positions back to real rows for the
  // highlight) but now also carries repeat progress for the pool header's live counter.
  // Rebuilt fresh on every playLoop()/startFullLoop()/playOnce() call.
  const activePlaybackPlan = ref<PlaybackPlan | null>(null)

  function settingsForPlan(plan: PlaybackPlan) {
    return {
      ...playbackSettings.value,
      directionOverrides: plan.directionOverrides,
      latchOverrides: plan.latchOverrides,
    }
  }

  // playingIndex from the engine is relative to whatever was actually scheduled (the
  // expanded, pool-aware timeline) — map it back to the full flow's real row indices so
  // SequenceHistory highlights the right row instead of always starting at row 1,
  // counting backwards when reversed, or losing its place during a pool's repeats.
  const displayPlayingIndex = computed(() => {
    if (!isPlaying.value || playingIndex.value < 0) return -1
    return activePlaybackPlan.value?.realIndex[playingIndex.value] ?? -1
  })

  // Drives the pool header's live "2/3" repeat counter (replacing its normal stream-count
  // badge while that specific pool is the one playing) — see SequenceHistory.vue's own
  // poolIsPlaying-adjacent handling. null whenever the currently playing row isn't inside
  // a pool with a custom repeat count, which is the common case.
  const currentPoolRepeat = computed<{ poolId: string; current: number; total: number } | null>(() => {
    if (!isPlaying.value || playingIndex.value < 0) return null
    const plan = activePlaybackPlan.value
    const info = plan?.repeatInfo[playingIndex.value]
    if (!plan || !info) return null
    const pool = poolContaining(plan.realIndex[playingIndex.value])
    if (!pool) return null
    return { poolId: pool.id, current: info[0], total: info[1] }
  })

  // Reverted "start from a selected/previewed row" entirely (Paul, 2026-10-14) — this used
  // to also have a loop-mode lead-in-then-settle-into-the-full-loop variant, but Paul's
  // original ask was for playback to always start at the top of the flow, full stop; the
  // first pass at this revert only caught the non-looping playOnce() case (see its own
  // comment below). playLoop() is now a thin wrapper kept only because it already has many
  // call sites — collapsing them all to call startFullLoop() directly wasn't worth the
  // touch count for what's now a one-line difference.
  function playLoop() {
    startFullLoop()
  }

  function startFullLoop() {
    const plan = buildPlaybackPlan(loopRange.value, true)
    activePlaybackPlan.value = plan
    audioEngine.playSequence(
      plan.clusters,
      settingsForPlan(plan),
      true
    )
  }

  // Always plays the explicit loop-range (or the whole flow) from the top — see playLoop()
  // above for the full "start from selected" revert.
  function playOnce() {
    const range = loopRange.value
    const plan = buildPlaybackPlan(range, false)
    activePlaybackPlan.value = plan
    audioEngine.playSequence(
      plan.clusters,
      settingsForPlan(plan),
      false
    )
  }

  function auditionHistoryCluster(cluster: Cluster) {
    audioEngine.playCluster(cluster, playbackSettings.value)
  }

  function onHistoryAudition(cluster: Cluster) {
    auditionHistoryCluster(cluster)
  }

  function deleteCluster(index: number) {
    audioEngine.stopLoop(true)
    sequenceStore.deleteAt(index)
    sequenceStore.setLoopResolved(false)
  }

  // duplicateAt/duplicateRange never change the sequence's last cluster's value (they only
  // insert, never modify or remove an existing entry) — so unlike edit/reorder above,
  // there's no advance() call here, same reasoning as deleteCluster's non-last-row case.
  // Briefly highlights the newly-inserted row (duplicateAt always inserts right after the
  // source, at index + 1 — see its own comment in sequenceStore.ts) rather than a toast,
  // which would only say "it happened," not "where" (Paul, 2026-10-14). Timeout tracked so
  // a second duplicate fired before the first one's highlight fades (still possible via
  // repeated swipes) retargets cleanly instead of racing an earlier clear against the new
  // highlight.
  const justDuplicatedIndex = ref<number | null>(null)
  let justDuplicatedTimeout: ReturnType<typeof setTimeout> | null = null

  function duplicateCluster(index: number) {
    audioEngine.stopLoop(true)
    sequenceStore.duplicateAt(index)
    sequenceStore.setLoopResolved(false)
    if (justDuplicatedTimeout) clearTimeout(justDuplicatedTimeout)
    justDuplicatedIndex.value = index + 1
    justDuplicatedTimeout = setTimeout(() => {
      justDuplicatedIndex.value = null
      justDuplicatedTimeout = null
    }, 1800)
  }

  // A toast here, but deliberately not for duplicateCluster() above — a single-row
  // duplicate is meant to be tapped rapidly and repeatedly (duplicate-mode's whole point
  // is fast, one-handed, run-down-the-list use), and a toast on every tap would fight
  // that fluidity. A range duplicate is a single deliberate commitment, often covering
  // streams that then scroll out of view, so confirming it actually happened earns its
  // moment (Paul, 2026-10-08).
  function duplicateRangeClusters(start: number, end: number) {
    audioEngine.stopLoop(true)
    sequenceStore.duplicateRange(start, end)
    sequenceStore.setLoopResolved(false)
    const count = end - start + 1
    duplicateFlashMessage.value = `${count} stream${count === 1 ? '' : 's'} duplicated`
    duplicateFlash.value = true
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

  // Pools — a pure organizational layer, see sequenceStore.ts's own Pool comment.
  // create/ungroup/rename/toggle-expanded never touch `sequence` itself, so none of them
  // need the stopLoop/setLoopResolved/advance treatment the row-mutating handlers above
  // do; delete and the block-move do (they remove or reorder real rows), so those two
  // mirror deleteCluster/reorderClusters exactly.
  function createPool(start: number, end: number) {
    const id = sequenceStore.createPool(start, end)
    if (!id) return
    const name = sequenceStore.pools.find((p) => p.id === id)?.name ?? 'pool'
    poolCreatedMessage.value = `"${name}" created — swipe its header to ungroup`
    poolCreatedFlash.value = true
  }

  function deletePoolRows(id: string) {
    audioEngine.stopLoop(true)
    sequenceStore.deletePool(id)
    sequenceStore.setLoopResolved(false)
  }

  // Inserts real rows (a copy of the pool's own), same treatment as deleteCluster/
  // duplicateCluster above. Reuses the existing duplicate toast rather than a dedicated
  // one — same "confirm a deliberate, occasional action" reasoning duplicateRangeClusters'
  // own toast already rests on.
  function duplicatePool(id: string) {
    audioEngine.stopLoop(true)
    const newId = sequenceStore.duplicatePool(id)
    sequenceStore.setLoopResolved(false)
    if (!newId) return
    const name = sequenceStore.pools.find((p) => p.id === newId)?.name ?? 'pool'
    duplicateFlashMessage.value = `"${name}" duplicated`
    duplicateFlash.value = true
  }

  function ungroupPool(id: string) {
    sequenceStore.ungroupPool(id)
  }

  function togglePoolExpanded(id: string) {
    sequenceStore.togglePoolExpanded(id)
  }

  function renamePool(id: string, name: string) {
    sequenceStore.renamePool(id, name)
  }

  function reorderPoolBlock(id: string, targetIndex: number) {
    audioEngine.stopLoop(true)
    sequenceStore.reorderPoolBlock(id, targetIndex)
    sequenceStore.setLoopResolved(false)
    advance()
  }

  const showSaveConfirm = ref(false)

  // listSessions() reads localStorage directly, not a reactive source — savedSessionName
  // below only re-derives when its tracked reactive deps change (just savedSessionId), so a
  // rename via renameSession() wouldn't otherwise be picked up (same id, same session, only
  // the name changed). Bumped by commitTitleRename() purely as a dependency to force
  // recomputation, same problem SavedSessions.vue solves differently (it re-reads
  // listSessions() into its own local ref after every mutation).
  const titleRenameTick = ref(0)

  const savedSessionName = computed(() => {
    titleRenameTick.value
    const id = sequenceStore.savedSessionId
    if (!id) return ''
    return listSessions().find((s) => s.id === id)?.name ?? 'this flow'
  })

  // Header title mirrors a saved file's name back to the user (Logic/Docs convention) —
  // falls back to the "eddy" wordmark for a fresh/unsaved session. The "eddy-" default-name
  // prefix (see defaultSessionName() in sessionStorage.ts) earns its keep on exported
  // filenames that leave the app, but is redundant here since the app chrome already
  // supplies that context — stripped for display only, not from the stored name itself.
  const headerTitle = computed(() => savedSessionName.value.replace(/^eddy-/, '') || 'eddy')

  // Inline title rename — only meaningful once a session is actually saved (nothing to
  // rename in Past Flows otherwise), so the title stays plain, non-interactive text for a
  // fresh/unsaved session, same "eddy" fallback as headerTitle above. Mirrors
  // SavedSessions.vue's own tap-to-rename pattern (prefill, select-all, commit on
  // enter/blur, Escape to cancel without saving) rather than inventing a different one.
  const isEditingTitle = ref(false)
  const editTitleName = ref('')
  const titleInputRef = ref<HTMLInputElement | null>(null)

  function startEditTitle() {
    if (!sequenceStore.savedSessionId) return
    editTitleName.value = savedSessionName.value
    isEditingTitle.value = true
    nextTick(() => titleInputRef.value?.select())
  }

  function commitTitleRename() {
    if (!isEditingTitle.value) return
    const id = sequenceStore.savedSessionId
    const trimmed = editTitleName.value.trim()
    if (id && trimmed) {
      renameSession(id, trimmed)
      titleRenameTick.value++
    }
    isEditingTitle.value = false
  }

  function cancelTitleRename() {
    isEditingTitle.value = false
  }

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

  function channelState() {
    return {
      keyLocked: settingsStore.keyLocked,
      keyRoot: settingsStore.keyRoot,
      scaleId: settingsStore.scaleId,
      moodId: settingsStore.moodId ?? undefined,
      velocitySeed: sequenceStore.velocitySeed,
    }
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
      settingsStore.timeSignature,
      sequenceStore.pools,
      channelState()
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
      settingsStore.timeSignature,
      sequenceStore.pools,
      channelState()
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
  // What export reads is the same expanded, pool-aware timeline playback schedules (pool
  // repeats unrolled, per-row direction/latch overrides) — before 2026-10-22 export took the
  // flat stored rows plus the global direction/latch, so pool repeats and pool arpeggio
  // direction were silently missing from MIDI and WAV (octave shift survived only because it
  // is baked into the rows). `sequence` is the scope's plain stored rows, for copy-text.
  interface ExportScope {
    sequence: Cluster[]
    plan: PlaybackPlan
  }
  type ExportRun = (scope: ExportScope) => void | Promise<void>

  function exportScopeFor(which: 'loop' | 'flow'): ExportScope {
    if (which === 'flow') {
      // Every row, in the current flow direction (downstream / upstream / ebb and flow) with
      // pools applied — what the play button would play, minus any loop range. (It used to be
      // pinned to stored order, so upstream and ebb-and-flow exported as downstream — Paul,
      // 2026-10-22.) loop=true gives ebb and flow's loop form, 1-2-3-4-3-2, so the file loops
      // cleanly. `sequence` stays the plain stored rows, for copy-text's numbering.
      return { sequence: sequenceStore.sequence, plan: buildPlaybackPlan(null, true) }
    }
    return { sequence: playbackSequence.value, plan: buildPlaybackPlan(loopRange.value, true) }
  }

  const pendingExportRun = ref<ExportRun | null>(null)
  const showExportScopeConfirm = ref(false)
  // Copy-text isn't really an "export" in the user's own vocabulary — it's a copy. The
  // alert's header verb follows whichever action actually triggered it.
  const exportScopeVerb = ref('export')

  function requestExport(run: ExportRun, verb = 'export') {
    if (!loopRange.value) {
      run(exportScopeFor('flow'))
      return
    }
    pendingExportRun.value = run
    exportScopeVerb.value = verb
    showExportScopeConfirm.value = true
  }

  function runPendingExport(which: 'loop' | 'flow') {
    pendingExportRun.value?.(exportScopeFor(which))
    pendingExportRun.value = null
  }

  const exportScopeAlertButtons = [
    { text: 'this loop', handler: () => runPendingExport('loop') },
    { text: 'whole flow', handler: () => runPendingExport('flow') },
  ]

  async function exportMidi(scope: ExportScope) {
    await exportSequenceAsMidi(scope.plan.clusters, {
      bpm: settingsStore.tempo,
      direction: settingsStore.arpeggioDirection,
      subdivision: settingsStore.subdivision,
      beatsPerBar: TIME_SIGNATURE_BEATS[settingsStore.timeSignature],
      latch: settingsStore.latchMode,
      instrument: settingsStore.instrument,
      velocitySeed: sequenceStore.velocitySeed,
      directionOverrides: scope.plan.directionOverrides,
      latchOverrides: scope.plan.latchOverrides,
    })
  }

  // Rendering happens via Tone.Offline() (faster than real time, but not instant —
  // several seconds for a long latched sequence) — the button disables and relabels
  // itself while it runs rather than looking like a dead tap.
  const exportingAudio = ref(false)

  async function exportAudio(scope: ExportScope) {
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
        scope.plan.clusters,
        settingsStore.instrument,
        settingsForPlan(scope.plan),
        settingsStore.ambience
      )
    } catch (err) {
      console.error('Audio export failed:', err)
    } finally {
      exportingAudio.value = false
    }
  }

  function copyText(scope: ExportScope) {
    const text = exportSequenceAsText(scope.sequence)
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
    font-size: var(--text-md);
    font-weight: 300;
    letter-spacing: 0.12em;
    text-align: center;
    color: var(--color-text-dim);
    /* ion-title's default mode (used here, not size="small" — that flips white-space to
       normal and wraps instead of truncating) is an absolutely-positioned, full-width
       overlay with built-in single-line ellipsis; its default 90px inline padding
       assumes a single standard nav button per side, too narrow for this toolbar's 3
       fixed-size icon buttons (save/undo/redo) on the end. Widen it symmetrically to
       that cluster's known width (not a guess) on BOTH sides — the overlay stays
       truly centered only when the padding is equal, even though the start side (one
       back button) doesn't actually need as much room. */
    padding-inline-start: calc(3 * var(--tap-min));
    padding-inline-end: calc(3 * var(--tap-min));
  }

  .session-title-text.editable {
    cursor: pointer;
  }
  .session-title-text.editable:active {
    color: var(--color-text);
  }

  /* Matches .session-title's own font/size/color exactly so swapping to edit mode doesn't
     shift layout — border-bottom (not a full input border) is the only visual delta,
     signaling "this is editable" without looking like a generic form field. */
  .session-title-input {
    width: 100%;
    background: none;
    border: none;
    border-bottom: 1px solid var(--color-accent);
    font-family: inherit;
    font-size: inherit;
    font-weight: inherit;
    letter-spacing: inherit;
    text-align: center;
    color: var(--color-text);
    padding: 0;
  }
  .session-title-input:focus {
    outline: none;
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

  .loop-banner-actions {
    margin: 0.5rem 0 0;
    font-family: var(--font-sans);
    font-size: var(--text-base);
    font-style: normal;
    color: var(--color-text-dim);
  }

  .loop-banner-actions .inline-btn {
    color: var(--color-text);
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

  /* Wide viewports: keep the bar and drawer *backgrounds and dividers* full-width (the usual
     player-bar look) but line their *contents* up with the 500px column above, so the open
     drawer isn't a mobile layout stretched across 2000px with controls pinned to the far
     edges. Padding = half the leftover width, never less than the usual 1rem. */
  @media (min-width: 560px) {
    .footer-bar,
    .tray-row.playback-row,
    .tray-row.export-row,
    .grid-section {
      padding-inline: max(1rem, calc((100% - 500px) / 2));
    }
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
  /* Equal air between the lock, refresh, and multi glyphs without overlapping tap targets
     (an earlier negative-margin version let refresh swallow the lock's taps). Two adjacent
     44px icon boxes leave a full box of space between glyphs, while an icon box next to
     the bordered multi button only leaves half — so push multi out by that half. */
  .streams-actions {
    /* 36px-wide (still 44px tall) icon boxes: at the full 44px the header no longer fit on
       one line at 375pt (iPhone SE/mini) and the "streams — tap to hear" label wrapped. */
    --streams-icon-w: 2.25rem;
  }
  .streams-actions .refresh-streams-btn {
    min-width: var(--streams-icon-w);
  }
  .streams-actions .multi-toggle {
    margin-left: calc((var(--streams-icon-w) - var(--icon-sm)) / 2);
  }
  .lock-streams-btn.is-locked {
    color: var(--color-text);
  }

  .channel-chip {
    display: block;
    margin: -0.25rem 0 0.6rem;
    padding: 0.2rem 0;
    background: none;
    border: none;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.06em;
    color: var(--color-text-dim);
  }
  .channel-chip:hover {
    color: var(--color-text);
  }

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

  /* Only rendered at all in pool-playback context (v-if, not just hidden) — there's no
     global "repeat count"/"shift" concept this row could otherwise fall back to showing,
     unlike every other control in this tray, which stays mounted and just gets :disabled.
     Two label-above-buttons groups side by side (repeat, shift) — same visual language as
     .playback-label above .toggle-row, just applied at a finer grain since these two sit
     together in what used to be repeat's single inline row (Paul, 2026-10-13: wanted
     repeat's label out of line with its buttons, and the new shift buttons to match). */
  .pool-adjust-row {
    display: flex;
    gap: 1.5rem;
    flex: 1 1 100%;
  }
  .adjust-group {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .adjust-buttons {
    display: flex;
    gap: 0.3rem;
  }
  .repeat-btn {
    min-width: 2.2rem;
    font-size: var(--text-sm);
    font-family: var(--font-mono);
  }
  .shift-btn {
    min-width: 2.8rem;
    font-size: var(--text-sm);
    font-family: var(--font-mono);
  }
</style>
