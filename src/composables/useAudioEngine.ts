import { ref, readonly } from 'vue'
import * as Tone from 'tone'
import { App } from '@capacitor/app'
import type { Cluster } from '../utils/noteUtils'
import { midiToName, MIDI_MIN, MIDI_MAX } from '../data/notes'
import type { InstrumentType, Subdivision } from '../stores/settingsStore'
import {
  intervalFromBpm,
  buildArpeggioNotes,
  buildClusterEvents,
  velocitiesForEvents,
  humanizeVelocity,
} from '../utils/arpeggioEngine'
import { logDiag } from '../utils/diagLog'

// Confirmed from a real on-device diagnostic log (Paul, 2026-10-05): after repeated
// background/foreground cycling, Tone.start() (really AudioContext.resume()) can simply
// never settle at all — neither resolving nor rejecting. Every recovery path below is
// gated on that promise settling, so a hang silently defeats all of them; the explicit-
// rejection retry added for the first fix (InvalidStateError while still backgrounded)
// never even triggers if the promise just hangs instead of rejecting. Racing against a
// timeout turns "hangs forever" into "treated as a failure, retried like any other."
function startToneWithTimeout(timeoutMs = 2000): Promise<void> {
  return Promise.race([
    Tone.start(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Tone.start() timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ])
}

// Wraps a recovery-triggered replay (playCluster/playSequence recursing into itself, or
// tick() restarting the sequence) in error handling. Confirmed on-device (Paul, 2026-10-07
// diagnostic log): rebuilding playback scheduling right as a context comes out of an
// interruption can throw — seen once as a RangeError on a near-zero floating-point time
// value, likely a WebAudio scheduling call fed an offset that drifted slightly negative
// across the interruption. Without this, that exception surfaces only as an unhandled
// rejection (main.ts's global handler logs it but can't undo anything) and leaves the
// engine mid-rebuild — exactly matching a field report of the recovery toast clearing
// with playback still dead. Catching it here and tearing down via stopLoop() turns a
// silent, corrupted half-state into an honest, visible "failed" status instead.
function safeRecoveryReplay(label: string, fn: () => void): void {
  try {
    fn()
  } catch (err) {
    logDiag(`${label}.recoveryThrew`, { err: String(err) })
    recoveryStatus.value = 'failed'
    try {
      stopLoop()
    } catch (cleanupErr) {
      logDiag(`${label}.recoveryCleanupThrew`, { err: String(cleanupErr) })
    }
  }
}

// Disposes a Tone object defensively — never lets a disposal failure propagate. Confirmed
// on-device (Paul, 2026-10-07): an uncaught throw from disposing a stale Tone.Part against
// an already-closed context (see rebuildAudioContext() below) left the dangling reference
// never nulled out, which bricked every subsequent stopLoop() call — and therefore nearly
// every user action — for the rest of the session. Callers still null their own reference
// afterward; this only guards the dispose() call itself from taking the whole app down.
function disposeQuietly(label: string, node: { dispose: () => unknown } | null): void {
  if (!node) return
  try {
    node.dispose()
  } catch (err) {
    logDiag(`dispose.${label}.threw`, { err: String(err) })
  }
}

// Discards the current AudioContext entirely and builds a fresh one, rather than trying
// to resume the stuck one. Confirmed on-device (Paul, 2026-10-07): even a fully clean,
// exception-free resume-and-reschedule (tick()'s own forced rebuild, see
// playbackGeneration above) doesn't reliably bring real audio back — the context can
// report 'running' while the underlying hardware route stays dead, a documented WebKit
// behavior with no fix short of discarding the context. `Tone.setContext(..., true)`
// disposes and closes the old native context as part of the swap (confirmed in Tone's own
// source — Context.dispose() calls close() on the underlying AudioContext), so this
// doesn't leak a context per failed attempt even under tick()'s ~500ms retry cadence.
// Reuses cachedBuffers (see its declaration above) so only the node graph is rebuilt, not
// the network fetch — and reapplies currentAmbienceLevel, since a fresh effects chain
// always constructs at ceiling (see buildEffectsChain's ambienceLevel=1 default, same as
// init()) and nothing else here knows what the user's ambience dial is actually set to.
async function rebuildAudioContext(): Promise<void> {
  if (!currentInstrumentType || !cachedBuffers) {
    throw new Error('rebuildAudioContext: no instrument loaded to rebuild')
  }
  const instrumentType = currentInstrumentType
  const buffers = cachedBuffers

  // loopPart must be torn down HERE, before the context swap — not left for the next
  // stopLoop() call to find. Confirmed on-device (Paul, 2026-10-07): disposing a Tone.Part
  // against an already-closed context throws ("undefined is not an object (evaluating
  // 'r.time')", Tone.Part's internals reading a disposed Timeline). Worse, since the throw
  // happened before loopPart was nulled out, the dangling reference survived — every
  // subsequent stopLoop() call from anywhere in the app (confirming a stream, navigating,
  // starting fresh) hit the exact same throw forever, bricking the whole session until
  // restart. Wrapped defensively regardless, same reasoning as every dispose below: a
  // cleanup failure must never be allowed to leave a reference permanently stuck.
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  if (loopPart) {
    try {
      loopPart.stop()
    } catch (err) {
      logDiag('dispose.loopPart.stopThrew', { err: String(err) })
    }
    disposeQuietly('loopPart', loopPart)
    loopPart = null
  }

  disposeQuietly('instrument', instrument)
  instrument = null
  isLoaded.value = false
  disposeQuietly('outputReverb', outputReverb)
  outputReverb = null
  disposeQuietly('outputChorus', outputChorus)
  outputChorus = null
  disposeQuietly('outputDelay', outputDelay)
  outputDelay = null
  disposeQuietly('outputTapeDelay', outputTapeDelay)
  outputTapeDelay = null
  disposeQuietly('outputFilter', outputFilter)
  outputFilter = null
  disposeQuietly('outputAutoFilter', outputAutoFilter)
  outputAutoFilter = null

  Tone.setContext(new AudioContext(), true)
  await startToneWithTimeout()

  const chain = await buildEffectsChain(instrumentType, 1)
  outputReverb = chain.reverb
  outputChorus = chain.chorus
  outputDelay = chain.delay
  outputTapeDelay = chain.tapeDelay
  outputFilter = chain.filter
  outputAutoFilter = chain.autoFilter

  const sampler = await createSampler(buffers, instrumentType)
  if (chain.firstStage) {
    sampler.connect(chain.firstStage)
  } else {
    sampler.toDestination()
  }
  instrument = sampler
  isLoaded.value = true
  setAmbience(currentAmbienceLevel)
}

// Single-flight guard around rebuildAudioContext() — it mutates shared module state
// (instrument, the effects nodes) with no protection against two overlapping calls
// stepping on each other mid-construction. Now that the app-resume handler below also
// rebuilds unconditionally on every wake (not just tick()'s own reactive path), both can
// genuinely fire within the same moment on a real wake. Every caller goes through this
// instead of calling rebuildAudioContext() directly — if one's already in flight, the
// rest just await that same attempt rather than starting a second, colliding one.
let rebuildPromise: Promise<void> | null = null
function ensureFreshAudioContext(): Promise<void> {
  if (!rebuildPromise) {
    rebuildPromise = rebuildAudioContext().finally(() => {
      rebuildPromise = null
    })
  }
  return rebuildPromise
}

// iOS suspends the WebAudio context whenever the app is backgrounded or the screen
// locks (a real interruption, not just a pause), and nothing resumes it automatically —
// every scheduled note would then silently do nothing until the app was force-restarted.
// Registered once at module load (this file is a documented singleton), rather than once
// per useAudioEngine() call, which would otherwise stack up duplicate listeners.
//
// Unconditional rebuild — not gated on checking .state first. Confirmed on-device (Paul,
// 2026-10-07): AudioContext.state can report 'running' while the context is completely
// dead underneath — a bare Tone.start() on an already-'running'-reporting context hung for
// a full 2s and timed out, three minutes after an entirely unremarkable pause/resume pair
// (both logged 'running', nothing flagged as wrong). Every reactive, detection-gated
// recovery path in this file depends on that same .state read being trustworthy, which
// this disproves — so the only reliable fix is to stop checking and just always rebuild on
// every real wake. ensureFreshAudioContext() dedupes against tick()'s own reactive rebuild
// if both happen to fire around the same moment — but a shared rebuild still resolves both
// callers' .then() callbacks independently, so without the generation check below, both
// this handler and tick() could each replay the sequence off the same successful rebuild,
// a double-trigger. Capturing playbackGeneration before the rebuild starts and comparing
// after catches it: whichever of the two replays first bumps the generation (every
// playSequence() call does, via stopLoop()), and the other then sees a mismatch and skips
// its own redundant replay — symmetric with tick()'s own existing generation guard.
App.addListener('resume', () => {
  logDiag('app.resume', { contextState: Tone.getContext().state })
  if (!currentInstrumentType || !cachedBuffers) return // nothing loaded yet this session
  const generationAtResumeTime = playbackGeneration
  recoveryStatus.value = 'recovering'
  ensureFreshAudioContext().then(
    () => {
      logDiag('app.resume.rebuild.ok')
      recoveryStatus.value = 'idle'
      if (
        isPlaying.value &&
        currentPlaybackParams &&
        playbackGeneration === generationAtResumeTime
      ) {
        const { sequence, settings, loop } = currentPlaybackParams
        safeRecoveryReplay('app.resume', () => playSequence(sequence, settings, loop))
      }
    },
    (err) => {
      logDiag('app.resume.rebuild.fail', { err: String(err) })
      recoveryStatus.value = 'failed'
    }
  )
})
App.addListener('pause', () => {
  logDiag('app.pause', { contextState: Tone.getContext().state, isPlaying: isPlaying.value })
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
  C1: 'C1.mp3',
  G1: 'G1.mp3',
  D2: 'D2.mp3',
  A2: 'A2.mp3',
  E3: 'E3.mp3',
  B3: 'B3.mp3',
  'F#4': 'Fs4.mp3',
  'C#5': 'Cs5.mp3',
  'D#6': 'Ds6.mp3',
  'A#6': 'As6.mp3',
}

// Acoustic guitar — notes rendered from Orange Tree Samples' Evolution Songwriter library, used
// with Orange Tree's written permission (support email, 2026-10-22: 16 rendered notes inside
// the app, credit requested; revisit if Eddy ever becomes a paid app). Replaced "Yindad
// Acoustic" (Paul's own recording, 11 major-third roots) outright after a direct A/B; before
// that "Soft Nylon Guitar Lite" (Pianobook) and the original steel-string samples. Same
// key/folder-independent slot ('guitar-acoustic') for saved-session backward compatibility.
// 16 roots, every minor third E2-C6, ~1.5 MB. Pitch verified on the first 0.6s of each note
// (where a pluck lives — HPS on later windows reads decayed noise): all within 3 cents,
// fundamental strongest, nothing below. Each file starts at the pluck, is cut at 6s (the
// renders end there) with a 0.4s fade, and is leveled on its first second's PERCEIVED loudness
// (A-weighted RMS) against the old guitar's smoothed contour at the same pitch
// (scripts/samples/guitar-pluck.py) — plain RMS had left the four lowest roots 6-9 dB too soft
// (their energy is mostly deep fundamentals). 128 kbps MP3, fully dry.
// THE FILES LIVE IN public/samples/guitar-acoustic-ots/, WHICH IS GIT-EXCLUDED
// (.git/info/exclude): Orange Tree's permission covers use inside the app, not offering the
// files standalone, and the GitHub repo is public. Back that folder up outside git; the WAV
// renders live in ~/Samples/acoustic_guitar.
const GUITAR_ACOUSTIC_URLS: Record<string, string> = {
  E2: 'E2.mp3',
  G2: 'G2.mp3',
  'A#2': 'As2.mp3',
  'C#3': 'Cs3.mp3',
  E3: 'E3.mp3',
  G3: 'G3.mp3',
  'A#3': 'As3.mp3',
  'C#4': 'Cs4.mp3',
  E4: 'E4.mp3',
  G4: 'G4.mp3',
  'A#4': 'As4.mp3',
  'C#5': 'Cs5.mp3',
  E5: 'E5.mp3',
  G5: 'G5.mp3',
  'A#5': 'As5.mp3',
  C6: 'C6.mp3',
}

// Second piano voice — VSCO2 Community Edition's upright piano (Versilian Studios,
// sampled by Simon Dalzell/Ivy Audio), from Alex Bainter's generative-music course
// material. Redistribution explicitly permitted per the pack's own Info.txt ("Bearer is
// granted right to redistribute... Credit to both original author and Versilian Studios
// is encouraged"). Every fourth semitone (A/C#/F pattern), 11 usable roots F2-A5 within
// Eddy's range — denser coverage than any other instrument. Unlike every other pack
// evaluated in this project, filenames measured at true pitch — no octave correction
// needed (confirmed via FFT across multiple time offsets; the only noisy readings were
// low notes' well-known "missing fundamental" effect landing exactly on a harmonic of
// the expected pitch, and fast-decaying high notes with little tonal content left by the
// time a 1s+ analysis window started — neither is a labeling issue).
//
// 2026-09-30: replaced Salamander Grand Piano V2 in this InstrumentType slot ('piano-
// salamander' key, "piano" label, same public/samples/piano-original/ folder path — kept
// unchanged for saved-session backward compatibility, same reasoning as every other
// content swap in this project) after Paul compared it directly against Salamander and
// preferred it. The UPRIGHT_PIANO_URLS name no longer matches the key/folder's literal
// "salamander"/"piano-original" naming — that's expected, same drift as holdsworthian-pad
// no longer being Holdsworth-anything.
const UPRIGHT_PIANO_URLS: Record<string, string> = {
  F2: 'F2.mp3',
  A2: 'A2.mp3',
  'C#3': 'Cs3.mp3',
  F3: 'F3.mp3',
  A3: 'A3.mp3',
  'C#4': 'Cs4.mp3',
  F4: 'F4.mp3',
  A4: 'A4.mp3',
  'C#5': 'Cs5.mp3',
  F5: 'F5.mp3',
  A5: 'A5.mp3',
}

// 'synth-strings' — Paul's own synthesized pad: a Logic patch rendered note by note (no
// third-party samples). 16 roots, every minor third E2-C6, ~2 MB. Processed by
// scripts/samples/synth-pad.py: trimmed to 8s (the held part is ~1-6s, then a ~5s release tail
// Eddy never plays in full — Tone's own release takes over at note-off), leveled to the loudness
// reference every pad was matched to (the removed choir pad's steady-state RMS), 128 kbps
// true-stereo MP3 (mostly centered, L/R correlation ~0.8). Sounds at its named pitch (fundamental
// strongest, tuned within ~2 cents). Warm: its brightness closes slowly over the note (mid root
// ~600 Hz -> ~300 Hz centroid). The four lowest roots (E2, G2, A#2, C#3) have the same note one
// and two octaves up mixed in at -6/-8 dB (--low-assist): the plain patch is nearly pure low
// hum at E2 (98.8% of its energy under 250 Hz, which a phone speaker can't reproduce); this
// gives E2 the same spectral balance the patch has at E3 (about 78% / 22% in 250 Hz-1 kHz).
const SYNTH_STRINGS_URLS: Record<string, string> = {
  E2: 'E2.mp3',
  G2: 'G2.mp3',
  'A#2': 'As2.mp3',
  'C#3': 'Cs3.mp3',
  E3: 'E3.mp3',
  G3: 'G3.mp3',
  'A#3': 'As3.mp3',
  'C#4': 'Cs4.mp3',
  E4: 'E4.mp3',
  G4: 'G4.mp3',
  'A#4': 'As4.mp3',
  'C#5': 'Cs5.mp3',
  E5: 'E5.mp3',
  G5: 'G5.mp3',
  'A#5': 'As5.mp3',
  C6: 'C6.mp3',
}

// Temp A/B candidate, added 2026-10-09 — "Moog Minitaur - Simple Saw" by modularsamples
// (freesound.org, Creative Commons 0), a single-oscillator analog saw patch, UI-labeled
// "analog synth." Paul's intent: ambient arpeggios, not a chord-only pad — deliberately
// NOT added to PAD_INSTRUMENTS below, so every arpeggio direction stays available rather
// than being forced into 'chord' the way the real pads are. Fully chromatic across Eddy's
// whole range, and the filenames state the real MIDI note explicitly (not something
// inferred — this was recorded by sending that literal MIDI note to the hardware, about
// as reliable as sample provenance gets). **Caveat found 2026-10-24:** the pack's files above
// C5 are NOT what their names say — C#5 through C6 are all C5 (~523 Hz; measured by
// autocorrelation, every one of the twelve), so D5 played C5, F5 played C5, and so on (the
// Minitaur evidently can't play higher than that, and the pack kept recording). Those twelve
// files are removed; Tone.Sampler now repitches the real C5 up to the missing notes (a shorter,
// brighter note the higher it goes — C6 is a full octave of shift). The earlier spot-check had
// written two of these off as autocorrelation ambiguity; they were the tip of the problem. E2–C5
// verified clean (all within 5 cents). If a better set for the top octave turns up, add its files
// back here. Gain-matched by measured RMS against retro-pad's C4 (ran ~4dB hot). Trimmed to
// the pack's own natural length (~1.9s + 0.3s fade) — these are short analog synth notes,
// not sustained pad swells. Gated behind SHOW_ANALOG_SYNTH_TEMP in HomeView.vue/
// SessionView.vue.
const ANALOG_SYNTH_URLS: Record<string, string> = {
  E2: 'E2.mp3',
  F2: 'F2.mp3',
  'F#2': 'Fs2.mp3',
  G2: 'G2.mp3',
  'G#2': 'Gs2.mp3',
  A2: 'A2.mp3',
  'A#2': 'As2.mp3',
  B2: 'B2.mp3',
  C3: 'C3.mp3',
  'C#3': 'Cs3.mp3',
  D3: 'D3.mp3',
  'D#3': 'Ds3.mp3',
  E3: 'E3.mp3',
  F3: 'F3.mp3',
  'F#3': 'Fs3.mp3',
  G3: 'G3.mp3',
  'G#3': 'Gs3.mp3',
  A3: 'A3.mp3',
  'A#3': 'As3.mp3',
  B3: 'B3.mp3',
  C4: 'C4.mp3',
  'C#4': 'Cs4.mp3',
  D4: 'D4.mp3',
  'D#4': 'Ds4.mp3',
  E4: 'E4.mp3',
  F4: 'F4.mp3',
  'F#4': 'Fs4.mp3',
  G4: 'G4.mp3',
  'G#4': 'Gs4.mp3',
  A4: 'A4.mp3',
  'A#4': 'As4.mp3',
  B4: 'B4.mp3',
  C5: 'C5.mp3',
}

// Hoisted out of init() (was rebuilt as a local const on every call) — also needed by
// renderSequenceToBuffer() below for audio export, which loads its own sample buffers
// independent of whatever's currently live-loaded.
const SAMPLER_CONFIGS: Partial<
  Record<InstrumentType, { urls: Record<string, string>; baseUrl: string }>
> = {
  piano: { urls: PIANO_URLS, baseUrl: PIANO_BASE },
  'guitar-acoustic': {
    urls: GUITAR_ACOUSTIC_URLS,
    baseUrl: '/samples/guitar-acoustic-ots/',
  },
  'piano-salamander': {
    urls: UPRIGHT_PIANO_URLS,
    baseUrl: '/samples/piano-original/',
  },
  'synth-strings': {
    urls: SYNTH_STRINGS_URLS,
    baseUrl: '/samples/synth-strings/',
  },
  'analog-synth-temp': {
    urls: ANALOG_SYNTH_URLS,
    baseUrl: '/samples/analog-synth-temp/',
  },
}

// Note-picker range per instrument — picker-only, matches each instrument's natural/sampled
// register. Does NOT affect the voice-leading engine, which always uses the global MIDI_MIN/
// MIDI_MAX regardless of instrument, so switching instruments mid-flow never changes which
// moves are reachable — only what you can type in as a starting cluster.
export const INSTRUMENT_NOTE_RANGE: Record<
  InstrumentType,
  { min: number; max: number }
> = {
  piano: { min: 33, max: MIDI_MAX }, // A1–C6
  'guitar-acoustic': { min: 40, max: MIDI_MAX }, // E2-C6 — 16 roots every minor third
  'piano-salamander': { min: 41, max: 81 }, // F2-A5, matches UPRIGHT_PIANO_URLS'
  // 11 usable roots
  'synth-strings': { min: MIDI_MIN, max: MIDI_MAX }, // E2-C6, a root every minor third
  'analog-synth-temp': { min: MIDI_MIN, max: MIDI_MAX }, // E2-C6 — E2–C5 are real recorded
  // roots; C#5–C6 are repitched from C5 (the pack's own files up there were all C5)
}

export type ArpeggioDirection = 'up' | 'down' | 'updown' | 'random' | 'chord'

export interface PlaybackSettings {
  bpm: number
  direction: ArpeggioDirection
  subdivision?: Subdivision // notes per beat; defaults to 16th notes
  latch?: boolean // repeat the arpeggio to fill the whole bar instead of playing once
  // and resting. No effect on 'chord' direction — see buildClusterEvents() in
  // utils/arpeggioEngine.ts.
  beatsPerBar?: number // time signature's numerator (4 for 4/4, 3 for 3/4) — defaults
  // to 4 if omitted. Matches midiUtils.ts's own beatsPerBar option, which shares this
  // same default, so the two never disagree about what "a bar" means.
  // Per-cluster overrides (pool playback settings, added 2026-10-10) — same length as
  // the `sequence` array passed to playSequence(); a defined entry at index i overrides
  // direction/latch for cluster i specifically. These only ever affect that cluster's
  // arpeggiation *pattern* (which notes play when, within its bar) — bar length itself
  // (clusterDuration, computed from `direction`/`subdivision` above) stays one uniform
  // value for the whole sequence regardless, same reasoning subdivision/time-signature
  // staying global already rests on: only pattern varies per pool, never bar length.
  // Omitted entirely by every caller except SessionView.vue's pool-aware playback path —
  // export, cluster preview, etc. all keep working exactly as before.
  directionOverrides?: (ArpeggioDirection | undefined)[]
  latchOverrides?: (boolean | undefined)[]
  // The flow's accent-pattern pick (sequenceStore.velocitySeed) — see velocitiesForEvents()
  // in utils/arpeggioEngine.ts. Omitted = pattern 0, still deterministic.
  velocitySeed?: number
  // Single-chord playback only (playCluster): the chord just before this one, so an
  // auditioned stream gets the same moving-voice accent it will have in the flow.
  // playSequence/render derive it from the sequence order instead.
  previousCluster?: number[]
}

// Fixed note durations for plucky/percussive instruments
const NOTE_DURATIONS: Partial<Record<InstrumentType, string>> = {
  piano: '2n',
  'guitar-acoustic': '2n',
  'piano-salamander': '2n', // same character class as felt piano
  'synth-strings': '1n', // sustained pad character
  'analog-synth-temp': '2n', // short, decaying analog synth note — not a pad swell
}

// Tone.Sampler's release (the fade-out after triggerRelease) defaults to 0.1s — fine for
// a struck/plucked note, but a hard, audible cutoff for anything sustained. The pad-style
// instruments above get a real fade instead.
const RELEASE_TIMES: Partial<Record<InstrumentType, number>> = {
  piano: 2.0, // felt piano rings naturally — default 0.1s cutoff read as harsh
  'guitar-acoustic': 1.5, // pluck decays naturally, avoid the harsh-cutoff class of bug —
  // carried over unchanged from the nylon pack this replaced; not yet retuned by ear
  // against the Orange Tree content (it was carried over from the Yindad Acoustic before it)
  'piano-salamander': 2.0, // same treatment as felt piano — avoids the harsh default
  // 0.1s cutoff
  'synth-strings': 2.0, // the pad's own release is long (~5s) but Tone's release takes over at note-off; 2s lets chord changes blend
  'analog-synth-temp': 0.8, // short release matching the pack's own natural ~1.9s decay —
  // long enough to avoid a harsh cutoff, short enough not to blur arpeggiated runs
}

// Per-instrument gain trim, in dB, applied at the Sampler itself — measured RMS across
// the shipped instruments varied by ~22dB (electric-guitar loudest, holdsworthian-pad
// quietest), a jarring jump switching between them mid-session. Targets piano's level
// (~-24dBFS), the most recently and deliberately tuned reference. Code-level trim rather
// than re-exporting every instrument's samples — one place to retune, fully reversible.
const INSTRUMENT_VOLUME: Partial<Record<InstrumentType, number>> = {
  piano: 3, // tried 3 -> 6 -> back to 3 (Paul, 2026-10-08) — preferred the original after
  // hearing both louder. Originally boosted because it read as a little quieter than
  // guitar-acoustic despite matching RMS targets
  // Tuned by ear against the sample content now in this slot (VSCO2 upright piano,
  // 2026-09-30): 0 -> +6 -> +10. No effects are on this instrument (no REVERB_SETTINGS/
  // CHORUS_SETTINGS/DELAY_SETTINGS/FILTER_SETTINGS entry exists for it — confirmed by
  // grep, not assumed), so the trim itself is the only lever.
  'piano-salamander': 10, // tried 10 -> 13 -> 11 -> back to 10 (Paul, 2026-10-08) —
  // preferred the original after hearing both louder
  'guitar-acoustic': -5, // Paul heard it as loud/jarring (2026-10-07) — cut back from the
  // +9dB baked into the exported files during the Yindad Acoustic swap, which was
  // deliberately matched to the outgoing nylon pack's loudness for a fair A/B, not tuned
  // for how it should actually sit once it won. Provisional, same as every other
  // instrument's first by-ear pass — expect this to move again.
  // synth-strings needs no entry — its level was matched by scripts/samples/synth-pad.py when
  // the files were built, same convention as every other instrument's initial content swap.
  // analog-synth-temp needs no entry either — its -4dB gain-match (measured RMS against
  // retro-pad's C4) was baked into the exported files the same way.
  //
  // 2026-10-21/22: a +6 dB pass on piano-salamander, guitar-acoustic, electric-guitar and
  // analog-synth-temp (chosen by ear in the iOS *simulator*, to offset the velocity patterns'
  // ~1.5 dB lower average) shipped in TestFlight 1.0(129) and was far too loud on Paul's
  // actual device — reverted for 1.0(130). Simulator audio is not a reliable judge of
  // absolute level; re-judge any future level change on the phone, with headphones.
}

function noteRelease(instrumentType: InstrumentType): number {
  return RELEASE_TIMES[instrumentType] ?? 0.1
}

// Per-instrument reverb send — a touch of space is often what actually separates "quiet
// piano" from "ambient" the way a lowpass filter or a longer release alone don't. `wet`
// here is the Ambience dial's *ceiling* ("what 100% sounds like" — see setAmbience()
// below), not a fixed value applied outright, so it needs real headroom above what
// sounded good as a static, always-on setting — a dial that only ever swings between
// "mostly dry" and "a little less mostly dry" doesn't give Paul the "exposes every
// choice" <-> "masks harshness" range the feature is actually for. Set to roughly double
// the original always-on values (piano was 0.22, guitar-acoustic 0.2), paired with the
// settingsStore ambience default of 0.5 (see settingsStore.ts) so the *default* dial
// position still reproduces those exact original, already-approved values — 0.5 ceiling
// = original. Below 50% goes drier than ever shipped before; above 50% is new territory.
// decay is untouched (still 2.2/2.0) since decay isn't dial-scaled — see DOWNRIVER.md's
// Ambience writeup on why decay is out of scope for a live control.
// Every instrument now has an entry — an instrument with none would have nothing for the
// dial to scale, so it'd silently do nothing when dialed up. The entries added here
// (electric-guitar/holdsworthian-pad) were provisional ceilings; both instruments are gone now.
const REVERB_SETTINGS: Partial<
  Record<InstrumentType, { decay: number; wet: number }>
> = {
  // piano's (felt piano) entry removed 2026-10-08 (Paul) to hear it fully dry in the
  // simulator, same reasoning as guitar-acoustic below — { decay: 2.2, wet: 0.44 } was
  // its only effect (no chorus/delay/filter entries existed for it either).
  //
  // guitar-acoustic's entry removed 2026-10-08 (Paul) to hear the new Yindad Acoustic
  // content fully dry in the simulator before deciding whether/how to re-add reverb —
  // the prior { decay: 2.0, wet: 0.4 } was carried over unchanged from the old nylon
  // pack and never actually tuned against this content.
  //
  // electric-guitar's entry ({ decay: 2.6, wet: 0.5 }) went with the instrument, removed 2026-10-23
  // (Pianobook terms) — no instrument uses reverb now; the mechanism stays as ready infrastructure.
}

// Gentle lowpass filter — unlike reverb/chorus (which add space), this directly targets
// "too bright/harsh" by rolling off high-frequency content at the source, before it ever
// reaches the reverb send (so the tail is warmed too, not just the dry signal). Built for
// a lowpass+reverb treatment of the original nbrosowsky guitar (Paul: liked the tone, too
// harsh) — that experiment was tried and shelved 2026-09-30 (kept the current Nylon
// guitar instead), but the mechanism itself is generic/reusable, same as DELAY_SETTINGS
// below being kept empty rather than removed after its own guitar experiment ended. Not
// dial-scaled like ambience — decay/filtering are both the "harder problem" DOWNRIVER.md's
// Ambience writeup flagged as out of scope for a live control.
const FILTER_SETTINGS: Partial<
  Record<InstrumentType, { frequency: number; rolloff: Tone.FilterRollOff }>
> = {}

// Filter sweep — a slow, free-running LFO wobbling the cutoff up and down, for a
// subtly-evolving texture rather than a fixed tone color (Paul's side-question from the
// tape delay session: "some type of filter sweep effect where the sound subtly changes
// over time"). Unlike FILTER_SETTINGS above (a fixed, static cutoff), this is Tone's own
// built-in AutoFilter — a real out-of-the-box fit, unlike the tape delay above which
// needed hand-wired primitives. Deliberately NOT synced to tempo/grid (no
// delayTimeForSubdivision-style live update) — the point is a slow ambient drift
// independent of whatever rhythm is playing, not a rhythmic wah locked to the beat.
const AUTO_FILTER_SETTINGS: Partial<
  Record<
    InstrumentType,
    { frequency: number; baseFrequency: number; octaves: number; wet: number }
  >
> = {
  'analog-synth-temp': { frequency: 0.12, baseFrequency: 700, octaves: 2.2, wet: 0.6 },
  // (Tried on Yindad Acoustic 2026-10-15; removed 2026-10-21 at Paul's call — only the
  // analog synth keeps the sweep.)
}

// Chorus (a subtle detune wobble) and ping-pong delay (stereo, alternating left/right
// echoes) — chorus is genuinely new, no instrument used it before guitar-acoustic. Chorus
// wet is likewise now the Ambience dial's ceiling (doubled from the original 0.25, same
// reasoning and same 0.5-default-equals-original math as REVERB_SETTINGS above) — depth/
// frequency are unaffected by the dial, only wet scales. Chorus is LFO-driven, so it
// needs .start() — silent without it. Order: chorus, then delay, then reverb, then dest.
const CHORUS_SETTINGS: Partial<
  Record<
    InstrumentType,
    { frequency: number; delayTime: number; depth: number; wet: number }
  >
> = {
  // guitar-acoustic's entry removed 2026-10-08 (Paul) — same reasoning as
  // REVERB_SETTINGS above, hear the new Yindad Acoustic content fully dry before
  // deciding whether/how to re-add. The prior { frequency: 1.2, delayTime: 3.5,
  // depth: 0.5, wet: 0.5 } was carried over unchanged from the old nylon pack and
  // never actually tuned against this content either.
}
const DELAY_SETTINGS: Partial<
  Record<InstrumentType, { delayTime: string; feedback: number; wet: number }>
> = {
  // guitar-acoustic had { delayTime: '8n.', feedback: 0.3, wet: 0.2 } — removed per
  // Paul's request to hear it without the ping-pong delay first. Easy to bring back (at
  // this same value, or lower) if it turns out to be missed.
  //
  // analog-synth-temp had { delayTime: '8n.', feedback: 0.35, wet: 0.25 } (plus
  // delayTimeForSubdivision() below live-overriding the time per grid) — removed
  // 2026-10-09, not landing right yet even after the per-grid tuning pass, Paul wants to
  // come back to it properly rather than keep nudging values blind. The subdivision-aware
  // mechanism itself (delayTimeForSubdivision, the live update in playSequence(), and the
  // construction-time wiring in buildEffectsChain()) stays in place, generic and ready —
  // only this config entry is gone.
}

// Space Echo-style tape delay — a genuinely different mechanism from DELAY_SETTINGS above
// (Tone.PingPongDelay), not a replacement for it. A plain feedback delay just attenuates
// the same unmodified signal every repeat; a real tape unit's echoes also progressively
// lose high end each pass, since they're circulating back through the same record/
// playback head chain. Confirmed by reading Tone.js's own source: FeedbackDelay and
// PingPongDelay are both bare delay-line + feedback-gain, no filtering/saturation/
// modulation anywhere in the loop — Tone ships nothing that models this out of the box.
// Modeled here (tier 1, darkening only — no saturation or pitch wobble yet, see
// createTapeDelay()'s comment) by routing the feedback loop itself through a lowpass
// filter rather than just filtering the final mix, so repeat N is audibly duller than
// repeat N-1, compounding with every pass.
const TAPE_DELAY_SETTINGS: Partial<
  Record<
    InstrumentType,
    { feedback: number; wet: number; filterFrequency: number; filterRolloff: Tone.FilterRollOff }
  >
> = {
  'analog-synth-temp': { feedback: 0.38, wet: 0.3, filterFrequency: 2800, filterRolloff: -12 },
}

// Maps Eddy's own Subdivision values (see settingsStore.ts) to a Tone.js note-value delay
// time that stays musically locked to whatever grid is currently playing, rather than one
// fixed interval that can clash against certain grids — a dotted-eighth echo read as
// "jarbled" specifically against a triplet grid, since dotted-eighth (straight) time has
// no clean rhythmic relationship to triplet time at all (Paul, 2026-10-09). Applied
// generically to the delay feature itself (in playSequence() below), not special-cased to
// one instrument, so any future instrument configured with DELAY_SETTINGS gets the same
// treatment for free. Paul's own ear tuned these by direct comparison: half notes ->
// quarter-note echo, quarter notes -> eighth-note echo, triplets -> sixteenth-note-
// triplet echo, eighth notes -> dotted-eighth (the one grid still on its original fixed
// value, confirmed still good with the tape delay too, 2026-10-10).
//
// Sixteenth notes were originally quarter-note triplet ('4t', deliberately not "half the
// grid" — a dotted-eighth echo read as messy there, and 4t gave a 3-against-2 feel instead)
// — that held up fine against the old plain ping-pong delay, but against the tape delay's
// slower-decaying, darkened repeats it read as "too fast, like uneven 32nd notes": at 16th-
// note speed the source notes arrive faster than 4t's own interval, so echoes from several
// different source notes overlap at positions that don't line up with the grid, reading as
// chaotic density rather than a clean cross-rhythm. Backed off to the next slower step in
// the same triplet family ('2t', half-note triplet) to thin that overlap out — an
// experiment Paul's ear still needs to confirm, not a re-tuned final value yet.
function delayTimeForSubdivision(subdivision: Subdivision): string {
  switch (subdivision) {
    case 0.5: return '4n'
    case 1: return '8n'
    case 3: return '16t'
    case 4: return '2t'
    default: return '8n.' // 2 (8th)
  }
}

// Plain object, not a Tone.Effect subclass — exposes only what buildEffectsChain() and
// playSequence() actually need (delayTime for the live grid-lock, dispose for teardown,
// connect/toDestination for chaining) rather than the full Effect API surface. Callers
// must connect INTO `.input` explicitly (not into the wrapper itself) since this isn't a
// real ToneAudioNode and Tone's own connect() can't duck-type its way into a plain object.
interface TapeDelay {
  input: Tone.Gain
  delayTime: Tone.Delay['delayTime']
  setWet: (wet: number) => void
  connect: (destination: Tone.ToneAudioNode) => Tone.Gain
  toDestination: () => Tone.Gain
  dispose: () => void
}

// Tier 1: darkening only, no saturation or pitch wobble yet (see TAPE_DELAY_SETTINGS'
// comment above for why this needs hand-wired primitives instead of a stock delay class).
// The feedback loop reads: delay -> filter -> {feedbackGain -> back into delay, wetGain ->
// output}. One filter instance serves both taps, so even the first audible repeat is
// already slightly darker than the dry signal, same as a real tape unit, and every lap
// around the loop compounds the rolloff further on top of that.
function createTapeDelay(options: {
  delayTime: string
  feedback: number
  wet: number
  filterFrequency: number
  filterRolloff: Tone.FilterRollOff
}): TapeDelay {
  const input = new Tone.Gain(1)
  const dry = new Tone.Gain(1 - options.wet)
  const wetGain = new Tone.Gain(options.wet)
  const output = new Tone.Gain(1)
  // maxDelay is a fixed buffer size set once at construction — Tone.Delay's delayTime
  // Param clamps its own maxValue to whatever that was, so a later live update (the grid-
  // lock in playSequence()) would silently cap short if tempo drops after construction.
  // Sized to the slowest allowed tempo's longest mapped grid value (40bpm half-note
  // triplet, delayTimeForSubdivision's '2t' case, = 2.0s exactly — see settingsStore's
  // tempo clamp) with real margin above that exact figure, rather than deriving it from
  // delayTime at whatever bpm happens to be active right now.
  const delayNode = new Tone.Delay(options.delayTime, 3)
  const feedbackFilter = new Tone.Filter(options.filterFrequency, 'lowpass', options.filterRolloff)
  const feedbackGain = new Tone.Gain(options.feedback)

  input.connect(dry)
  dry.connect(output)
  input.connect(delayNode)
  delayNode.connect(feedbackFilter)
  feedbackFilter.connect(wetGain)
  wetGain.connect(output)
  feedbackFilter.connect(feedbackGain)
  feedbackGain.connect(delayNode)

  return {
    input,
    delayTime: delayNode.delayTime,
    // Ramped (not snapped) so toggling it off at the 16th-note grid doesn't click — same
    // short ramp constant setAmbience() uses elsewhere for live wet-value changes. Keeps
    // dry/wetGain complementary (dry = 1 - wet), same relationship construction sets up.
    setWet: (wet: number) => {
      const now = Tone.now()
      dry.gain.rampTo(1 - wet, AMBIENCE_RAMP_TIME, now)
      wetGain.gain.rampTo(wet, AMBIENCE_RAMP_TIME, now)
    },
    connect: (destination) => output.connect(destination),
    toDestination: () => output.toDestination(),
    dispose: () => {
      input.dispose()
      dry.dispose()
      wetGain.dispose()
      output.dispose()
      delayNode.dispose()
      feedbackFilter.dispose()
      feedbackGain.dispose()
    },
  }
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
let outputTapeDelay: TapeDelay | null = null
let outputFilter: Tone.Filter | null = null
let outputAutoFilter: Tone.AutoFilter | null = null
let currentInstrumentType: InstrumentType | null = null
// Cached from the most recent successful load — an AudioBuffer isn't tied to any
// particular BaseAudioContext (unlike an AudioNode), so rebuildAudioContext() below can
// reuse these to reconstruct a Sampler against a brand new context without re-fetching
// over the network. Same principle renderSequenceToBuffer() already relies on for its own
// offline render.
let cachedBuffers: Record<string, AudioBuffer> | null = null
// Tracks the last level passed to setAmbience() so rebuildAudioContext() can reapply it
// to the fresh reverb/chorus nodes it builds — those always construct at ceiling (level 1,
// same as init()'s own default), and nothing else would otherwise know to ramp them back
// down to whatever the user's ambience dial was actually set to.
let currentAmbienceLevel = 1
// Whatever the most recent playSequence() call was actually asked to play — the app-resume
// handler needs this to replay the loop after an unconditional rebuild, since it's a
// module-level listener with no closure over any particular playSequence() call's
// arguments the way tick()'s own recovery does. Only meaningful when isPlaying is true;
// stale values when it's false are harmless since nothing reads this without that guard.
let currentPlaybackParams: {
  sequence: Cluster[]
  settings: PlaybackSettings
  loop: boolean
} | null = null
let loopPart: Tone.Part | null = null
let rafId: number | null = null
let currentClusterDuration = 0
let currentSequenceLength = 0
let lastPlaySequenceTime = 0

// Bumped by every stopLoop() and every fresh playSequence() start. tick()'s self-healing
// retry closures (below) capture their own value and check it before ever touching the
// shared rafId again — confirmed from a real diagnostic log (Paul, 2026-10-06) that without
// this, a stale retry chain from a *previous* playSequence() call (still waiting out its
// 500ms backoff when playback was stopped/restarted) can win a later race for rafId against
// the new, legitimate tick() loop, orphaning one of them silently.
let playbackGeneration = 0

const isLoaded = ref(false)
const isPlaying = ref(false)
const loadError = ref<string | null>(null)
const playingIndex = ref<number>(-1)

// Surfaces whatever the context-recovery guards below (playCluster/playSequence/tick) are
// doing, so a real-device dropout reads as "something's happening" instead of silence —
// see DOWNRIVER.md's playback-dropout entry. Deliberately not wired into the bare
// App.addListener('resume', ...) handler above: that one fires on every lock/unlock
// regardless of whether anything was ever being played, and showing recovery messaging
// for an attempt the user never initiated would be confusing rather than reassuring.
const recoveryStatus = ref<'idle' | 'recovering' | 'failed'>('idle')

function midiToTone(midi: number): string {
  return midiToName(midi)
}

// Strum articulation: 'chord' direction normally triggers every voice at the exact same
// instant (interval 0), which reads as a stab/pad-like hit. On a guitar-family
// instrument that's not how a chord actually happens — a real strum is a very fast
// ripple across the strings, on the order of tens of milliseconds, much faster than the
// arpeggio spacing used for 'up'/'down'/'random' (a fraction of a beat). Only applies to
// 'chord' direction on guitar-type instruments; every other combination is unaffected.
// Live playback only — MIDI export's 'chord' mode still triggers simultaneously, so an
// exported file of a strummed chord will sound very slightly different (a negligible
// ~25ms/voice, but real) from what was heard live.
const STRUM_INTERVAL = 0.025 // seconds between adjacent strings
const GUITAR_INSTRUMENTS: ReadonlySet<InstrumentType> = new Set([
  'guitar-acoustic',
])

function chordInterval(instrumentType: InstrumentType | null): number {
  return instrumentType && GUITAR_INSTRUMENTS.has(instrumentType)
    ? STRUM_INTERVAL
    : 0
}

interface EffectsChain {
  reverb: Tone.Reverb | null
  chorus: Tone.Chorus | null
  delay: Tone.PingPongDelay | null
  tapeDelay: TapeDelay | null
  filter: Tone.Filter | null
  autoFilter: Tone.AutoFilter | null
  firstStage: Tone.ToneAudioNode | null
}

// Builds an instrument's reverb/delay/chorus chain — shared by init() (live) and
// renderSequenceToBuffer() (offline, for audio export) so the two can't drift apart on
// what an instrument actually sounds like. `ambienceLevel` (0-1) scales reverb/chorus wet
// directly at construction time here — live playback instead builds at ambienceLevel=1
// (today's full, already-tuned sound) and relies on a separate setAmbience() call from
// the caller to live-ramp it down afterward, since a one-shot offline render has no
// equivalent "ramp it live" moment; baking the level in at construction is the only option.
async function buildEffectsChain(
  instrumentType: InstrumentType,
  ambienceLevel: number,
  // Construction-time delay-time fallback — live playback's playSequence() corrects this
  // the moment real playback starts regardless (so init()'s call site can safely omit
  // it), but renderSequenceToBuffer()'s offline export never calls playSequence() at all,
  // so passing the real subdivision there is what actually keeps exported audio matching
  // what live playback would sound like, same reasoning NOTE_DURATIONS/latch sharing
  // exists for in the first place.
  subdivision?: Subdivision
): Promise<EffectsChain> {
  const reverbSettings = REVERB_SETTINGS[instrumentType]
  const chorusSettings = CHORUS_SETTINGS[instrumentType]
  const delaySettings = DELAY_SETTINGS[instrumentType]
  const tapeDelaySettings = TAPE_DELAY_SETTINGS[instrumentType]
  const filterSettings = FILTER_SETTINGS[instrumentType]
  const autoFilterSettings = AUTO_FILTER_SETTINGS[instrumentType]
  const clamped = Math.min(1, Math.max(0, ambienceLevel))

  let reverb: Tone.Reverb | null = null
  let delay: Tone.PingPongDelay | null = null
  let tapeDelay: TapeDelay | null = null
  let chorus: Tone.Chorus | null = null
  let filter: Tone.Filter | null = null
  let autoFilter: Tone.AutoFilter | null = null

  // Built furthest-downstream-first (reverb, then delay/tapeDelay, then chorus, then
  // filter), each stage connecting to whatever's already been built or straight to
  // destination if it's the last stage. Any subset can be configured per instrument; an
  // instrument with none of them behaves exactly as before (sampler.toDestination()).
  if (reverbSettings) {
    // Reverb's impulse response is generated asynchronously (it's rendered via
    // Tone.Offline internally) — has to be awaited before anything connects to it,
    // otherwise the first several notes would play with no reverb at all.
    reverb = new Tone.Reverb(reverbSettings.decay).toDestination()
    reverb.wet.value = reverbSettings.wet * clamped
    await reverb.ready
  }
  if (delaySettings) {
    delay = new Tone.PingPongDelay(
      subdivision !== undefined ? delayTimeForSubdivision(subdivision) : delaySettings.delayTime,
      delaySettings.feedback
    )
    delay.wet.value = delaySettings.wet
    if (reverb) delay.connect(reverb)
    else delay.toDestination()
  }
  if (tapeDelaySettings) {
    // Grid-locked the same way PingPongDelay's delayTime is above, via the same shared
    // delayTimeForSubdivision() — playSequence() re-applies this live on every call so a
    // grid change carries into a restart, same precedent as DELAY_SETTINGS. Wet is bypassed
    // (0) at the 16th-note grid — even the slowed half-note-triplet echo read as clutter
    // there, 16ths are busy enough without it — baked in here too (not just playSequence()'s
    // live update) so an offline WAV export, which never calls playSequence(), matches.
    tapeDelay = createTapeDelay({
      delayTime: delayTimeForSubdivision(subdivision ?? 4),
      feedback: tapeDelaySettings.feedback,
      wet: subdivision === 4 ? 0 : tapeDelaySettings.wet,
      filterFrequency: tapeDelaySettings.filterFrequency,
      filterRolloff: tapeDelaySettings.filterRolloff,
    })
    if (delay) tapeDelay.connect(delay)
    else if (reverb) tapeDelay.connect(reverb)
    else tapeDelay.toDestination()
  }
  if (chorusSettings) {
    // Chorus is LFO-driven — silent without it.
    chorus = new Tone.Chorus(
      chorusSettings.frequency,
      chorusSettings.delayTime,
      chorusSettings.depth
    ).start()
    chorus.wet.value = chorusSettings.wet * clamped
    // tapeDelay isn't a real ToneAudioNode (see its own comment) — anything connecting
    // into it has to target its exposed `.input` Gain specifically.
    if (tapeDelay) chorus.connect(tapeDelay.input)
    else if (delay) chorus.connect(delay)
    else if (reverb) chorus.connect(reverb)
    else chorus.toDestination()
  }
  if (filterSettings) {
    // Placed furthest upstream (closest to the source) rather than in parallel with the
    // wet sends — the point is to warm the *dry* signal at the source, which then also
    // warms whatever reverb tail is built from it, rather than filtering only the dry
    // path and leaving a brighter, unfiltered reverb tail behind.
    filter = new Tone.Filter(
      filterSettings.frequency,
      'lowpass',
      filterSettings.rolloff
    )
    const next: Tone.ToneAudioNode | null = chorus ?? tapeDelay?.input ?? delay ?? reverb
    if (next) filter.connect(next)
    else filter.toDestination()
  }
  if (autoFilterSettings) {
    // Furthest upstream of everything — the sweep colors the raw source signal before any
    // of it reaches chorus/delay/reverb, so a delay's echoes (if configured) drift in
    // brightness along with the dry signal rather than staying fixed while only the dry
    // tone moves.
    autoFilter = new Tone.AutoFilter({
      frequency: autoFilterSettings.frequency,
      baseFrequency: autoFilterSettings.baseFrequency,
      octaves: autoFilterSettings.octaves,
    }).start()
    autoFilter.wet.value = autoFilterSettings.wet
    const next: Tone.ToneAudioNode | null = filter ?? chorus ?? tapeDelay?.input ?? delay ?? reverb
    if (next) autoFilter.connect(next)
    else autoFilter.toDestination()
  }

  return {
    reverb,
    chorus,
    delay,
    tapeDelay,
    filter,
    autoFilter,
    firstStage: autoFilter ?? filter ?? chorus ?? tapeDelay?.input ?? delay ?? reverb,
  }
}

// Constructs a Sampler from already-decoded buffers and waits for Tone's own onload
// event — shared by init() (live) and renderSequenceToBuffer() (offline).
function createSampler(
  buffers: Record<string, AudioBuffer>,
  instrumentType: InstrumentType
): Promise<Tone.Sampler> {
  return new Promise((resolve) => {
    const sampler = new Tone.Sampler({
      urls: buffers,
      release: noteRelease(instrumentType),
      volume: INSTRUMENT_VOLUME[instrumentType] ?? 0,
      onload: () => resolve(sampler),
    })
  })
}

async function init(instrumentType: InstrumentType = 'piano'): Promise<void> {
  // No-op if same instrument already loaded
  if (instrument && isLoaded.value && currentInstrumentType === instrumentType)
    return

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
  if (outputTapeDelay) {
    outputTapeDelay.dispose()
    outputTapeDelay = null
  }
  if (outputFilter) {
    outputFilter.dispose()
    outputFilter = null
  }
  if (outputAutoFilter) {
    outputAutoFilter.dispose()
    outputAutoFilter = null
  }

  await Tone.start()
  currentInstrumentType = instrumentType

  // Guards against stale instrument values from old saved sessions/defaults
  // (e.g. 'cello'/'violin' persisted before those were removed)
  const { urls, baseUrl } =
    SAMPLER_CONFIGS[instrumentType] ?? SAMPLER_CONFIGS.piano!
  // Fetch + decode ourselves rather than letting Tone.Sampler do it: in Capacitor's iOS
  // WKWebView, fetch() against the capacitor:// scheme returns status 0 / ok=false even
  // though the body is delivered intact, and Tone rejects every sample on !response.ok.
  try {
    const buffers = await loadBuffers(urls, baseUrl, ROOT_GAIN_DB[instrumentType])
    cachedBuffers = buffers
    const chain = await buildEffectsChain(instrumentType, 1)
    outputReverb = chain.reverb
    outputChorus = chain.chorus
    outputDelay = chain.delay
    outputTapeDelay = chain.tapeDelay
    outputFilter = chain.filter
    outputAutoFilter = chain.autoFilter

    const sampler = await createSampler(buffers, instrumentType)
    if (chain.firstStage) {
      sampler.connect(chain.firstStage)
    } else {
      sampler.toDestination()
    }
    instrument = sampler
    isLoaded.value = true
    loadError.value = null
  } catch (err) {
    loadError.value = `Failed to load ${instrumentType} samples`
    console.error('Sampler load error:', err)
    throw err
  }
}

// Per-root-sample gain (dB) applied once, to the freshly decoded buffer, so a sample pack's
// uneven root levels can be evened out without re-encoding the files. Each root also covers
// its neighbours (Tone.Sampler repitches the nearest sample), so a hot root is a hot
// *region*. Measured 2026-10-21 (RMS of the first 0.3s, dBFS) for the VSCO2 upright in
// 'piano-salamander': F2 -23.7, A2 -23.9, C#3 -24.4 against -27 to -32 for every root from
// F3 up — the bottom three sat 4-8 dB hot, F2 with the highest peak of any file (-13.3);
// Paul heard F2 as always extra loud. Trimmed toward ~-28.
const ROOT_GAIN_DB: Partial<Record<InstrumentType, Record<string, number>>> = {
  'piano-salamander': { F2: -5, A2: -4, 'C#3': -3 },
}

async function loadBuffers(
  urls: Record<string, string>,
  baseUrl: string,
  rootGainDb?: Record<string, number>
): Promise<Record<string, AudioBuffer>> {
  const ctx = Tone.getContext().rawContext
  const entries = await Promise.all(
    Object.entries(urls).map(async ([note, file]) => {
      const bytes = await (await fetch(baseUrl + file)).arrayBuffer()
      const buffer = await ctx.decodeAudioData(bytes)
      const db = rootGainDb?.[note]
      if (db) {
        const gain = 10 ** (db / 20)
        for (let c = 0; c < buffer.numberOfChannels; c++) {
          const data = buffer.getChannelData(c)
          for (let i = 0; i < data.length; i++) data[i] *= gain
        }
      }
      return [note, buffer] as const
    })
  )
  return Object.fromEntries(entries)
}

// Renders a full sequence to an offline audio buffer via Tone.Offline() — the basis for
// audio (WAV) export. Fully self-contained: builds its own Sampler + effects chain scoped
// to the OfflineContext Tone.Offline() provides, entirely independent of the live
// singleton state above (instrument/outputReverb/etc. are never touched), so this can run
// safely regardless of whether anything is currently playing live, and can even render a
// *different* instrument than whatever's currently loaded.
//
// Reuses the exact same scheduling logic (buildClusterEvents/buildArpeggioNotes from
// arpeggioEngine.ts) as both live playback and MIDI export — the same reasoning that
// module exists for at all. Unlike MIDI export, this includes humanized velocity and the
// current ambience level: a rendered WAV is a "print," with no post-processing chance
// left once it's audio, the way a MIDI import still gets reshaped in the receiving DAW.
async function renderSequenceToBuffer(
  sequence: Cluster[],
  instrumentType: InstrumentType,
  settings: PlaybackSettings,
  ambience: number
): Promise<Tone.ToneAudioBuffer> {
  const beatsPerBar = settings.beatsPerBar ?? 4
  const isChord = settings.direction === 'chord'
  const interval = isChord
    ? chordInterval(instrumentType)
    : intervalFromBpm(settings.bpm, settings.subdivision)
  const beat = 60 / settings.bpm
  const maxVoices = Math.max(...sequence.map((c) => c.length))
  const subdivisionsPerBar = beatsPerBar * (settings.subdivision ?? 4)
  const barsNeeded = isChord
    ? 1
    : Math.max(1, Math.ceil(maxVoices / subdivisionsPerBar))
  const clusterDuration = barsNeeded * beatsPerBar * beat
  const totalDuration = sequence.length * clusterDuration

  const events = sequence.flatMap((cluster, i) => {
    // Per-row pool overrides (direction/latch) exactly as playSequence() resolves them — the
    // export sequence is the expanded pool timeline (repeats included), so index i lines up
    // with settings.directionOverrides/latchOverrides.
    const clusterDirection = settings.directionOverrides?.[i] ?? settings.direction
    const clusterLatch = settings.latchOverrides?.[i] ?? (settings.latch ?? false)
    const clusterInterval =
      clusterDirection === 'chord'
        ? chordInterval(instrumentType)
        : intervalFromBpm(settings.bpm, settings.subdivision)
    const clusterEvents = buildClusterEvents(
      cluster,
      clusterDirection,
      clusterInterval,
      clusterDuration,
      clusterLatch
    )
    const plan = velocitiesForEvents(clusterEvents, clusterInterval, {
      cluster,
      previousCluster: sequence[i - 1],
      instrument: instrumentType,
      direction: clusterDirection,
      beatsPerBar,
      subdivision: settings.subdivision ?? 4,
      seed: settings.velocitySeed ?? 0,
    })
    return clusterEvents.map((e, k) => ({
      time: i * clusterDuration + e.time,
      notes: e.notes,
      velocities: plan.velocities[k],
      jitter: plan.jitter[k],
      interval: clusterInterval,
    }))
  })

  const dur = NOTE_DURATIONS[instrumentType] ?? '2n'
  const release = noteRelease(instrumentType)
  const { urls, baseUrl } =
    SAMPLER_CONFIGS[instrumentType] ?? SAMPLER_CONFIGS.piano!
  const buffers = await loadBuffers(urls, baseUrl, ROOT_GAIN_DB[instrumentType])

  // Pad the render past the last note's trigger time so its full sustain+release tail
  // isn't cut off — live playback never has to worry about this (the Transport just
  // keeps going), but an offline render has a fixed buffer length decided up front.
  const tailPadding = Tone.Time(dur).toSeconds() + release + 0.5
  const renderDuration = totalDuration + tailPadding

  return Tone.Offline(async () => {
    const chain = await buildEffectsChain(instrumentType, ambience, settings.subdivision)
    const sampler = await createSampler(buffers, instrumentType)
    if (chain.firstStage) sampler.connect(chain.firstStage)
    else sampler.toDestination()

    events.forEach((event) => {
      event.notes.forEach((midi, noteIdx) => {
        sampler.triggerAttackRelease(
          midiToTone(midi),
          dur,
          event.time + noteIdx * event.interval,
          event.jitter[noteIdx] ? humanizeVelocity(event.velocities[noteIdx]) : event.velocities[noteIdx]
        )
      })
    })
  }, renderDuration)
}

function playCluster(
  cluster: number[],
  settings: PlaybackSettings = { bpm: 80, direction: 'up' },
  onComplete?: () => void
): void {
  if (!currentInstrumentType || !cachedBuffers) return // init() never ran this session

  // Belt-and-suspenders alongside the 'resume' listener above: if the context is still
  // suspended for any reason (the listener hasn't fired yet, or this platform doesn't
  // emit it), retry once the resume completes rather than silently scheduling into a
  // dead context. Also covers instrument being null — a previous rebuild attempt that
  // failed partway through leaves it that way, and without this check here too, this
  // function would silently no-op forever on the old `if (!instrument...) return` guard,
  // never reaching recovery again (confirmed on-device, 2026-10-07).
  if (!instrument || !isLoaded.value || Tone.getContext().state !== 'running') {
    logDiag('playCluster.contextNotRunning', {
      state: Tone.getContext().state,
      hasInstrument: !!instrument,
    })
    recoveryStatus.value = 'recovering'
    ensureFreshAudioContext().then(
      () => {
        recoveryStatus.value = 'idle'
        safeRecoveryReplay('playCluster', () => playCluster(cluster, settings, onComplete))
      },
      (err) => {
        logDiag('playCluster.rebuild.fail', { err: String(err) })
        recoveryStatus.value = 'failed'
      }
    )
    return
  }

  stopLoop()

  const interval =
    settings.direction === 'chord'
      ? chordInterval(currentInstrumentType)
      : intervalFromBpm(settings.bpm, settings.subdivision)
  const notes = buildArpeggioNotes(cluster, settings.direction)
  const now = Tone.now()
  const dur = noteDuration()

  const plan = velocitiesForEvents([{ time: 0, notes }], interval, {
    cluster,
    previousCluster: settings.previousCluster,
    instrument: currentInstrumentType ?? undefined,
    direction: settings.direction,
    beatsPerBar: settings.beatsPerBar ?? 4,
    subdivision: settings.subdivision ?? 4,
    seed: settings.velocitySeed ?? 0,
  })
  notes.forEach((midi, i) => {
    instrument!.triggerAttackRelease(
      midiToTone(midi),
      dur,
      now + i * interval,
      plan.jitter[0][i] ? humanizeVelocity(plan.velocities[0][i]) : plan.velocities[0][i]
    )
  })

  if (onComplete) {
    const totalTime = (notes.length - 1) * interval + Tone.Time(dur).toSeconds()
    setTimeout(onComplete, totalTime * 1000)
  }
}

function playSequence(
  sequence: Cluster[],
  settings: PlaybackSettings = { bpm: 80, direction: 'up' },
  loop = true,
  onComplete?: () => void
): void {
  if (sequence.length === 0) return
  if (!currentInstrumentType || !cachedBuffers) return // init() never ran this session

  // Covers context-not-running AND instrument-is-null (a previous rebuild attempt failed
  // partway through and left it that way — confirmed on-device, 2026-10-07: without the
  // !instrument check, a failed rebuild left this function silently no-op'ing forever on
  // the old `if (!instrument...) return` guard, never reaching recovery again). Deliberately
  // ahead of the debounce check below: it stamps lastPlaySequenceTime, which would
  // otherwise make the retried call swallow itself as a false "too-soon" repeat.
  if (!instrument || !isLoaded.value || Tone.getContext().state !== 'running') {
    logDiag('playSequence.contextNotRunning', {
      state: Tone.getContext().state,
      hasInstrument: !!instrument,
    })
    recoveryStatus.value = 'recovering'
    ensureFreshAudioContext().then(
      () => {
        recoveryStatus.value = 'idle'
        safeRecoveryReplay('playSequence', () => playSequence(sequence, settings, loop))
      },
      (err) => {
        logDiag('playSequence.rebuild.fail', { err: String(err) })
        recoveryStatus.value = 'failed'
      }
    )
    return
  }

  const now = Date.now()
  if (now - lastPlaySequenceTime < 100) return
  lastPlaySequenceTime = now
  currentPlaybackParams = { sequence, settings, loop }

  stopLoop()

  // Set BEFORE the delay-time updates below — delayTimeForSubdivision() returns a
  // Tone.js time string ('2t', '8n', etc.), and assigning it to a Param resolves it to
  // absolute seconds ONCE, against whatever Transport.bpm is at that exact moment, not a
  // live binding that re-resolves later. Setting bpm first here used to happen further
  // down (right before building the Tone.Part) — on the very first play of a session, or
  // any time actual bpm doesn't already happen to match the transport's current value from
  // a previous call, the delay would resolve against the stale/default bpm and come out
  // "way off," only correcting itself on the next call once this same assignment (from the
  // wrong-bpm call) had already brought the transport up to date in time for that one
  // (Paul, 2026-10-13: analog synth delay wrong on first loop, correct after a stop/
  // restart). transport.loop/loopStart/loopEnd still get set in their original spot
  // further down — those don't affect delay-time resolution and depend on clusterDuration,
  // not computed yet this early.
  const transport = Tone.getTransport()
  transport.bpm.value = settings.bpm

  // Keeps a configured delay's echo time musically locked to whatever grid is actually
  // playing — updated on every call, not just at construction, so a grid change always
  // carries the right timing into its restart (see delayTimeForSubdivision's own comment).
  if (outputDelay && currentInstrumentType && DELAY_SETTINGS[currentInstrumentType]) {
    outputDelay.delayTime.value = delayTimeForSubdivision(settings.subdivision ?? 4)
  }
  if (outputTapeDelay && currentInstrumentType) {
    const tapeDelaySettings = TAPE_DELAY_SETTINGS[currentInstrumentType]
    if (tapeDelaySettings) {
      outputTapeDelay.delayTime.value = delayTimeForSubdivision(settings.subdivision ?? 4)
      // 16th notes are fast enough on their own — even the slowed-down half-note-triplet
      // echo (see delayTimeForSubdivision's own comment) still read as extra clutter
      // rather than texture at that grid, so bypass the delay there entirely rather than
      // chase another timing value. Sweep (AUTO_FILTER_SETTINGS) is unaffected — that one
      // sounded good throughout, this is delay-specific.
      outputTapeDelay.setWet(settings.subdivision === 4 ? 0 : tapeDelaySettings.wet)
    }
  }

  const isChord = settings.direction === 'chord'
  const interval = isChord
    ? chordInterval(currentInstrumentType)
    : intervalFromBpm(settings.bpm, settings.subdivision)
  const beat = 60 / settings.bpm

  // Bar-quantized, matching exportSequenceAsMidi()'s barsNeeded math exactly — a cluster
  // always changes on a downbeat, whether you're listening live or in an exported MIDI
  // file. Previously this used a totally different formula (voice count * interval + a
  // fixed gap, no bar rounding at all), so live playback and the exported file disagreed
  // on when a chord changed for every direction except 'chord' (which already happened
  // to occupy exactly one bar either way).
  const beatsPerBar = settings.beatsPerBar ?? 4
  const maxVoices = Math.max(...sequence.map((c) => c.length))
  const subdivisionsPerBar = beatsPerBar * (settings.subdivision ?? 4)
  const barsNeeded = isChord
    ? 1
    : Math.max(1, Math.ceil(maxVoices / subdivisionsPerBar))
  const clusterDuration = barsNeeded * beatsPerBar * beat

  const dur = noteDuration()

  // Per cluster, not hoisted out of the loop: a pool-overridden direction can switch a
  // specific cluster into/out of 'chord', which needs its own strum-speed interval
  // (chordInterval) rather than the arpeggio interval every other direction uses — the
  // single `interval`/`isChord` computed above is only ever the bar-length baseline now,
  // not what actually gets used to space out a given cluster's notes.
  const events = sequence.flatMap((cluster, i) => {
    const clusterDirection = settings.directionOverrides?.[i] ?? settings.direction
    const clusterLatch = settings.latchOverrides?.[i] ?? (settings.latch ?? false)
    const clusterInterval = clusterDirection === 'chord'
      ? chordInterval(currentInstrumentType)
      : intervalFromBpm(settings.bpm, settings.subdivision)
    const clusterEvents = buildClusterEvents(
      cluster,
      clusterDirection,
      clusterInterval,
      clusterDuration,
      clusterLatch
    )
    const plan = velocitiesForEvents(clusterEvents, clusterInterval, {
      cluster,
      previousCluster: sequence[i - 1],
      instrument: currentInstrumentType ?? undefined,
      direction: clusterDirection,
      beatsPerBar,
      subdivision: settings.subdivision ?? 4,
      seed: settings.velocitySeed ?? 0,
    })
    return clusterEvents.map((e, k) => ({
      time: i * clusterDuration + e.time,
      notes: e.notes,
      velocities: plan.velocities[k],
      jitter: plan.jitter[k],
      // This row's own spacing: a pool can switch a row into/out of 'chord' (strum-speed
      // spacing) while the global direction is an arpeggio, or the reverse. Spacing every
      // note with the global `interval` made such a row play in the *global* style.
      interval: clusterInterval,
    }))
  })

  const totalDuration = sequence.length * clusterDuration

  // Configure remaining Transport loop params BEFORE starting — bpm itself is already set,
  // above, ahead of the delay-time resolution earlier in this function.
  transport.loop = loop
  transport.loopStart = 0
  transport.loopEnd = totalDuration

  loopPart = new Tone.Part((time, event) => {
    event.notes.forEach((midi: number, noteIdx: number) => {
      instrument!.triggerAttackRelease(
        midiToTone(midi),
        dur,
        time + noteIdx * event.interval,
        // Rolled here, at trigger time, so every pass and every loop trip differs a little
        event.jitter[noteIdx] ? humanizeVelocity(event.velocities[noteIdx]) : event.velocities[noteIdx]
      )
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

  // Mint this session's own id — see the playbackGeneration declaration above. Captured
  // by tick()'s closures below; stopLoop() bumps the counter again on any real stop, which
  // this check catches even if that stop/restart happens while a retry is mid-backoff.
  const myGeneration = ++playbackGeneration
  let recoveryStartedAt: number | null = null

  // When not looping, stop cleanly after one pass. onComplete (SessionView's "play a
  // one-shot lead-in, then chain into a full loop" for loop+selected-row playback) fires
  // only if nothing superseded this run in the meantime — stopLoop() unconditionally
  // bumps playbackGeneration itself, so the staleness check has to be captured before
  // calling it, not after.
  if (!loop) {
    transport.scheduleOnce(() => {
      const stillCurrent = playbackGeneration === myGeneration
      stopLoop()
      if (onComplete && stillCurrent) onComplete()
    }, totalDuration)
  }

  // A continuous failure streak longer than this gives up rather than retrying forever.
  // Confirmed on-device (Paul, 2026-10-06 diagnostic log): after the context lands in
  // WebKit's 'interrupted' state, Tone.start() calls made from here — a setTimeout/rAF
  // callback, never a direct user tap — can apparently fail (or hang, see
  // startToneWithTimeout) indefinitely; no amount of retrying from non-gesture code ever
  // clears it. Retrying for a while is still correct (plenty of real interruptions do
  // clear within a few seconds on their own), but silently spinning forever leaves
  // isPlaying stuck true with the play button lit and nothing audible — exactly the "stuck
  // on" report. Giving up explicitly flips isPlaying false so the UI tells the truth; the
  // user's next tap on play is a real gesture, which actually can unstick WebKit.
  const RECOVERY_TIMEOUT_MS = 20000

  function tick() {
    if (playbackGeneration !== myGeneration) return // superseded by a stop or a newer session

    // Self-healing: the resume-and-retry guard at the top of this function only catches
    // a suspended context at the moment playback *starts* — it can't catch one that dies
    // mid-loop (screen lock, a call, or anything else) while this rAF loop is already
    // running. Checking every frame is cheap (a property read) and turns "silently dead
    // until the app is restarted" into "recovers within about a second on its own."
    // Restarts from the top of the sequence rather than attempting to resume the exact
    // position — a small jump is a better tradeoff than staying broken.
    // Triggers on an actively dead context, OR on a previous check having found one dead
    // and no confirmed recovery since (recoveryStartedAt still set). Confirmed on-device
    // (Paul, 2026-10-07): a bare .state === 'running' reading isn't trustworthy on its own
    // once a context has already been through an interruption — it can report 'running'
    // via some other path (the module-level App.addListener('resume', ...) handler's
    // cheap probe, or even rebuildAudioContext() itself reporting success) while the
    // underlying hardware audio route stays dead. Only a confirmed-successful rebuild
    // below clears recoveryStartedAt, so a stale 'running' reading alone can't skip it.
    if (!instrument || Tone.getContext().state !== 'running' || recoveryStartedAt !== null) {
      logDiag('tick.contextNotRunning', {
        state: Tone.getContext().state,
        hasInstrument: !!instrument,
      })
      if (recoveryStartedAt === null) recoveryStartedAt = Date.now()
      recoveryStatus.value = 'recovering'
      rafId = null
      // ensureFreshAudioContext() (not a plain resume) — confirmed on-device the same day:
      // even a fully clean, exception-free resume-and-reschedule doesn't reliably bring
      // real audio back, so resuming the same context is no longer trusted at all here.
      ensureFreshAudioContext().then(
        () => {
          if (playbackGeneration !== myGeneration) return
          logDiag('tick.rebuild.ok')
          recoveryStartedAt = null
          recoveryStatus.value = 'idle'
          if (isPlaying.value) {
            safeRecoveryReplay('tick', () => playSequence(sequence, settings, loop))
          }
        },
        (err) => {
          if (playbackGeneration !== myGeneration) return
          // Previously a rejection here just logged and gave up, leaving rafId null
          // forever with no further attempt. Now it keeps retrying every ~500ms instead —
          // cheap (a timer, not a tight loop) and self-limiting (stops as soon as
          // isPlaying goes false, or the recovery timeout below gives up on its own).
          logDiag('tick.rebuild.fail', { err: String(err) })
          if (recoveryStartedAt !== null && Date.now() - recoveryStartedAt > RECOVERY_TIMEOUT_MS) {
            logDiag('tick.recovery.gaveUp', { afterMs: Date.now() - recoveryStartedAt })
            recoveryStatus.value = 'failed'
            stopLoop()
            return
          }
          setTimeout(() => {
            if (playbackGeneration === myGeneration && isPlaying.value) {
              rafId = requestAnimationFrame(tick)
            }
          }, 500)
        }
      )
      return
    }

    const pos = Tone.getTransport().seconds
    const idx = Math.floor(pos / currentClusterDuration) % currentSequenceLength
    playingIndex.value = idx
    rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)
}

// UI-callable clear for the "failed" recovery toast — its own auto-dismiss duration is a
// presentational concern that belongs in SessionView.vue, not baked into the engine.
function resetRecoveryStatus(): void {
  recoveryStatus.value = 'idle'
}

// Resets the live instrument's volume to its correct configured trim — a safety net
// callable from anywhere audio might have been left muted for any reason, not just the
// one mechanism below. `reason` is just for the diagnostic log, so a stuck-mute report
// can be traced back to which recovery path caught it.
function resetInstrumentVolume(reason: string): void {
  if (!instrument || !currentInstrumentType) return
  const target = INSTRUMENT_VOLUME[currentInstrumentType] ?? 0
  if (instrument.volume.value !== target) {
    logDiag('resetInstrumentVolume', { reason, from: instrument.volume.value, to: target })
    instrument.volume.value = target
  }
}

// Stopping the Transport only stops SCHEDULING new notes — any note already triggered
// keeps ringing out its full release. Tone.Sampler bakes the release fade into each
// buffer source at trigger time, so changing `release` afterward can't shorten a note
// that's already sounding. A hard stop instead briefly mutes the shared output, which
// silences whatever's still ringing regardless of its baked-in release, then restores
// volume immediately after so it's ready for whatever plays next.
const HARD_STOP_MUTE_TIME = 0.015

function stopLoop(hardStop = false): void {
  // Invalidate any tick() retry chain still mid-backoff from a previous playSequence()
  // call — see the playbackGeneration declaration up top. Unconditional (not gated on
  // isPlaying) since a stale chain can still be waiting out its 500ms setTimeout even
  // after isPlaying has already gone false some other way.
  playbackGeneration++
  // Only log a "real" stop (something was actually playing) — every playSequence()/
  // playCluster() call also calls this first as routine pre-start cleanup, which would
  // otherwise spam the log on every single stream audition.
  if (isPlaying.value) {
    logDiag('stopLoop', { hardStop })
  }
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  if (loopPart) {
    // Defensive, not just tidy: an uncaught throw here (confirmed on-device, 2026-10-07 —
    // disposing a Part against an already-closed context) previously left loopPart
    // permanently un-nulled, which meant every future stopLoop() call hit the same throw
    // forever — bricking nearly every user action for the rest of the session. loopPart
    // is always nulled below regardless of whether either call actually succeeds.
    try {
      loopPart.stop()
    } catch (err) {
      logDiag('dispose.loopPart.stopThrew', { err: String(err) })
    }
    disposeQuietly('loopPart', loopPart)
    loopPart = null
  }
  const transport = Tone.getTransport()
  transport.stop()
  transport.loop = false
  transport.position = 0
  isPlaying.value = false
  playingIndex.value = -1

  if (hardStop && instrument) {
    // Confirmed on-device (Paul, 2026-10-05 diagnostic log): a hard stop landed while the
    // audio context was still mid-recovery from a backgrounding interruption (not yet
    // confirmed 'running'). The restore step below used to be a *second* audio-clock-
    // scheduled event 15ms after the mute — if the clock itself is unstable right when
    // that gets scheduled, the restore can silently never fire, leaving the instrument
    // permanently muted at -Infinity with everything else in the engine working normally.
    // The mute-down stays a Tone-scheduled ramp (immediate, low risk) — the restore now
    // runs on a plain JS timer instead, independent of the audio clock's own stability,
    // plus targets this instrument's actual configured trim rather than a hardcoded 0
    // (separate, smaller bug: every hard stop was quietly resetting e.g.
    // holdsworthian-pad's +12dB trim to unity gain).
    const now = Tone.now()
    instrument.volume.rampTo(-Infinity, HARD_STOP_MUTE_TIME, now)
    setTimeout(() => resetInstrumentVolume('stopLoop.hardStop'), HARD_STOP_MUTE_TIME * 1000)
  }
}

// Tempo is the one playback setting that's genuinely live-rampable: Tone.Part events are
// committed to Transport ticks at schedule time, and ticks are tempo-invariant — ramping
// Transport.bpm speeds up or slows down everything already scheduled for free, with no
// restart and therefore none of the hard-stop/reschedule jarble a direction/subdivision/
// latch/time-signature change needs. The only side effect: currentClusterDuration (seconds,
// baked in from the old bpm) drives the rAF playhead tracker in playSequence()'s tick()
// below, so it has to be rescaled by the same ratio to keep playingIndex accurate.
//
// Must stay comfortably shorter than SessionView.vue's tempo-hold interval (100ms, see
// startTempoHold()) — held +/- fires a new call every 100ms, and if the ramp window were
// anywhere near that long, each new rampTo() would retarget the previous one while it was
// still mid-flight, stacking jagged back-to-back automation curves on Transport.bpm.
// Ticks scheduled during that turbulent window land unevenly in real time even after the
// final bpm settles (Paul's "8th notes sound irregular" report, 2026-10-04) — keeping the
// ramp well under 100ms means each one fully completes before the next call can arrive.
const TEMPO_RAMP_TIME = 0.05

function setTempoLive(bpm: number): void {
  if (!isPlaying.value) return
  const transport = Tone.getTransport()
  const oldBpm = transport.bpm.value
  if (oldBpm === bpm) return
  transport.bpm.rampTo(bpm, TEMPO_RAMP_TIME)
  currentClusterDuration *= oldBpm / bpm
}

// Ambience dial: scales whichever effects the current instrument already has (reverb,
// and chorus for guitar-acoustic) proportionally, rather than exposing separate
// reverb/chorus/delay sliders — see DOWNRIVER.md's "Ambience Dial" writeup for the full
// reasoning. `level` is 0-1; each instrument's REVERB_SETTINGS/CHORUS_SETTINGS wet value
// is the ceiling ("what 100% sounds like"), already tuned by ear per instrument, so 1.0
// reproduces today's shipped sound exactly and 0 goes fully dry. Wet is a plain Tone.js
// Signal — cheap and safe to change live, unlike reverb decay (would need an async
// .generate() call) — so this ramps the *existing* node's wet value rather than
// recreating anything. A short ramp (not an instant jump) avoids a zipper/click artifact
// on a fast slider drag; still reads as immediate.
const AMBIENCE_RAMP_TIME = 0.06

function setAmbience(level: number): void {
  const clamped = Math.min(1, Math.max(0, level))
  currentAmbienceLevel = clamped
  const now = Tone.now()
  if (outputReverb && currentInstrumentType) {
    const ceiling = REVERB_SETTINGS[currentInstrumentType]?.wet ?? 0
    outputReverb.wet.rampTo(ceiling * clamped, AMBIENCE_RAMP_TIME, now)
  }
  if (outputChorus && currentInstrumentType) {
    const ceiling = CHORUS_SETTINGS[currentInstrumentType]?.wet ?? 0
    outputChorus.wet.rampTo(ceiling * clamped, AMBIENCE_RAMP_TIME, now)
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
  if (outputTapeDelay) {
    outputTapeDelay.dispose()
    outputTapeDelay = null
  }
  if (outputFilter) {
    outputFilter.dispose()
    outputFilter = null
  }
  if (outputAutoFilter) {
    outputAutoFilter.dispose()
    outputAutoFilter = null
  }
}

export function useAudioEngine() {
  return {
    isLoaded: readonly(isLoaded),
    isPlaying: readonly(isPlaying),
    loadError: readonly(loadError),
    playingIndex: readonly(playingIndex),
    recoveryStatus: readonly(recoveryStatus),
    resetRecoveryStatus,
    init,
    playCluster,
    playSequence,
    stopLoop,
    setTempoLive,
    setAmbience,
    renderSequenceToBuffer,
    dispose,
  }
}
