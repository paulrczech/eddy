import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type VoiceCount = 3 | 4
export type MovementSize = 'half' | 'step' | 'whole' | 'third' | 'free'
export type KeyLockMode = 'free' | 'diatonic' | 'modal'
export type LoopMode = 'auto' | 'manual' | 'capped'
export type ArpeggioDirection = 'up' | 'down' | 'updown' | 'random' | 'chord'
export type InstrumentType =
  // 'piano' is Mikor Piano Felt (UI label "felt piano"); 'piano-salamander' is a second
  // piano voice (UI label "piano", first in the picker). That key/folder path
  // (public/samples/piano-original/) originally held Salamander Grand Piano V2, restored
  // from git history 2026-09-30 — replaced the same day by VSCO2 Community Edition's
  // upright piano (from Alex Bainter's generative-music course material) after Paul
  // compared them directly and preferred VSCO2. Key/folder kept unchanged across that
  // swap for saved-session backward compatibility, same reasoning as every other content
  // swap in this project (e.g. holdsworthian-pad below).
  | 'piano' | 'piano-salamander'
  // 'holdsworthian-pad' is "Ultra Ambient Pad" content (Julian Morgan via Pianobook) —
  // replaced the original "Blackhole Guitars" pad entirely 2026-09-30; key/folder path
  // kept unchanged for saved-session backward compatibility, same reasoning as the piano
  // swap above. A parallel guitar experiment (nbrosowsky original + lowpass filter, to
  // tame its harshness) was tried the same day and shelved — kept the current Nylon
  // guitar. Superseded as the *default/shown* pad by 'retro-pad' below (2026-10-05, see
  // SHOW_HOLDSWORTHIAN_PAD) — key/type kept, same backward-compatibility reasoning, so an
  // existing saved session still resolves to real audio instead of silently falling back
  // to piano.
  | 'guitar-acoustic' | 'electric-piano' | 'electric-guitar' | 'holdsworthian-pad'
  // 'retro-pad' — Paul's own recording of a Logic RetroSynth patch, printed to audio note
  // by note (see RETRO_PAD_URLS in useAudioEngine.ts) rather than synthesized live. Added
  // 2026-10-05, confirmed by ear as the pad to keep going forward — won out over both
  // holdsworthian-pad (now hidden, see above) and an earlier from-scratch Tone.js
  // synth-pad attempt (live PolySynth + effects chain, chased through two full reworks
  // trying to land "lush/calming" and never fully got there — removed entirely, not kept
  // as a second option, since it never shipped and had no saved-session compatibility to
  // protect).
  | 'retro-pad'
  // Two temp A/B candidates for the acoustic guitar slot, added 2026-10-08 — Paul's own
  // "Gentle Acoustic" and "Gentle Acoustic 2" packs, both minor-third spacing E2-G5.
  // Gated behind SHOW_GENTLE_ACOUSTIC_TEMP in HomeView.vue/SessionView.vue. If one wins,
  // consolidate it into the real 'guitar-acoustic' slot and delete both temp keys/
  // scaffolding entirely, same pattern as the Yindad Acoustic swap; if neither wins (the
  // current dry Yindad Acoustic stays), just delete both.
  | 'guitar-acoustic-gentle-temp' | 'guitar-acoustic-gentle2-temp'

// Hides holdsworthian-pad from both instrument pickers now that retro-pad has replaced
// it as the pad of choice — same "keep the mechanism, hide the control" pattern as
// SHOW_AMBIENCE_CONTROL in SessionView.vue. Not a full deletion like synth-pad got:
// holdsworthian-pad actually shipped (TestFlight 1.0(5) through 1.0(10)), so an existing
// saved session may already reference it — the type/samples/config all stay fully intact,
// just not selectable as a new choice going forward.
export const SHOW_HOLDSWORTHIAN_PAD = false
// Temporarily on for A/B testing (2026-10-08) — see guitar-acoustic-gentle-temp/
// guitar-acoustic-gentle2-temp above. Flip to false (or delete the temp instruments
// entirely) once Paul's picked a winner, same as SHOW_YINDAD_ACOUSTIC_TEMP before it.
export const SHOW_GENTLE_ACOUSTIC_TEMP = true
// Arpeggio note grid, in notes per beat — 0.5 = half, 1 = quarter, 2 = 8th,
// 3 = triplet, 4 = 16th. Shared by live playback (useAudioEngine) and MIDI
// export (midiUtils) so they always match.
export type Subdivision = 0.5 | 1 | 2 | 3 | 4
// 4/4 or 3/4 — both quarter-note-beat meters, so this is really just "how many beats
// make a bar." No 6/8, 12/8, or odd meters yet (would need a real compound-time model,
// not just a different number here). Shared by live playback and MIDI export, same as
// Subdivision above — TIME_SIGNATURE_BEATS is the single place that maps one to the other.
export type TimeSignature = '4/4' | '3/4'
export const TIME_SIGNATURE_BEATS: Record<TimeSignature, number> = {
  '4/4': 4,
  '3/4': 3,
}

const DEFAULTS_KEY = 'eddy_defaults'

interface StoredDefaults {
  voiceCount: VoiceCount
  movementSize: MovementSize
  instrument: InstrumentType
  tempo?: number                        // optional — old saved defaults predate these four
  arpeggioDirection?: ArpeggioDirection
  subdivision?: Subdivision
  latchMode?: boolean
  ambience?: number
  timeSignature?: TimeSignature
}

// Hardcoded fallback for the per-flow playback settings (instrument/tempo/direction/grid/
// latch) when no "save as default" blob exists yet — matches this store's own ref initial values.
const PLAYBACK_FALLBACK = {
  instrument: 'piano' as InstrumentType,
  tempo: 100,
  arpeggioDirection: 'up' as ArpeggioDirection,
  subdivision: 2 as Subdivision,  // 8th notes
  // Defaulted on 2026-10-05 (was false) — Paul's ear: a cluster playing once and resting
  // through most of the bar reads as sparse/uncertain on a first "let it flow," before a
  // new user has found the playback tray to turn it on themselves. Only affects users who
  // haven't saved their own default yet (see saveAsDefault()/StoredDefaults above) —
  // anyone who already has reverts to nothing, their saved value still wins.
  latchMode: true,
  // 0.5, not 1 — REVERB_SETTINGS/CHORUS_SETTINGS in useAudioEngine.ts define "100%" as
  // roughly double each instrument's original always-on wet value (needed real headroom
  // for the dial to do anything audible), so 50% is what lands back on the exact
  // original, already-approved sound. See the REVERB_SETTINGS comment for the full math.
  ambience: 0.5,
  timeSignature: '4/4' as TimeSignature,
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
  // not a per-direction setting. Defaults true — see PLAYBACK_FALLBACK's latchMode
  // comment above for why.
  const latchMode = ref<boolean>(true)
  // 0-1 — scales whichever reverb/chorus sends the current instrument has (see
  // setAmbience() in useAudioEngine.ts). 0.5 reproduces the shipped, already-tuned wet
  // level for every instrument (see REVERB_SETTINGS's comment for why); 0 is fully dry,
  // 1 is roughly double the original — genuinely wetter/more forgiving territory.
  const ambience = ref<number>(0.5)
  // 4/4 or 3/4 — how many beats make a bar. Structural, not live-rampable like ambience:
  // changes bar/cluster duration itself, so a change during playback needs a clean
  // restart (see the SessionView watcher), not a ramp.
  const timeSignature = ref<TimeSignature>('4/4')

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
  function setAmbience(level: number) { ambience.value = Math.min(1, Math.max(0, level)) }
  function setTimeSignature(sig: TimeSignature) { timeSignature.value = sig }

  function saveAsDefault() {
    const defaults: StoredDefaults = {
      voiceCount: voiceCount.value,
      movementSize: movementSize.value,
      instrument: instrument.value,
      tempo: tempo.value,
      arpeggioDirection: arpeggioDirection.value,
      subdivision: subdivision.value,
      latchMode: latchMode.value,
      ambience: ambience.value,
      timeSignature: timeSignature.value,
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
    ambience.value = saved?.ambience ?? PLAYBACK_FALLBACK.ambience
    timeSignature.value = saved?.timeSignature ?? PLAYBACK_FALLBACK.timeSignature
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
    ambience,
    timeSignature,
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
    setAmbience,
    setTimeSignature,
    saveAsDefault,
    loadDefaults,
    resetPlaybackDefaults,
  }
})
