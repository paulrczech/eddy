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
  const subdivision = ref<Subdivision>(4)  // 16th notes

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

  function saveAsDefault() {
    const defaults: StoredDefaults = {
      voiceCount: voiceCount.value,
      movementSize: movementSize.value,
      instrument: instrument.value,
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
    saveAsDefault,
    loadDefaults,
  }
})
