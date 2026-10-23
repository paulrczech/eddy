import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { MOOD_MAP, pickMoodRoot } from '../data/moods'
import type { Spacing } from '../data/spacing'

export type VoiceCount = 3 | 4
export type MovementSize = 'half' | 'step' | 'whole' | 'third' | 'free'
// How the flow's rows are ordered for playback (SequenceHistory's order button, applied in
// SessionView.vue): top to bottom, bottom to top, or forward then back again, looping.
export type PlayOrder = 'forward' | 'reverse' | 'bounce'
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
  // swap in this project.
  | 'piano' | 'piano-salamander'
  | 'guitar-acoustic' | 'electric-guitar'
  // Temp A/B candidate (2026-10-23): "Yamaha CS-30L - Straight Guitar" by modularsamples (freesound.org,
  // Creative Commons 0) — a synthesizer patch, not a recorded guitar. A possible replacement for
  // 'electric-guitar' (Pianobook's Afterglow, whose terms don't allow shipping it in the app).
  | 'electric-guitar-2-temp'
  // 'synth-strings' — Paul's own synthesized pad (a Logic patch he designed, rendered note by
  // note; no third-party samples, so no attribution needed). Chosen 2026-10-22 over two other
  // candidates (a harsher, brighter strings patch, a sweep pad, a synth choir) and the earlier
  // choir pad, which was removed to clear Sonatina licence doubt. Warm (its filter closes
  // slowly over a note), mostly centered, ~1 s bloom. Its four lowest roots carry a low-
  // register assist (scripts/samples/synth-pad.py --low-assist): the patch is so dark that
  // octave-2 notes were nearly pure low hum. The UI calls it "synth strings" (not "string
  // pad": that would suggest real strings).
  | 'synth-strings'
  // Temp A/B candidate, added 2026-10-09 — "Moog Minitaur - Simple Saw" by modularsamples
  // (freesound.org, Creative Commons 0), UI-labeled "analog synth." Fully chromatic
  // across Eddy's whole range (see ANALOG_SYNTH_URLS in useAudioEngine.ts). Intended for
  // ambient arpeggios, not chord-only pad use — deliberately not in PAD_INSTRUMENTS.
  // Gated behind SHOW_ANALOG_SYNTH_TEMP in HomeView.vue/SessionView.vue. If it wins, give
  // it a real InstrumentType slot and delete the temp key/scaffolding, same pattern as
  // every other temp-instrument trial.
  | 'analog-synth-temp'

// Instruments that no longer exist but may still be named by a saved flow or saved defaults
// (they shipped in TestFlight builds): 'holdsworthian-pad' and 'retro-pad' were hidden from
// the pickers then deleted (2026-10-20/21), and 'choir-pad' was removed 2026-10-22 (Sonatina
// licence doubt). All were pads, so an old reference resolves to the pad that replaced them.
const REMOVED_INSTRUMENTS: Record<string, InstrumentType> = {
  'holdsworthian-pad': 'synth-strings',
  'retro-pad': 'synth-strings',
  'choir-pad': 'synth-strings',
}
export function normalizeInstrument(raw: string): InstrumentType {
  return REMOVED_INSTRUMENTS[raw] ?? (raw as InstrumentType)
}
// Temporarily on for a simulator A/B listen (2026-10-09) — see analog-synth-temp above.
// Flip to false (or delete the temp instrument entirely) once Paul's decided whether it
// becomes a real instrument slot.
export const SHOW_ANALOG_SYNTH_TEMP = true
// Temp A/B of the CS-30L electric guitar (2026-10-23) — see 'electric-guitar-2-temp' above.
export const SHOW_ELECTRIC_2_TEMP = true
// Shows which velocity pattern the flow is playing, beside "the flow" in SessionView — a
// tuning aid for working the patterns by ear on a device, not a feature. Off for release
// (2026-10-23); flip to true to bring it back while tuning.
export const SHOW_VELOCITY_PATTERN_LABEL = false
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
  seedStreamCount?: number              // optional — old saved defaults predate this
  spacing?: Spacing                     // optional — old saved defaults predate this
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
  // How spread out the chords are (see data/spacing.ts): applies to a new flow's starting chord
  // and leans the streams toward the chosen band. Like voices/drift: a default, not saved with a
  // flow. 'normal' is the engine exactly as it was.
  const spacing = ref<Spacing>('normal')
  // The "drift" size cap on Home (½ step … free) — wired into generateCandidates() on
  // 2026-10-20; before that it was only displayed and saved, never read by the engine, so
  // every flow behaved as 'free'. Default is now 'step' (½–1 step) — Paul's call after
  // hearing it, same day: smaller moves gave the more beautiful flows, at the cost of
  // looping back sooner (see CLAUDE.md for the measured numbers).
  const movementSize = ref<MovementSize>('step')
  // How many streams a new session starts with — 1 (play a strategy card yourself from
  // here) is the factory default and covers the app's whole normal, guided-discovery
  // identity; anything higher auto-chains that many real voice-led steps (a random
  // strategy drawn, candidates generated from the previous step, one picked at random,
  // confirmed, repeat — see HomeView.vue's autoChainStreams()) before the session ever
  // becomes visible. Deliberately opt-in, buried in settings, never raised by onboarding
  // — this serves a workflow Paul found through real use (generate several rough streams
  // fast, then hand-edit each one), not something a first-time user should ever be
  // nudged toward before they've even seen a strategy card (Paul, 2026-10-10). Capped at
  // 8 — Paul's own example ceiling, and consistent with pools' own repeat-count cap
  // reasoning: past a small bound, there's always another existing tool (here, duplicate
  // mode) to get more.
  const seedStreamCount = ref<number>(1)
  // "The channel" (UI name for the key lock). keyLocked is deliberately separate from
  // keyRoot/scaleId so toggling the lock off keeps the chosen scale for one-tap re-lock —
  // same "user's intent survives a toggle" precedent as latchMode vs. chord direction.
  // Per-app-run only: not part of saveAsDefault()/resetPlaybackDefaults(), since the
  // channel is a choice made at the start of each flow, like the source notes.
  const keyLocked = ref<boolean>(false)
  const keyRoot = ref<number>(60)    // MIDI note — only the pitch class (% 12) matters
  const scaleId = ref<string>('major')
  // The mood chooser's word, when the channel was set that way (null = open, or a hand-picked
  // key). The mood owns the scale; the root is re-rolled at each flow start (rollMoodRoot).
  // Survives unlocking, same "intent survives a toggle" precedent as keyRoot/scaleId.
  const moodId = ref<string | null>(null)
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

  const keyLockActive = computed(() => keyLocked.value)

  function setVoiceCount(n: VoiceCount) { voiceCount.value = n }
  function setMovementSize(m: MovementSize) { movementSize.value = m }
  function setSpacing(sp: Spacing) { spacing.value = sp }
  function setSeedStreamCount(n: number) { seedStreamCount.value = Math.min(8, Math.max(1, n)) }
  function setKeyLocked(on: boolean) { keyLocked.value = on }
  function setKeyRoot(midi: number) { keyRoot.value = midi }
  function setScaleId(id: string) { scaleId.value = id }
  function setMoodId(id: string | null) { moodId.value = id }
  // Lock the channel to a mood: its scale, a freshly rolled root. fitNotes (the current
  // cluster, mid-flow) steers the root toward keeping those notes in key.
  function applyMood(id: string, fitNotes?: number[]) {
    const mood = MOOD_MAP[id]
    if (!mood) return
    moodId.value = id
    scaleId.value = mood.scaleId
    keyLocked.value = true
    keyRoot.value = 60 + pickMoodRoot(mood.scaleId, fitNotes)
  }
  // Re-roll the root for the active mood (no-op for open or a hand-picked key) — called as
  // a flow begins, so the same word lands in a different key each time.
  function rollMoodRoot(fitNotes?: number[]) {
    if (!keyLocked.value || !moodId.value) return
    keyRoot.value = 60 + pickMoodRoot(scaleId.value, fitNotes)
  }
  function setLoopMode(mode: LoopMode) { loopMode.value = mode }
  function setMaxMoves(n: number) { maxMoves.value = n }
  function setTempo(bpm: number) { tempo.value = Math.min(200, Math.max(40, bpm)) }
  function setArpeggioDirection(d: ArpeggioDirection) { arpeggioDirection.value = d }
  function setInstrument(i: InstrumentType) { instrument.value = normalizeInstrument(i) }
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
      seedStreamCount: seedStreamCount.value,
      spacing: spacing.value,
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
      if (defaults.instrument) instrument.value = normalizeInstrument(defaults.instrument)
      if (defaults.seedStreamCount) seedStreamCount.value = defaults.seedStreamCount
      if (defaults.spacing) spacing.value = defaults.spacing
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
    instrument.value = saved?.instrument ? normalizeInstrument(saved.instrument) : PLAYBACK_FALLBACK.instrument
    tempo.value = saved?.tempo ?? PLAYBACK_FALLBACK.tempo
    arpeggioDirection.value = saved?.arpeggioDirection ?? PLAYBACK_FALLBACK.arpeggioDirection
    subdivision.value = saved?.subdivision ?? PLAYBACK_FALLBACK.subdivision
    latchMode.value = saved?.latchMode ?? PLAYBACK_FALLBACK.latchMode
    ambience.value = saved?.ambience ?? PLAYBACK_FALLBACK.ambience
    timeSignature.value = saved?.timeSignature ?? PLAYBACK_FALLBACK.timeSignature
  }

  return {
    voiceCount,
    spacing,
    movementSize,
    seedStreamCount,
    keyLocked,
    keyRoot,
    scaleId,
    moodId,
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
    setSpacing,
    setSeedStreamCount,
    setKeyLocked,
    setKeyRoot,
    setScaleId,
    setMoodId,
    applyMood,
    rollMoodRoot,
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
