import { Midi } from '@tonejs/midi'
import type { Cluster } from './noteUtils'
import { clusterLabel } from './noteUtils'
import { buildArpeggioNotes, buildClusterEvents, humanVelocity } from './arpeggioEngine'
import { saveAndShareBytes } from './fileExport'

export type ArpeggioDirection = 'up' | 'down' | 'updown' | 'random' | 'chord'

export interface MidiExportOptions {
  bpm: number
  direction: ArpeggioDirection
  beatsPerBar: number  // one cluster occupies exactly this many beats — keeps downbeats grid-aligned
  subdivision: number  // arpeggio notes per beat (2 = 8th notes, 4 = 16th notes) — matches useAudioEngine's playback grid
  gapFraction: number  // fraction of one subdivision left silent before the next downbeat
  latch: boolean  // repeat the arpeggio to fill the whole bar, matching live playback's
    // latch toggle — see buildClusterEvents() in arpeggioEngine.ts. No effect on 'chord'
    // direction, same as live playback.
}

const DEFAULT_OPTIONS: MidiExportOptions = {
  bpm: 80,
  direction: 'up',
  beatsPerBar: 4,
  subdivision: 4,
  gapFraction: 0.15,
  latch: false,
}

// Export a sequence of clusters as a MIDI file: native share sheet inside the Capacitor
// shell (WKWebView ignores <a download>), plain browser download on the web.
//
// Note ordering, latch's repeat-to-fill-the-bar behavior, and per-note humanized velocity
// all come from arpeggioEngine.ts — the same functions live playback schedules from —
// rather than a separate reimplementation here, so an exported file always matches what
// was actually heard (was a flat, uniform velocity for every note until Paul flagged it
// sounding mechanical next to a WAV export of the same flow). One thing is deliberately
// still MIDI-specific and NOT shared: the guitar strum articulation on 'chord' direction
// (live-only — see chordInterval() in useAudioEngine.ts — so 'chord' stays simultaneous
// here regardless of instrument).
export async function exportSequenceAsMidi(
  sequence: Cluster[],
  options: Partial<MidiExportOptions> = {}
): Promise<void> {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  const midi = new Midi()
  midi.header.setTempo(opts.bpm)
  // @tonejs/midi has no setTimeSignature() convenience method — timeSignatures is a
  // directly-mutable array, and header.update() must be called after changing it for the
  // new value to actually take effect. Denominator is always 4 (both of Eddy's supported
  // meters, 4/4 and 3/4, are quarter-note-beat) — without this, a receiving DAW like Logic
  // Pro has no way to know the file isn't 4/4, regardless of how the notes are laid out.
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [opts.beatsPerBar, 4] })
  midi.header.update()

  const track = midi.addTrack()
  track.name = 'Eddy'

  const beatSec = 60 / opts.bpm
  const barSec = beatSec * opts.beatsPerBar
  const subdivisionsPerBar = opts.beatsPerBar * opts.subdivision
  const subdivisionSec = barSec / subdivisionsPerBar
  const gapSec = subdivisionSec * opts.gapFraction

  // barCursor tracks whole bars elapsed, so every cluster still starts on a
  // downbeat even when a coarse grid needs more than one bar to fit every voice.
  let barCursor = 0

  for (const cluster of sequence) {
    const barStart = barCursor * barSec

    if (opts.direction === 'chord') {
      const notes = buildArpeggioNotes(cluster, 'chord')
      const total = notes.length
      notes.forEach((midi_note, i) => {
        track.addNote({
          midi: midi_note,
          time: barStart,
          duration: barSec - gapSec,
          velocity: humanVelocity(0.72, i, total),
        })
      })
      barCursor += 1
      continue
    }

    // A cluster spans however many bars its grid needs to fit every voice —
    // coarse subdivisions never drop a note, they just take longer to state
    // the gesture (or, with latch, repeat to fill whatever bars that takes).
    const voiceCount = cluster.length
    const barsNeeded = Math.max(1, Math.ceil(voiceCount / subdivisionsPerBar))
    const clusterDuration = barsNeeded * barSec
    const clusterEnd = barStart + clusterDuration

    const events = buildClusterEvents(cluster, opts.direction, subdivisionSec, clusterDuration, opts.latch)
    // Flatten to a single ordered note list so "last note holds through to the next
    // downbeat" applies to the true last note of the cluster — whichever latch repeat
    // (or partial final pass) it falls in — not just the last note of a single pass.
    // Velocity is computed per-event (noteIdx/total relative to that one pass), matching
    // live playback's own per-pass taper exactly — not relative to the flattened list,
    // which would taper across an entire latched bar instead of resetting each repeat.
    const flatNotes = events.flatMap(event => {
      const total = event.notes.length
      return event.notes.map((midi_note, i) => ({
        time: event.time + i * subdivisionSec,
        midi_note,
        velocity: humanVelocity(0.72, i, total),
      }))
    })

    flatNotes.forEach((entry, i) => {
      const isLast = i === flatNotes.length - 1
      const noteStart = barStart + entry.time
      track.addNote({
        midi: entry.midi_note,
        time: noteStart,
        duration: isLast ? clusterEnd - noteStart - gapSec : subdivisionSec,
        velocity: entry.velocity,
      })
    })

    barCursor += barsNeeded
  }

  const filename = `eddy-${clusterLabel(sequence[0])}.mid`
  await saveAndShareBytes(midi.toArray(), filename, 'audio/midi', 'export midi')
}

// Export sequence as plain text (note names, one cluster per line)
export function exportSequenceAsText(sequence: Cluster[]): string {
  return sequence
    .map((cluster, i) => {
      const notes = [...cluster]
        .sort((a, b) => a - b)
        .map(midiToNoteName)
        .join('  ')
      return `${String(i + 1).padStart(2, ' ')}.  ${notes}`
    })
    .join('\n')
}

function midiToNoteName(midi: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const octave = Math.floor(midi / 12) - 1
  return `${names[midi % 12]}${octave}`
}
