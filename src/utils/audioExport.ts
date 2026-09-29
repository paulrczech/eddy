import type { Cluster } from './noteUtils'
import { clusterLabel } from './noteUtils'
import { saveAndShareBytes } from './fileExport'
import { encodeWav } from './wavEncoder'
import type { InstrumentType } from '../stores/settingsStore'
import type { PlaybackSettings } from '../composables/useAudioEngine'

// Renders a sequence to WAV and hands it to the same native-share/web-download plumbing
// MIDI export uses. Takes a bound renderSequenceToBuffer (from useAudioEngine()) rather
// than importing the singleton directly — this module has no reason to know it's a
// singleton, just that something can render a sequence to an offline buffer.
export async function exportSequenceAsWav(
  renderSequenceToBuffer: (
    sequence: Cluster[],
    instrumentType: InstrumentType,
    settings: PlaybackSettings,
    ambience: number
  ) => Promise<import('tone').ToneAudioBuffer>,
  sequence: Cluster[],
  instrumentType: InstrumentType,
  settings: PlaybackSettings,
  ambience: number
): Promise<void> {
  const toneBuffer = await renderSequenceToBuffer(sequence, instrumentType, settings, ambience)
  const audioBuffer = toneBuffer.get()
  if (!audioBuffer) throw new Error('audio render produced no buffer')

  const bytes = encodeWav(audioBuffer)
  const filename = `eddy-${clusterLabel(sequence[0])}.wav`
  await saveAndShareBytes(bytes, filename, 'audio/wav', 'export audio')
}
