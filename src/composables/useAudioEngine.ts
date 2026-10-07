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
  humanVelocity,
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

// iOS suspends the WebAudio context whenever the app is backgrounded or the screen
// locks (a real interruption, not just a pause), and nothing resumes it automatically —
// every scheduled note would then silently do nothing until the app was force-restarted.
// Tone.start() is what actually resumes a suspended context (it's not just a first-run
// unlock), and it's idempotent — resolves immediately if the context is already running.
// Registered once at module load (this file is a documented singleton), rather than once
// per useAudioEngine() call, which would otherwise stack up duplicate listeners.
App.addListener('resume', () => {
  logDiag('app.resume', { contextState: Tone.getContext().state })
  startToneWithTimeout().then(
    () => {
      logDiag('app.resume.toneStart.ok')
      resetInstrumentVolume('app.resume.toneStart.ok')
    },
    (err) => logDiag('app.resume.toneStart.fail', { err: String(err) })
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

// Acoustic guitar — "Yindad Acoustic" (Paul's own pack), replaced "Soft Nylon Guitar
// Lite" (Mike Georgiades via Pianobook.co.uk) outright 2026-10-07 after a direct A/B in
// the simulator (same key/folder path kept for saved-session backward compatibility,
// same reasoning as every other content swap in this project — see holdsworthian-pad).
// 11 roots, every major third, E2-G#5 — denser and wider coverage than the nylon pack it
// replaced (7 usable roots, C#3-G4). Unlike most packs evaluated in this project,
// filenames measured at TRUE pitch — autocorrelation confirmed all 11 within ~10 cents
// (three readings initially looked ~19 semitones flat on the brighter notes — a
// subharmonic-locking artifact, not a real pitch issue; a frequency-constrained re-check
// confirmed all three are correctly pitched too). Gain-boosted +9dB (measured RMS against
// the outgoing nylon pack on the two exact note-name overlaps, E3/E4) and trimmed to
// 6s/1s fade-out, same treatment as every other instrument. See CREDITS.md for
// attribution.
const GUITAR_ACOUSTIC_URLS: Record<string, string> = {
  E2: 'E2.mp3',
  'G#2': 'Gs2.mp3',
  C3: 'C3.mp3',
  E3: 'E3.mp3',
  'G#3': 'Gs3.mp3',
  C4: 'C4.mp3',
  E4: 'E4.mp3',
  'G#4': 'Gs4.mp3',
  C5: 'C5.mp3',
  E5: 'E5.mp3',
  'G#5': 'Gs5.mp3',
}

// Electric piano and electric guitar samples via Pianobook.co.uk (royalty-free per
// Pianobook's standard license). See CREDITS.md for full attribution.

// Electric piano — 26 notes, whole-tone spacing A1-C6, "mf" dynamic layer. A1-D2 are a
// short run of extra low notes (matching the standard piano's A1 floor) below the
// otherwise-consistent E2-C6 whole-tone ladder.
const ELECTRIC_PIANO_URLS: Record<string, string> = {
  A1: 'A1.mp3',
  C2: 'C2.mp3',
  D2: 'D2.mp3',
  E2: 'E2.mp3',
  'F#2': 'Fs2.mp3',
  'G#2': 'Gs2.mp3',
  'A#2': 'As2.mp3',
  C3: 'C3.mp3',
  D3: 'D3.mp3',
  E3: 'E3.mp3',
  'F#3': 'Fs3.mp3',
  'G#3': 'Gs3.mp3',
  'A#3': 'As3.mp3',
  C4: 'C4.mp3',
  D4: 'D4.mp3',
  E4: 'E4.mp3',
  'F#4': 'Fs4.mp3',
  'G#4': 'Gs4.mp3',
  'A#4': 'As4.mp3',
  C5: 'C5.mp3',
  D5: 'D5.mp3',
  E5: 'E5.mp3',
  'F#5': 'Fs5.mp3',
  'G#5': 'Gs5.mp3',
  'A#5': 'As5.mp3',
  C6: 'C6.mp3',
}

// Electric guitar (sustained "LONG_MODERN" swell articulation, not plucked) — 12 root
// notes, minor-3rd spacing, D2-B4. Loud velocity layer, trimmed from the pack's raw
// 14-31s samples down to 7s with a fade-out (Eddy never sustains a note that long).
const ELECTRIC_GUITAR_URLS: Record<string, string> = {
  D2: 'D2.mp3',
  F2: 'F2.mp3',
  'G#2': 'Gs2.mp3',
  B2: 'B2.mp3',
  D3: 'D3.mp3',
  F3: 'F3.mp3',
  'G#3': 'Gs3.mp3',
  B3: 'B3.mp3',
  D4: 'D4.mp3',
  F4: 'F4.mp3',
  'G#4': 'Gs4.mp3',
  B4: 'B4.mp3',
}

// Pad voice — "Ultra Ambient Pad" (Paul's own sample pack), replaced the original
// "Blackhole Guitars" (JWB) holdsworthian pad entirely 2026-09-30 (Paul felt the old one
// wasn't musically accurate). Kept the InstrumentType key and folder path as
// 'holdsworthian-pad'/`public/samples/holdsworthian-pad/` — same backward-compatibility
// reasoning as when Mikor Piano Felt replaced Salamander under the 'piano' key: an old
// saved session referencing this instrument still resolves to *a* pad, just this one now.
// Source filenames (YO2_*) were, like every sample pack evaluated so far, one octave
// lower than true pitch — confirmed via FFT peak analysis across multiple time offsets
// (autocorrelation alone was unreliable on this heavily chorused/detuned texture). The
// top root in each of the two alternating-tritone series (labeled A#5/E6) measured a
// further octave up from there — A#6/E7 — both above Eddy's MIDI_MAX(84), so excluded;
// six usable roots remain, E3-A#5 alternating every tritone. Trimmed to 7s/1s fade-out
// and gain-corrected per file (levels varied up to 25dB root to root in the raw pack) to
// land at the previous pad's own shipped file level, same two-stage (file +
// INSTRUMENT_VOLUME) treatment. Attribution/license TBD — see CREDITS.md.
const HOLDSWORTHIAN_PAD_URLS: Record<string, string> = {
  E3: 'E3.mp3',
  'A#3': 'As3.mp3',
  E4: 'E4.mp3',
  'A#4': 'As4.mp3',
  E5: 'E5.mp3',
  'A#5': 'As5.mp3',
}

// 'retro-pad' — Paul's own recording of a Logic RetroSynth patch (printed to audio note
// by note, not synthesized live), 2026-10-05. Confirmed by ear as the pad to keep —
// replaced an earlier from-scratch Tone.js synth-pad attempt outright (see InstrumentType
// in settingsStore.ts). MIDI-triggered at a fixed velocity across all 12 roots (every
// major third, E2-C6) for consistent levels. Raw bounces as recorded: 44.1kHz/24-bit/
// stereo WAV, 8s each, untrimmed and unfaded — still pending the same trim/fade/
// gain-match production pass every other instrument in this project went through before
// shipping (file size alone argues for it: WAV here vs. every other instrument's MP3).
const RETRO_PAD_URLS: Record<string, string> = {
  E2: 'E2.wav',
  'G#2': 'Gs2.wav',
  C3: 'C3.wav',
  E3: 'E3.wav',
  'G#3': 'Gs3.wav',
  C4: 'C4.wav',
  E4: 'E4.wav',
  'G#4': 'Gs4.wav',
  C5: 'C5.wav',
  E5: 'E5.wav',
  'G#5': 'Gs5.wav',
  C6: 'C6.wav',
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

// Hoisted out of init() (was rebuilt as a local const on every call) — also needed by
// renderSequenceToBuffer() below for audio export, which loads its own sample buffers
// independent of whatever's currently live-loaded.
const SAMPLER_CONFIGS: Partial<
  Record<InstrumentType, { urls: Record<string, string>; baseUrl: string }>
> = {
  piano: { urls: PIANO_URLS, baseUrl: PIANO_BASE },
  'guitar-acoustic': {
    urls: GUITAR_ACOUSTIC_URLS,
    baseUrl: '/samples/guitar-acoustic/',
  },
  'electric-piano': {
    urls: ELECTRIC_PIANO_URLS,
    baseUrl: '/samples/electric-piano/',
  },
  'electric-guitar': {
    urls: ELECTRIC_GUITAR_URLS,
    baseUrl: '/samples/electric-guitar/',
  },
  'holdsworthian-pad': {
    urls: HOLDSWORTHIAN_PAD_URLS,
    baseUrl: '/samples/holdsworthian-pad/',
  },
  'piano-salamander': {
    urls: UPRIGHT_PIANO_URLS,
    baseUrl: '/samples/piano-original/',
  },
  'retro-pad': {
    urls: RETRO_PAD_URLS,
    baseUrl: '/samples/retro-pad/',
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
  'guitar-acoustic': { min: 40, max: MIDI_MAX }, // E2-C6 — 11 roots every major
  // third, E2-G#5 (Yindad Acoustic); top root sits just 4 semitones below MIDI_MAX,
  // close enough not to narrow the picker, same reasoning as retro-pad
  'electric-piano': { min: 33, max: 84 }, // A1-C6
  'electric-guitar': { min: 38, max: 71 }, // D2-B4
  'holdsworthian-pad': { min: 52, max: 82 }, // E3-A#5 — matches the ambient
  // pad's actual 6 usable roots (narrower than the old Blackhole pad's E2 floor, since
  // the lowest sample here is E3; pitch-shifting further down would be too big a stretch)
  'piano-salamander': { min: 41, max: 81 }, // F2-A5, matches UPRIGHT_PIANO_URLS'
  // 11 usable roots
  'retro-pad': { min: MIDI_MIN, max: MIDI_MAX }, // E2-C6, matches all 12 recorded roots
  // exactly (every major third) — no need to narrow the picker range at all
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
}

// Fixed note durations for plucky/percussive instruments
const NOTE_DURATIONS: Partial<Record<InstrumentType, string>> = {
  piano: '2n',
  'guitar-acoustic': '2n',
  'electric-piano': '2n', // struck/decaying, same character class as piano
  'electric-guitar': '2n', // was '1n' — a full bar held at near-full volume before the
  // release fade even began, so it was still essentially at full volume right up to
  // the next chord's downbeat and only started fading during the new chord, reading
  // as "rings through/muddy" even after the release-time cut. Now matches every other
  // instrument's held duration, giving the release a half-bar head start instead
  'holdsworthian-pad': '1n', // sustained pad character
  'piano-salamander': '2n', // same character class as felt piano
  'retro-pad': '1n', // same sustained pad character
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
  'guitar-acoustic': 1.5, // pluck decays naturally, avoid the harsh-cutoff class of bug —
  // carried over unchanged from the nylon pack this replaced; not yet retuned by ear
  // against the new Yindad Acoustic content specifically
  'piano-salamander': 2.0, // same treatment as felt piano — avoids the harsh default
  // 0.1s cutoff
  'retro-pad': 2.5, // matched holdsworthian-pad's as a starting guess — confirmed sounding
  // good by ear (Paul, 2026-10-05), left as-is
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
  // Tuned by ear against the sample content now in this slot (VSCO2 upright piano,
  // 2026-09-30): 0 -> +6 -> +10. No effects are on this instrument (no REVERB_SETTINGS/
  // CHORUS_SETTINGS/DELAY_SETTINGS/FILTER_SETTINGS entry exists for it — confirmed by
  // grep, not assumed), so the trim itself is the only lever.
  'piano-salamander': 10,
  'retro-pad': 3, // Paul heard it as good but asked for "a tad" louder (2026-10-05) —
  // same modest-boost treatment as piano's +3 above for the same kind of feedback
  // guitar-acoustic needs no entry — the +9dB gain-match measured during its 2026-10-07
  // content swap was baked into the exported files themselves, same convention as piano
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
// dial to scale, so it'd silently do nothing when dialed up. The three added here
// (electric-piano/electric-guitar/holdsworthian-pad) are provisional ceilings, same as
// piano/guitar-acoustic were before they were tuned by ear — expect these to move.
const REVERB_SETTINGS: Partial<
  Record<InstrumentType, { decay: number; wet: number }>
> = {
  piano: { decay: 2.2, wet: 0.44 },
  'guitar-acoustic': { decay: 2.0, wet: 0.4 },
  // Both bumped further than piano/guitar-acoustic's roughly-2x treatment (Paul: audible
  // on piano/guitar-acoustic, not much on these two) — both are inherently smoother,
  // already-sustained tones (electric-piano's samples carry their own tremolo-ish wobble;
  // electric-guitar is a slow-attack swell, not a pluck) with much less silence around
  // each note for an added reverb tail to be heard in, versus piano/guitar-acoustic's
  // percussive attack-then-decay shape. Decay also extended slightly, giving the tail
  // more time to register at all before the next note's attack — still provisional.
  'electric-piano': { decay: 2.4, wet: 0.5 },
  'electric-guitar': { decay: 2.6, wet: 0.5 },
  'holdsworthian-pad': { decay: 2.0, wet: 0.25 }, // already the most sustained/spacious
  // instrument (long release, whole-note held duration), and the "Ultra Ambient Pad"
  // sample content is already extremely wet/swelling on its own — needs the least on top
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
  'guitar-acoustic': { frequency: 1.2, delayTime: 3.5, depth: 0.5, wet: 0.5 },
  // carried over unchanged from the nylon pack this replaced (2026-10-07) — not yet
  // retuned by ear against the new Yindad Acoustic content specifically
}
const DELAY_SETTINGS: Partial<
  Record<InstrumentType, { delayTime: string; feedback: number; wet: number }>
> = {
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
let outputFilter: Tone.Filter | null = null
let currentInstrumentType: InstrumentType | null = null
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
  'electric-guitar',
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
  filter: Tone.Filter | null
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
  ambienceLevel: number
): Promise<EffectsChain> {
  const reverbSettings = REVERB_SETTINGS[instrumentType]
  const chorusSettings = CHORUS_SETTINGS[instrumentType]
  const delaySettings = DELAY_SETTINGS[instrumentType]
  const filterSettings = FILTER_SETTINGS[instrumentType]
  const clamped = Math.min(1, Math.max(0, ambienceLevel))

  let reverb: Tone.Reverb | null = null
  let delay: Tone.PingPongDelay | null = null
  let chorus: Tone.Chorus | null = null
  let filter: Tone.Filter | null = null

  // Built furthest-downstream-first (reverb, then delay, then chorus, then filter), each
  // stage connecting to whatever's already been built or straight to destination if it's
  // the last stage. Any subset can be configured per instrument; an instrument with none
  // of them behaves exactly as before (sampler.toDestination()).
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
      delaySettings.delayTime,
      delaySettings.feedback
    )
    delay.wet.value = delaySettings.wet
    if (reverb) delay.connect(reverb)
    else delay.toDestination()
  }
  if (chorusSettings) {
    // Chorus is LFO-driven — silent without it.
    chorus = new Tone.Chorus(
      chorusSettings.frequency,
      chorusSettings.delayTime,
      chorusSettings.depth
    ).start()
    chorus.wet.value = chorusSettings.wet * clamped
    if (delay) chorus.connect(delay)
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
    const next: Tone.ToneAudioNode | null = chorus ?? delay ?? reverb
    if (next) filter.connect(next)
    else filter.toDestination()
  }

  return {
    reverb,
    chorus,
    delay,
    filter,
    firstStage: filter ?? chorus ?? delay ?? reverb,
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
  if (outputFilter) {
    outputFilter.dispose()
    outputFilter = null
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
    const buffers = await loadBuffers(urls, baseUrl)
    const chain = await buildEffectsChain(instrumentType, 1)
    outputReverb = chain.reverb
    outputChorus = chain.chorus
    outputDelay = chain.delay
    outputFilter = chain.filter

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

async function loadBuffers(
  urls: Record<string, string>,
  baseUrl: string
): Promise<Record<string, AudioBuffer>> {
  const ctx = Tone.getContext().rawContext
  const entries = await Promise.all(
    Object.entries(urls).map(async ([note, file]) => {
      const bytes = await (await fetch(baseUrl + file)).arrayBuffer()
      return [note, await ctx.decodeAudioData(bytes)] as const
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

  const events = sequence.flatMap((cluster, i) =>
    buildClusterEvents(
      cluster,
      settings.direction,
      interval,
      clusterDuration,
      settings.latch ?? false
    ).map((e) => ({ time: i * clusterDuration + e.time, notes: e.notes }))
  )

  const dur = NOTE_DURATIONS[instrumentType] ?? '2n'
  const release = noteRelease(instrumentType)
  const { urls, baseUrl } =
    SAMPLER_CONFIGS[instrumentType] ?? SAMPLER_CONFIGS.piano!
  const buffers = await loadBuffers(urls, baseUrl)

  // Pad the render past the last note's trigger time so its full sustain+release tail
  // isn't cut off — live playback never has to worry about this (the Transport just
  // keeps going), but an offline render has a fixed buffer length decided up front.
  const tailPadding = Tone.Time(dur).toSeconds() + release + 0.5
  const renderDuration = totalDuration + tailPadding

  return Tone.Offline(async () => {
    const chain = await buildEffectsChain(instrumentType, ambience)
    const sampler = await createSampler(buffers, instrumentType)
    if (chain.firstStage) sampler.connect(chain.firstStage)
    else sampler.toDestination()

    events.forEach((event) => {
      const total = event.notes.length
      event.notes.forEach((midi, noteIdx) => {
        const vel = humanVelocity(0.72, noteIdx, total)
        sampler.triggerAttackRelease(
          midiToTone(midi),
          dur,
          event.time + noteIdx * interval,
          vel
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
  if (!instrument || !isLoaded.value) return

  // Belt-and-suspenders alongside the 'resume' listener above: if the context is still
  // suspended for any reason (the listener hasn't fired yet, or this platform doesn't
  // emit it), retry once the resume completes rather than silently scheduling into a
  // dead context.
  if (Tone.getContext().state !== 'running') {
    logDiag('playCluster.contextNotRunning', { state: Tone.getContext().state })
    recoveryStatus.value = 'recovering'
    startToneWithTimeout().then(
      () => {
        recoveryStatus.value = 'idle'
        safeRecoveryReplay('playCluster', () => playCluster(cluster, settings, onComplete))
      },
      (err) => {
        logDiag('playCluster.toneStart.fail', { err: String(err) })
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

  notes.forEach((midi, i) => {
    const vel = humanVelocity(0.72, i, notes.length)
    instrument!.triggerAttackRelease(
      midiToTone(midi),
      dur,
      now + i * interval,
      vel
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
  loop = true
): void {
  if (!instrument || !isLoaded.value || sequence.length === 0) return

  // See playCluster() above — same resume-and-retry guard against a suspended context.
  // Deliberately ahead of the debounce check below: it stamps lastPlaySequenceTime, which
  // would otherwise make the retried call swallow itself as a false "too-soon" repeat.
  if (Tone.getContext().state !== 'running') {
    logDiag('playSequence.contextNotRunning', { state: Tone.getContext().state })
    recoveryStatus.value = 'recovering'
    startToneWithTimeout().then(
      () => {
        recoveryStatus.value = 'idle'
        safeRecoveryReplay('playSequence', () => playSequence(sequence, settings, loop))
      },
      (err) => {
        logDiag('playSequence.toneStart.fail', { err: String(err) })
        recoveryStatus.value = 'failed'
      }
    )
    return
  }

  const now = Date.now()
  if (now - lastPlaySequenceTime < 100) return
  lastPlaySequenceTime = now

  stopLoop()

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

  const events = sequence.flatMap((cluster, i) =>
    buildClusterEvents(
      cluster,
      settings.direction,
      interval,
      clusterDuration,
      settings.latch ?? false
    ).map((e) => ({ time: i * clusterDuration + e.time, notes: e.notes }))
  )

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
      instrument!.triggerAttackRelease(
        midiToTone(midi),
        dur,
        time + noteIdx * interval,
        vel
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

  // When not looping, stop cleanly after one pass
  if (!loop) {
    transport.scheduleOnce(() => {
      stopLoop()
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
    if (Tone.getContext().state !== 'running') {
      logDiag('tick.contextNotRunning', { state: Tone.getContext().state })
      if (recoveryStartedAt === null) recoveryStartedAt = Date.now()
      recoveryStatus.value = 'recovering'
      rafId = null
      startToneWithTimeout().then(
        () => {
          if (playbackGeneration !== myGeneration) return
          logDiag('tick.toneStart.ok')
          recoveryStatus.value = 'idle'
          resetInstrumentVolume('tick.toneStart.ok')
          if (isPlaying.value) {
            safeRecoveryReplay('tick', () => playSequence(sequence, settings, loop))
          }
        },
        (err) => {
          if (playbackGeneration !== myGeneration) return
          // Confirmed on-device (Paul, 2026-10-05 diagnostic log): this rejects with
          // InvalidStateError while the app is still backgrounded (a retry attempted the
          // instant "not running" is detected is often premature — Tone.start() can't
          // actually resume until iOS hands audio focus back), or — confirmed in a second
          // diagnostic log the same day — the promise can hang and never settle at all,
          // which is what startToneWithTimeout() above exists to catch and turn into this
          // same rejection path. Previously a rejection here just logged and gave up,
          // leaving rafId null forever with no further attempt — even once the *real*
          // resume succeeded moments later (the app-level 'resume' handler's own
          // Tone.start() call), nothing ever told this dead loop to check again. Now it
          // keeps retrying every ~500ms instead of dying after one failure — cheap (a
          // timer, not a tight loop) and self-limiting (stops as soon as isPlaying goes
          // false, e.g. the user gives up and hits stop, or the recovery timeout below
          // gives up on its own).
          logDiag('tick.toneStart.fail', { err: String(err) })
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

    if (recoveryStartedAt !== null) {
      // Context is running again, but we can't tell from here whether this tick()'s own
      // retry just fixed it, or the module-level App.addListener('resume', ...) handler
      // above won the race first — confirmed on-device (Paul, 2026-10-07 diagnostic log):
      // that handler only resumes the raw context and resets volume, it never rebuilds the
      // Transport/Part schedule, assuming the already-scheduled loop just keeps going. When
      // it wins the race, the context reports 'running' but the existing schedule doesn't
      // actually produce audible sound again — and nothing was clearing recoveryStatus
      // either, leaving the toast stuck even on a cycle that otherwise looked recovered.
      // Always doing a full rebuild the first time this tick() notices the context is back
      // — the same safeRecoveryReplay() an in-tick recovery already does — guarantees the
      // reliable, heavy recovery runs exactly once per real interruption, regardless of
      // which path noticed the context was healthy again first.
      recoveryStartedAt = null
      recoveryStatus.value = 'idle'
      if (isPlaying.value) {
        safeRecoveryReplay('tick', () => playSequence(sequence, settings, loop))
      }
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
  if (outputFilter) {
    outputFilter.dispose()
    outputFilter = null
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
