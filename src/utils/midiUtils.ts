import { Midi } from '@tonejs/midi'
import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import type { Cluster } from './noteUtils'
import { clusterLabel } from './noteUtils'

export type ArpeggioDirection = 'up' | 'down' | 'updown' | 'random' | 'chord'

export interface MidiExportOptions {
  bpm: number
  direction: ArpeggioDirection
  beatsPerBar: number  // one cluster occupies exactly this many beats — keeps downbeats grid-aligned
  subdivision: number  // arpeggio notes per beat (2 = 8th notes, 4 = 16th notes) — matches useAudioEngine's playback grid
  gapFraction: number  // fraction of one subdivision left silent before the next downbeat
}

const DEFAULT_OPTIONS: MidiExportOptions = {
  bpm: 80,
  direction: 'up',
  beatsPerBar: 4,
  subdivision: 4,
  gapFraction: 0.15,
}

function orderNotes(cluster: Cluster, direction: ArpeggioDirection): number[] {
  const sorted = [...cluster].sort((a, b) => a - b)
  switch (direction) {
    case 'down':
      return sorted.reverse()
    case 'updown': {
      const inner = sorted.slice(1, sorted.length - 1).reverse()
      return [...sorted, ...inner]
    }
    case 'random':
      return [...sorted].sort(() => Math.random() - 0.5)
    case 'up':
    case 'chord':
    default:
      return sorted
  }
}

// Export a sequence of clusters as a MIDI file: native share sheet inside the Capacitor
// shell (WKWebView ignores <a download>), plain browser download on the web
export async function exportSequenceAsMidi(
  sequence: Cluster[],
  options: Partial<MidiExportOptions> = {}
): Promise<void> {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  const midi = new Midi()
  midi.header.setTempo(opts.bpm)

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
    const notes = orderNotes(cluster, opts.direction)
    const barStart = barCursor * barSec

    if (opts.direction === 'chord') {
      notes.forEach(midi_note => {
        track.addNote({
          midi: midi_note,
          time: barStart,
          duration: barSec - gapSec,
          velocity: 0.75,
        })
      })
      barCursor += 1
      continue
    }

    // A cluster spans however many bars its grid needs to fit every voice —
    // coarse subdivisions never drop a note, they just take longer to state
    // the gesture. Last note holds through to the next downbeat.
    const barsNeeded = Math.max(1, Math.ceil(notes.length / subdivisionsPerBar))
    const clusterEnd = barStart + barsNeeded * barSec

    notes.forEach((midi_note, i) => {
      const isLast = i === notes.length - 1
      const noteStart = barStart + i * subdivisionSec
      track.addNote({
        midi: midi_note,
        time: noteStart,
        duration: isLast ? clusterEnd - noteStart - gapSec : subdivisionSec,
        velocity: 0.75,
      })
    })

    barCursor += barsNeeded
  }

  const bytes = midi.toArray()
  const filename = `eddy-${clusterLabel(sequence[0])}.mid`

  if (Capacitor.isNativePlatform()) {
    let binary = ''
    bytes.forEach(b => { binary += String.fromCharCode(b) })
    const { uri } = await Filesystem.writeFile({
      path: filename,
      data: btoa(binary),
      directory: Directory.Cache,
    })
    await Share.share({ url: uri, dialogTitle: 'export midi' })
    return
  }

  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/midi' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
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
