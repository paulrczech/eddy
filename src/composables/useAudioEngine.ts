import { ref, readonly } from 'vue'
import * as Tone from 'tone'
import { App } from '@capacitor/app'
import type { Cluster } from '../utils/noteUtils'
import { midiToName, MIDI_MAX } from '../data/notes'
import type { InstrumentType, Subdivision } from '../stores/settingsStore'

// iOS suspends the WebAudio context whenever the app is backgrounded or the screen
// locks (a real interruption, not just a pause), and nothing resumes it automatically —
// every scheduled note would then silently do nothing until the app was force-restarted.
// Tone.start() is what actually resumes a suspended context (it's not just a first-run
// unlock), and it's idempotent — resolves immediately if the context is already running.
// Registered once at module load (this file is a documented singleton), rather than once
// per useAudioEngine() call, which would otherwise stack up duplicate listeners.
App.addListener('resume', () => {
  Tone.start()
})

// Piano — "Mikor Piano Felt" (Burger&Jacobi piano, felt pedal engaged) via
// Pianobook.co.uk, soft/unlabeled dynamic layer. Replaced the original Salamander Grand
// Piano — brighter/more percussive and read as harsh under Eddy's sustained, looping
// playback; this felt-piano character reads as warm and ambient instead. Sparse, every
// fifth (7 semitones), like holdsworthian-pad. Source filenames were one octave lower
// than their true pitch (confirmed by autocorrelation pitch analysis against 8 of 10
// root samples, matched to within ~50 cents); the keys below are the corrected pitch.
// The pack's 11th root (labeled F6) didn't fit any consistent octave hypothesis and
// sits above Eddy's usable range regardless — skipped rather than guessed. Source
// samples were ~40s (full natural decay) — trimmed to 6s with a 1s fade-out and
// gain-boosted to a comparable level. See CREDITS.md for full attribution.
const PIANO_BASE = '/samples/piano/'
const PIANO_URLS: Record<string, string> = {
  'C1': 'C1.mp3', 'G1': 'G1.mp3', 'D2': 'D2.mp3', 'A2': 'A2.mp3', 'E3': 'E3.mp3',
  'B3': 'B3.mp3', 'F#4': 'Fs4.mp3', 'C#5': 'Cs5.mp3', 'D#6': 'Ds6.mp3', 'A#6': 'As6.mp3',
}

// Acoustic guitar — "Soft Nylon Guitar Lite" by Mike Georgiades via Pianobook.co.uk.
// Replaced the original nbrosowsky/tonejs-instruments steel-string samples, which read
// as too bright/harsh under Eddy's sustained, looping playback — same reasoning as the
// piano swap. Sparse, minor thirds. Two round-robin takes exist per note in the source
// pack (alternate performances, not different dynamics) — Tone.Sampler doesn't support
// round-robin switching, so the first take only.
// IMPORTANT: source filenames were one octave lower than their true pitch, confirmed by
// autocorrelation — 7 of 9 root samples matched within ~10 cents. The other two (labeled
// E1/G1) didn't fit any octave hypothesis — they measured at essentially the exact same
// pitch as the already-confirmed E3/G3 samples, meaning they appear to be pitch-
// duplicated content in the source pack itself. Excluded rather than guessed. This
// leaves only 7 usable roots (C#3-G4) — narrower than the original's full E2-C6, see
// the INSTRUMENT_NOTE_RANGE entry below. Gain-boosted and trimmed to 6s/1s fade-out,
// same treatment as piano. See CREDITS.md for full attribution.
const GUITAR_ACOUSTIC_URLS: Record<string, string> = {
  'C#3': 'Cs3.mp3', 'E3': 'E3.mp3', 'G3': 'G3.mp3', 'A#3': 'As3.mp3',
  'C#4': 'Cs4.mp3', 'E4': 'E4.mp3', 'G4': 'G4.mp3',
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
  'guitar-acoustic': { min: 40,       max: 79 },       // E2-G5 — narrower than the
    // original steel-string samples' full E2-C6; only 7 usable roots (C#3-G4), see
    // GUITAR_ACOUSTIC_URLS
  'electric-piano':  { min: 33,       max: 84 },       // A1-C6
  'electric-guitar': { min: 38,       max: 71 },       // D2-B4
  'holdsworthian-pad': { min: 40,     max: 82 },       // E2-A#5
}

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
  'electric-guitar': 1.2, // was 2.5 — a note was still near full volume when the next
    // one fired, masking each new note's own (genuinely fast, ~100ms) attack; read as
    // both "too long a sustain" and "attack isn't sharp" from the same cause
  'holdsworthian-pad': 2.5,
  piano: 2.0, // felt piano rings naturally — default 0.1s cutoff read as harsh
  'electric-piano': 1.2, // same class of bug as piano had — no release meant a hard
    // 0.1s cutoff, which read as "plucky"/inconsistent since the source recording's own
    // natural sustain varies note to note; a real release masks that instead of fighting it
  'guitar-acoustic': 1.5, // nylon pluck decays naturally, avoid the harsh-cutoff class of bug
}

// Per-instrument gain trim, in dB, applied at the Sampler itself — measured RMS across
// the shipped instruments varied by ~22dB (electric-guitar loudest, holdsworthian-pad
// quietest), a jarring jump switching between them mid-session. Targets piano's level
// (~-24dBFS), the most recently and deliberately tuned reference. Code-level trim rather
// than re-exporting every instrument's samples — one place to retune, fully reversible.
// guitar-acoustic needs no entry — its current (nylon) samples were already gain-matched
// to the same target when converted, same as piano.
const INSTRUMENT_VOLUME: Partial<Record<InstrumentType, number>> = {
  piano: 3, // Paul heard it as a little quieter than guitar-acoustic despite matching RMS
    // targets — try a modest boost first
  'electric-guitar': -6, // was -10 — Paul heard it as a little quieter than the rest after that cut
  'holdsworthian-pad': 12,
}

function noteRelease(instrumentType: InstrumentType): number {
  return RELEASE_TIMES[instrumentType] ?? 0.1
}

// Per-instrument reverb send — a touch of space is often what actually separates "quiet
// piano" from "ambient" the way a lowpass filter or a longer release alone don't. Kept
// deliberately modest (short decay, mostly dry) so it reads as room tone, not a wash —
// instruments with no entry get no reverb node at all, zero added latency or cost.
const REVERB_SETTINGS: Partial<Record<InstrumentType, { decay: number; wet: number }>> = {
  piano: { decay: 2.2, wet: 0.22 },
  'guitar-acoustic': { decay: 2.0, wet: 0.2 },
}

// Chorus (a subtle detune wobble) and ping-pong delay (stereo, alternating left/right
// echoes) — chorus is genuinely new, no instrument used it before guitar-acoustic. Kept
// more restrained than a typical "ambient guitar" preset (a suggested starting point had
// chorus depth 0.7/wet 0.35, delay feedback 0.4/wet 0.3) since Eddy's whole design leans
// toward restraint. Chorus is LFO-driven, so it needs .start() — silent without it.
// Order: chorus, then delay, then reverb, then destination.
const CHORUS_SETTINGS: Partial<Record<InstrumentType, { frequency: number; delayTime: number; depth: number; wet: number }>> = {
  'guitar-acoustic': { frequency: 1.2, delayTime: 3.5, depth: 0.5, wet: 0.25 },
}
const DELAY_SETTINGS: Partial<Record<InstrumentType, { delayTime: string; feedback: number; wet: number }>> = {
  // guitar-acoustic had { delayTime: '8n.', feedback: 0.3, wet: 0.2 } — removed per
  // Paul's request to hear it without the ping-pong delay first. Easy to bring back (at
  // this same value, or lower) if it turns out to be missed.
}

function noteDuration(): string {
  const type = currentInstrumentType ?? 'piano'
  return NOTE_DURATIONS[type] ?? '2n'
}

type ToneInstrument = Tone.Sampler

let instrument: ToneInstrument | null = null
let outputReverb: Tone.Reverb | null = null
let outputChorus: Tone.Chorus | null = null
let outputDelay: Tone.PingPongDelay | null = null
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

  // Dispose previous instrument and any effects chain it had
  if (instrument) {
    instrument.dispose()
    instrument = null
    isLoaded.value = false
  }
  if (outputReverb) {
    outputReverb.dispose()
    outputReverb = null
  }
  if (outputChorus) {
    outputChorus.dispose()
    outputChorus = null
  }
  if (outputDelay) {
    outputDelay.dispose()
    outputDelay = null
  }

  await Tone.start()
  currentInstrumentType = instrumentType

  const SAMPLER_CONFIGS: Record<InstrumentType, { urls: Record<string, string>; baseUrl: string }> = {
    piano:            { urls: PIANO_URLS,           baseUrl: PIANO_BASE },
    'guitar-acoustic':{ urls: GUITAR_ACOUSTIC_URLS, baseUrl: '/samples/guitar-acoustic/' },
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
    const reverbSettings = REVERB_SETTINGS[instrumentType]
    const chorusSettings = CHORUS_SETTINGS[instrumentType]
    const delaySettings = DELAY_SETTINGS[instrumentType]

    // Built furthest-downstream-first (reverb, then delay, then chorus), each stage
    // connecting to whatever's already been built or straight to destination if it's
    // the last stage — then the sampler connects to whichever stage ends up first in
    // the chain. Any subset of the three can be configured per instrument; an
    // instrument with none of them behaves exactly as before (sampler.toDestination()).
    if (reverbSettings) {
      // Reverb's impulse response is generated asynchronously (it's rendered via
      // Tone.Offline internally) — has to be awaited before anything connects to it,
      // otherwise the first several notes would play with no reverb at all.
      const reverb = new Tone.Reverb(reverbSettings.decay).toDestination()
      reverb.wet.value = reverbSettings.wet
      await reverb.ready
      outputReverb = reverb
    }
    if (delaySettings) {
      const delay = new Tone.PingPongDelay(delaySettings.delayTime, delaySettings.feedback)
      delay.wet.value = delaySettings.wet
      if (outputReverb) delay.connect(outputReverb)
      else delay.toDestination()
      outputDelay = delay
    }
    if (chorusSettings) {
      // Chorus is LFO-driven — silent until started.
      const chorus = new Tone.Chorus(
        chorusSettings.frequency,
        chorusSettings.delayTime,
        chorusSettings.depth
      ).start()
      chorus.wet.value = chorusSettings.wet
      if (outputDelay) chorus.connect(outputDelay)
      else if (outputReverb) chorus.connect(outputReverb)
      else chorus.toDestination()
      outputChorus = chorus
    }
    const firstEffectStage = outputChorus ?? outputDelay ?? outputReverb

    return await new Promise((resolve) => {
      const sampler = new Tone.Sampler({
        urls: buffers,
        release: noteRelease(instrumentType),
        volume: INSTRUMENT_VOLUME[instrumentType] ?? 0,
        onload: () => {
          isLoaded.value = true
          loadError.value = null
          resolve()
        },
      })
      if (firstEffectStage) {
        sampler.connect(firstEffectStage)
      } else {
        sampler.toDestination()
      }
      instrument = sampler
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

  // Belt-and-suspenders alongside the 'resume' listener above: if the context is still
  // suspended for any reason (the listener hasn't fired yet, or this platform doesn't
  // emit it), retry once the resume completes rather than silently scheduling into a
  // dead context.
  if (Tone.getContext().state !== 'running') {
    Tone.start().then(() => playCluster(cluster, settings, onComplete))
    return
  }

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

  // See playCluster() above — same resume-and-retry guard against a suspended context.
  // Deliberately ahead of the debounce check below: it stamps lastPlaySequenceTime, which
  // would otherwise make the retried call swallow itself as a false "too-soon" repeat.
  if (Tone.getContext().state !== 'running') {
    Tone.start().then(() => playSequence(sequence, settings, loop))
    return
  }

  const now = Date.now()
  if (now - lastPlaySequenceTime < 100) return
  lastPlaySequenceTime = now

  stopLoop()

  const isChord = settings.direction === 'chord'
  const interval = isChord ? 0 : intervalFromBpm(settings.bpm, settings.subdivision)
  const beat = 60 / settings.bpm

  // Bar-quantized, matching exportSequenceAsMidi()'s barsNeeded math exactly — a cluster
  // always changes on a downbeat, whether you're listening live or in an exported MIDI
  // file. Previously this used a totally different formula (voice count * interval + a
  // fixed gap, no bar rounding at all), so live playback and the exported file disagreed
  // on when a chord changed for every direction except 'chord' (which already happened
  // to occupy exactly one bar either way).
  const maxVoices = Math.max(...sequence.map(c => c.length))
  const subdivisionsPerBar = BEATS_PER_BAR * (settings.subdivision ?? 4)
  const barsNeeded = isChord ? 1 : Math.max(1, Math.ceil(maxVoices / subdivisionsPerBar))
  const clusterDuration = barsNeeded * BEATS_PER_BAR * beat

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
    // Self-healing: the resume-and-retry guard at the top of this function only catches
    // a suspended context at the moment playback *starts* — it can't catch one that dies
    // mid-loop (screen lock, a call, or anything else) while this rAF loop is already
    // running. Checking every frame is cheap (a property read) and turns "silently dead
    // until the app is restarted" into "recovers within about a second on its own."
    // Restarts from the top of the sequence rather than attempting to resume the exact
    // position — a small jump is a better tradeoff than staying broken.
    if (Tone.getContext().state !== 'running') {
      rafId = null
      Tone.start().then(() => {
        if (isPlaying.value) playSequence(sequence, settings, loop)
      })
      return
    }
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
  if (outputReverb) {
    outputReverb.dispose()
    outputReverb = null
  }
  if (outputChorus) {
    outputChorus.dispose()
    outputChorus = null
  }
  if (outputDelay) {
    outputDelay.dispose()
    outputDelay = null
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
