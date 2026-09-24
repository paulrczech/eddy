import { ref, readonly } from 'vue'
import * as Tone from 'tone'
import type { Cluster } from '../utils/noteUtils'
import { midiToName, MIDI_MIN, MIDI_MAX } from '../data/notes'
import type { InstrumentType, Subdivision } from '../stores/settingsStore'

// Salamander Grand Piano samples (Alexander Holm, CC-BY 3.0) — self-hosted locally rather
// than fetched from tonejs.github.io, so playback doesn't depend on a third party's uptime.
// See CREDITS.md for full attribution.
const SALAMANDER_BASE = '/samples/piano/'
const SALAMANDER_URLS: Record<string, string> = {
  'A0':  'A0.mp3',  'C1':  'C1.mp3',  'D#1': 'Ds1.mp3', 'F#1': 'Fs1.mp3',
  'A1':  'A1.mp3',  'C2':  'C2.mp3',  'D#2': 'Ds2.mp3', 'F#2': 'Fs2.mp3',
  'A2':  'A2.mp3',  'C3':  'C3.mp3',  'D#3': 'Ds3.mp3', 'F#3': 'Fs3.mp3',
  'A3':  'A3.mp3',  'C4':  'C4.mp3',  'D#4': 'Ds4.mp3', 'F#4': 'Fs4.mp3',
  'A4':  'A4.mp3',  'C5':  'C5.mp3',  'D#5': 'Ds5.mp3', 'F#5': 'Fs5.mp3',
  'A5':  'A5.mp3',  'C6':  'C6.mp3',
}

// Guitar samples (nbrosowsky/tonejs-instruments, CC-BY 3.0) — self-hosted locally for
// the same reason as the piano above. See CREDITS.md for full attribution.
const NBROSOWSKY_BASE = '/samples/'

const GUITAR_ACOUSTIC_URLS: Record<string, string> = {
  'A2': 'A2.mp3',  'A3': 'A3.mp3',  'A4': 'A4.mp3',
  'A#2': 'As2.mp3', 'A#3': 'As3.mp3', 'A#4': 'As4.mp3',
  'B2': 'B2.mp3',  'B3': 'B3.mp3',  'B4': 'B4.mp3',
  'C3': 'C3.mp3',  'C4': 'C4.mp3',  'C5': 'C5.mp3',
  'C#3': 'Cs3.mp3', 'C#4': 'Cs4.mp3', 'C#5': 'Cs5.mp3',
  'D2': 'D2.mp3',  'D3': 'D3.mp3',  'D4': 'D4.mp3',  'D5': 'D5.mp3',
  'D#2': 'Ds2.mp3', 'D#3': 'Ds3.mp3', 'D#4': 'Ds4.mp3',
  'E2': 'E2.mp3',  'E3': 'E3.mp3',  'E4': 'E4.mp3',
  'F2': 'F2.mp3',  'F3': 'F3.mp3',  'F4': 'F4.mp3',
  'F#2': 'Fs2.mp3', 'F#3': 'Fs3.mp3', 'F#4': 'Fs4.mp3',
  'G2': 'G2.mp3',  'G3': 'G3.mp3',  'G4': 'G4.mp3',
  'G#2': 'Gs2.mp3', 'G#3': 'Gs3.mp3', 'G#4': 'Gs4.mp3',
}

// Electric piano and electric guitar samples via Pianobook.co.uk (royalty-free per
// Pianobook's standard license). See CREDITS.md for full attribution.

// Electric piano — 26 notes, whole-tone spacing A1-C6, "mf" dynamic layer. A1-D2 are a
// short run of extra low notes (matching the standard piano's A1 floor) below the
// otherwise-consistent E2-C6 whole-tone ladder.
const ELECTRIC_PIANO_URLS: Record<string, string> = {
  'A1': 'A1.mp3', 'C2': 'C2.mp3', 'D2': 'D2.mp3',
  'E2': 'E2.mp3', 'F#2': 'Fs2.mp3', 'G#2': 'Gs2.mp3', 'A#2': 'As2.mp3',
  'C3': 'C3.mp3', 'D3': 'D3.mp3', 'E3': 'E3.mp3', 'F#3': 'Fs3.mp3', 'G#3': 'Gs3.mp3', 'A#3': 'As3.mp3',
  'C4': 'C4.mp3', 'D4': 'D4.mp3', 'E4': 'E4.mp3', 'F#4': 'Fs4.mp3', 'G#4': 'Gs4.mp3', 'A#4': 'As4.mp3',
  'C5': 'C5.mp3', 'D5': 'D5.mp3', 'E5': 'E5.mp3', 'F#5': 'Fs5.mp3', 'G#5': 'Gs5.mp3', 'A#5': 'As5.mp3',
  'C6': 'C6.mp3',
}

// Electric guitar (sustained "LONG_MODERN" swell articulation, not plucked) — 12 root
// notes, minor-3rd spacing, D2-B4. Loud velocity layer, trimmed from the pack's raw
// 14-31s samples down to 7s with a fade-out (Eddy never sustains a note that long).
const ELECTRIC_GUITAR_URLS: Record<string, string> = {
  'D2': 'D2.mp3', 'F2': 'F2.mp3', 'G#2': 'Gs2.mp3', 'B2': 'B2.mp3',
  'D3': 'D3.mp3', 'F3': 'F3.mp3', 'G#3': 'Gs3.mp3', 'B3': 'B3.mp3',
  'D4': 'D4.mp3', 'F4': 'F4.mp3', 'G#4': 'Gs4.mp3', 'B4': 'B4.mp3',
}

// Holdsworthian pad ("Blackhole Guitars" by JWB) — sparse, every fifth (7 semitones),
// E2-A#5. Louder "LOUDNR.1" variant. Three low roots (C0/G0/D1) exist in the source but
// sit far below Eddy's usable range and were skipped. See CREDITS.md for full attribution.
const HOLDSWORTHIAN_PAD_URLS: Record<string, string> = {
  'E2': 'E2.mp3', 'B2': 'B2.mp3', 'F#3': 'Fs3.mp3', 'C#4': 'Cs4.mp3',
  'G#4': 'Gs4.mp3', 'D#5': 'Ds5.mp3', 'A#5': 'As5.mp3',
}

// Note-picker range per instrument — picker-only, matches each instrument's natural/sampled
// register. Does NOT affect the voice-leading engine, which always uses the global MIDI_MIN/
// MIDI_MAX regardless of instrument, so switching instruments mid-flow never changes which
// moves are reachable — only what you can type in as a starting cluster.
export const INSTRUMENT_NOTE_RANGE: Record<InstrumentType, { min: number; max: number }> = {
  piano:            { min: 33,       max: MIDI_MAX }, // A1–C6
  'guitar-acoustic': { min: MIDI_MIN, max: MIDI_MAX },
  'electric-piano':  { min: 33,       max: 84 },       // A1-C6
  'electric-guitar': { min: 38,       max: 71 },       // D2-B4
  'holdsworthian-pad': { min: 40,     max: 82 },       // E2-A#5
}

const LOOP_GAP_BEATS = 1
const BEATS_PER_BAR = 4  // 4/4 assumption, matches midiUtils.ts's bar-per-cluster export convention

export type ArpeggioDirection = 'up' | 'down' | 'updown' | 'random' | 'chord'

export interface PlaybackSettings {
  bpm: number
  direction: ArpeggioDirection
  subdivision?: Subdivision  // notes per beat; defaults to 16th notes
}

// Fixed note durations for plucky/percussive instruments
const NOTE_DURATIONS: Partial<Record<InstrumentType, string>> = {
  piano:            '2n',
  'guitar-acoustic':'2n',
  'electric-piano': '2n', // struck/decaying, same character class as piano
  'electric-guitar':'1n', // sustained swell articulation, needs room to show
  'holdsworthian-pad':'1n', // sustained pad character
}

// Tone.Sampler's release (the fade-out after triggerRelease) defaults to 0.1s — fine for
// a struck/plucked note, but a hard, audible cutoff for anything sustained. The pad-style
// instruments above get a real fade instead.
const RELEASE_TIMES: Partial<Record<InstrumentType, number>> = {
  'electric-guitar': 2.5,
  'holdsworthian-pad': 2.5,
}

function noteRelease(instrumentType: InstrumentType): number {
  return RELEASE_TIMES[instrumentType] ?? 0.1
}

function noteDuration(): string {
  const type = currentInstrumentType ?? 'piano'
  return NOTE_DURATIONS[type] ?? '2n'
}

type ToneInstrument = Tone.Sampler

let instrument: ToneInstrument | null = null
let currentInstrumentType: InstrumentType | null = null
let loopPart: Tone.Part | null = null
let rafId: number | null = null
let currentClusterDuration = 0
let currentSequenceLength = 0
let lastPlaySequenceTime = 0

const isLoaded = ref(false)
const isPlaying = ref(false)
const loadError = ref<string | null>(null)
const playingIndex = ref<number>(-1)

function midiToTone(midi: number): string {
  return midiToName(midi)
}

function intervalFromBpm(bpm: number, subdivision: Subdivision = 4): number {
  return 60 / bpm / subdivision
}

function buildArpeggioNotes(cluster: number[], direction: ArpeggioDirection): number[] {
  const sorted = [...cluster].sort((a, b) => a - b)
  switch (direction) {
    case 'up':
    case 'chord':
      return sorted
    case 'down':
      return [...sorted].reverse()
    case 'updown': {
      const inner = sorted.slice(1, sorted.length - 1).reverse()
      return [...sorted, ...inner]
    }
    case 'random':
      return [...sorted].sort(() => Math.random() - 0.5)
    default:
      return sorted
  }
}

async function init(instrumentType: InstrumentType = 'piano'): Promise<void> {
  // No-op if same instrument already loaded
  if (instrument && isLoaded.value && currentInstrumentType === instrumentType) return

  // Dispose previous instrument
  if (instrument) {
    instrument.dispose()
    instrument = null
    isLoaded.value = false
  }

  await Tone.start()
  currentInstrumentType = instrumentType

  const SAMPLER_CONFIGS: Record<InstrumentType, { urls: Record<string, string>; baseUrl: string }> = {
    piano:            { urls: SALAMANDER_URLS,      baseUrl: SALAMANDER_BASE },
    'guitar-acoustic':{ urls: GUITAR_ACOUSTIC_URLS, baseUrl: NBROSOWSKY_BASE + 'guitar-acoustic/' },
    'electric-piano': { urls: ELECTRIC_PIANO_URLS,  baseUrl: '/samples/electric-piano/' },
    'electric-guitar':{ urls: ELECTRIC_GUITAR_URLS, baseUrl: '/samples/electric-guitar/' },
    'holdsworthian-pad':{ urls: HOLDSWORTHIAN_PAD_URLS, baseUrl: '/samples/holdsworthian-pad/' },
  }

  // Guards against stale instrument values from old saved sessions/defaults
  // (e.g. 'cello'/'violin' persisted before those were removed)
  const { urls, baseUrl } = SAMPLER_CONFIGS[instrumentType] ?? SAMPLER_CONFIGS.piano
  // Fetch + decode ourselves rather than letting Tone.Sampler do it: in Capacitor's iOS
  // WKWebView, fetch() against the capacitor:// scheme returns status 0 / ok=false even
  // though the body is delivered intact, and Tone rejects every sample on !response.ok.
  try {
    const buffers = await loadBuffers(urls, baseUrl)
    return await new Promise((resolve) => {
      instrument = new Tone.Sampler({
        urls: buffers,
        release: noteRelease(instrumentType),
        onload: () => {
          isLoaded.value = true
          loadError.value = null
          resolve()
        },
      }).toDestination()
    })
  } catch (err) {
    loadError.value = `Failed to load ${instrumentType} samples`
    console.error('Sampler load error:', err)
    throw err
  }
}

async function loadBuffers(
  urls: Record<string, string>,
  baseUrl: string,
): Promise<Record<string, AudioBuffer>> {
  const ctx = Tone.getContext().rawContext
  const entries = await Promise.all(
    Object.entries(urls).map(async ([note, file]) => {
      const bytes = await (await fetch(baseUrl + file)).arrayBuffer()
      return [note, await ctx.decodeAudioData(bytes)] as const
    }),
  )
  return Object.fromEntries(entries)
}

function playCluster(
  cluster: number[],
  settings: PlaybackSettings = { bpm: 80, direction: 'up' },
  onComplete?: () => void
): void {
  if (!instrument || !isLoaded.value) return

  stopLoop()

  const interval = settings.direction === 'chord' ? 0 : intervalFromBpm(settings.bpm, settings.subdivision)
  const notes = buildArpeggioNotes(cluster, settings.direction)
  const now = Tone.now()
  const dur = noteDuration()

  notes.forEach((midi, i) => {
    const vel = humanVelocity(0.72, i, notes.length)
    instrument!.triggerAttackRelease(midiToTone(midi), dur, now + i * interval, vel)
  })

  if (onComplete) {
    const totalTime = (notes.length - 1) * interval + Tone.Time(dur).toSeconds()
    setTimeout(onComplete, totalTime * 1000)
  }
}

// Humanized velocity — base with slight random variation and arpeggio position taper
function humanVelocity(baseVelocity: number, noteIdx: number, totalNotes: number): number {
  const jitter = (Math.random() - 0.5) * 0.24  // ±12% random humanization
  const taper = noteIdx === 0 ? 0 : -0.06 * (noteIdx / Math.max(totalNotes - 1, 1))
  return Math.min(1, Math.max(0.3, baseVelocity + jitter + taper))
}

function playSequence(
  sequence: Cluster[],
  settings: PlaybackSettings = { bpm: 80, direction: 'up' },
  loop = true
): void {
  if (!instrument || !isLoaded.value || sequence.length === 0) return
  const now = Date.now()
  if (now - lastPlaySequenceTime < 100) return
  lastPlaySequenceTime = now

  stopLoop()

  const isChord = settings.direction === 'chord'
  const interval = isChord ? 0 : intervalFromBpm(settings.bpm, settings.subdivision)
  const beat = 60 / settings.bpm

  const maxVoices = Math.max(...sequence.map(c => c.length))
  const clusterDuration = isChord
    ? BEATS_PER_BAR * beat
    : maxVoices * interval + LOOP_GAP_BEATS * beat

  const dur = noteDuration()

  const events = sequence.map((cluster, i) => ({
    time: i * clusterDuration,
    notes: buildArpeggioNotes(cluster, settings.direction),
  }))

  const totalDuration = sequence.length * clusterDuration

  // Configure Transport loop params BEFORE starting
  const transport = Tone.getTransport()
  transport.bpm.value = settings.bpm
  transport.loop = loop
  transport.loopStart = 0
  transport.loopEnd = totalDuration

  loopPart = new Tone.Part((time, event) => {
    const total = event.notes.length
    event.notes.forEach((midi: number, noteIdx: number) => {
      const vel = humanVelocity(0.72, noteIdx, total)
      instrument!.triggerAttackRelease(midiToTone(midi), dur, time + noteIdx * interval, vel)
    })
  }, events)

  loopPart.loop = loop
  loopPart.loopEnd = totalDuration
  loopPart.start(0)

  // Small offset gives the scheduler time to commit before playback starts
  transport.start('+0.05')
  isPlaying.value = true

  currentClusterDuration = clusterDuration
  currentSequenceLength = sequence.length
  playingIndex.value = 0

  // When not looping, stop cleanly after one pass
  if (!loop) {
    transport.scheduleOnce(() => {
      stopLoop()
    }, totalDuration)
  }

  function tick() {
    const pos = Tone.getTransport().seconds
    const idx = Math.floor(pos / currentClusterDuration) % currentSequenceLength
    playingIndex.value = idx
    rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)
}

// Stopping the Transport only stops SCHEDULING new notes — any note already triggered
// keeps ringing out its full release. Tone.Sampler bakes the release fade into each
// buffer source at trigger time, so changing `release` afterward can't shorten a note
// that's already sounding. A hard stop instead briefly mutes the shared output, which
// silences whatever's still ringing regardless of its baked-in release, then restores
// volume immediately after so it's ready for whatever plays next.
const HARD_STOP_MUTE_TIME = 0.015

function stopLoop(hardStop = false): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  if (loopPart) {
    loopPart.stop()
    loopPart.dispose()
    loopPart = null
  }
  const transport = Tone.getTransport()
  transport.stop()
  transport.loop = false
  transport.position = 0
  isPlaying.value = false
  playingIndex.value = -1

  if (hardStop && instrument) {
    const now = Tone.now()
    instrument.volume.rampTo(-Infinity, HARD_STOP_MUTE_TIME, now)
    instrument.volume.rampTo(0, 0.001, now + HARD_STOP_MUTE_TIME)
  }
}

function dispose(): void {
  stopLoop()
  if (instrument) {
    instrument.dispose()
    instrument = null
    isLoaded.value = false
    currentInstrumentType = null
  }
}

export function useAudioEngine() {
  return {
    isLoaded: readonly(isLoaded),
    isPlaying: readonly(isPlaying),
    loadError: readonly(loadError),
    playingIndex: readonly(playingIndex),
    init,
    playCluster,
    playSequence,
    stopLoop,
    dispose,
  }
}
