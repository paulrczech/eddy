import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type VoiceCount = 3 | 4
export type MovementSize = 'half' | 'step' | 'whole' | 'third' | 'free'
export type KeyLockMode = 'free' | 'diatonic' | 'modal'
export type LoopMode = 'auto' | 'manual' | 'capped'
export type ArpeggioDirection = 'up' | 'down' | 'updown' | 'random' | 'chord'
export type InstrumentType =
  | 'piano' | 'guitar-acoustic' | 'electric-piano' | 'electric-guitar' | 'holdsworthian-pad'
// Arpeggio note grid, in notes per beat — 0.5 = half, 1 = quarter, 2 = 8th,
// 3 = triplet, 4 = 16th. Shared by live playback (useAudioEngine) and MIDI
// export (midiUtils) so they always match.
export type Subdivision = 0.5 | 1 | 2 | 3 | 4

const DEFAULTS_KEY = 'eddy_defaults'

interface StoredDefaults {
  voiceCount: VoiceCount
  movementSize: MovementSize
  instrument: InstrumentType
  tempo?: number                        // optional — old saved defaults predate these four
  arpeggioDirection?: ArpeggioDirection
  subdivision?: Subdivision
  latchMode?: boolean
}

// Hardcoded fallback for the per-flow playback settings (instrument/tempo/direction/grid/
// latch) when no "save as default" blob exists yet — matches this store's own ref initial values.
const PLAYBACK_FALLBACK = {
  instrument: 'piano' as InstrumentType,
  tempo: 100,
  arpeggioDirection: 'up' as ArpeggioDirection,
  subdivision: 2 as Subdivision,  // 8th notes
  latchMode: false,
}

export const useSettingsStore = defineStore('settings', () => {
  const voiceCount = ref<VoiceCount>(3)
  const movementSize = ref<MovementSize>('step')
  const keyLockMode = ref<KeyLockMode>('free')
  const keyRoot = ref<number>(60)    // MIDI C4
  const scaleId = ref<string>('major')
  const loopMode = ref<LoopMode>('auto')
  const maxMoves = ref<number>(32)   // cap for 'capped' loop mode
  const arpeggioDirection = ref<ArpeggioDirection>('up')
  const instrument = ref<InstrumentType>('piano')
  const tempo = ref<number>(100)     // BPM — bumped from 80 after the bar-quantized timing fix made 80 feel sluggish
  const subdivision = ref<Subdivision>(2)  // 8th notes
  // Whether an arpeggio direction repeats to fill the whole bar instead of playing
  // through once and resting. Deliberately independent of arpeggioDirection — chord mode
  // has no effect for latch (see chordInterval-based guard in useAudioEngine.ts), but
  // switching to chord and back must not silently clear this; it's the user's intent,
  // not a per-direction setting.
  const latchMode = ref<boolean>(false)

  const keyLockActive = computed(() => keyLockMode.value !== 'free')

  function setVoiceCount(n: VoiceCount) { voiceCount.value = n }
  function setMovementSize(m: MovementSize) { movementSize.value = m }
  function setKeyLockMode(mode: KeyLockMode) { keyLockMode.value = mode }
  function setKeyRoot(midi: number) { keyRoot.value = midi }
  function setScaleId(id: string) { scaleId.value = id }
  function setLoopMode(mode: LoopMode) { loopMode.value = mode }
  function setMaxMoves(n: number) { maxMoves.value = n }
  function setTempo(bpm: number) { tempo.value = Math.min(200, Math.max(40, bpm)) }
  function setArpeggioDirection(d: ArpeggioDirection) { arpeggioDirection.value = d }
  function setInstrument(i: InstrumentType) { instrument.value = i }
  function setSubdivision(s: Subdivision) { subdivision.value = s }
  function setLatchMode(on: boolean) { latchMode.value = on }

  function saveAsDefault() {
    const defaults: StoredDefaults = {
      voiceCount: voiceCount.value,
      movementSize: movementSize.value,
      instrument: instrument.value,
      tempo: tempo.value,
      arpeggioDirection: arpeggioDirection.value,
      subdivision: subdivision.value,
      latchMode: latchMode.value,
    }
    localStorage.setItem(DEFAULTS_KEY, JSON.stringify(defaults))
  }

  function loadDefaults() {
    try {
      const raw = localStorage.getItem(DEFAULTS_KEY)
      if (!raw) return
      const defaults = JSON.parse(raw) as StoredDefaults
      if (defaults.voiceCount) voiceCount.value = defaults.voiceCount
      if (defaults.movementSize) movementSize.value = defaults.movementSize
      if (defaults.instrument) instrument.value = defaults.instrument
    } catch {
      // corrupt storage — ignore
    }
  }

  // Reset just the per-flow playback settings (instrument/tempo/direction/grid) to the
  // saved default if one exists, else the hardcoded fallback — always assigns (unlike
  // loadDefaults() above, which only overwrites fields present in storage), so this is
  // a true reset rather than a hydrate-once. Deliberately leaves voiceCount/movementSize
  // untouched: those are chosen via the Home settings sheet each time anyway and aren't
  // meant to reset between flows, unlike instrument/tempo/direction/grid, which have no
  // equivalent "choose before starting" moment and would otherwise silently carry over
  // from whatever the previous flow happened to leave them at.
  function resetPlaybackDefaults() {
    let saved: StoredDefaults | null = null
    try {
      const raw = localStorage.getItem(DEFAULTS_KEY)
      if (raw) saved = JSON.parse(raw) as StoredDefaults
    } catch {
      // corrupt storage — fall through to hardcoded fallback
    }
    instrument.value = saved?.instrument ?? PLAYBACK_FALLBACK.instrument
    tempo.value = saved?.tempo ?? PLAYBACK_FALLBACK.tempo
    arpeggioDirection.value = saved?.arpeggioDirection ?? PLAYBACK_FALLBACK.arpeggioDirection
    subdivision.value = saved?.subdivision ?? PLAYBACK_FALLBACK.subdivision
    latchMode.value = saved?.latchMode ?? PLAYBACK_FALLBACK.latchMode
  }

  return {
    voiceCount,
    movementSize,
    keyLockMode,
    keyRoot,
    scaleId,
    loopMode,
    maxMoves,
    arpeggioDirection,
    instrument,
    tempo,
    subdivision,
    latchMode,
    keyLockActive,
    setVoiceCount,
    setMovementSize,
    setKeyLockMode,
    setKeyRoot,
    setScaleId,
    setLoopMode,
    setMaxMoves,
    setTempo,
    setArpeggioDirection,
    setInstrument,
    setSubdivision,
    setLatchMode,
    saveAsDefault,
    loadDefaults,
    resetPlaybackDefaults,
  }
})
