// Encodes a Web Audio AudioBuffer as 16-bit PCM WAV bytes — no dependency needed, a WAV
// file is just a fixed 44-byte RIFF/fmt/data header in front of raw interleaved samples.
// Chosen over MP3 for audio export: lossless, and what a DAW/looper import actually wants
// (Paul's stated use case — Loopy HD, AirDrop to a DAW) rather than a compressed format,
// which would also need an actual JS/WASM encoder dependency neither the web platform nor
// Tone.js provides natively.
export function encodeWav(buffer: AudioBuffer): Uint8Array {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const numFrames = buffer.length
  const bytesPerSample = 2 // 16-bit
  const blockAlign = numChannels * bytesPerSample
  const dataSize = numFrames * blockAlign
  const totalSize = 44 + dataSize

  const arrayBuffer = new ArrayBuffer(totalSize)
  const view = new DataView(arrayBuffer)

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  // RIFF/WAVE header
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  // fmt chunk
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)           // fmt chunk size (16 for PCM)
  view.setUint16(20, 1, true)            // format 1 = PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true) // byte rate
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bytesPerSample * 8, true)      // bits per sample
  // data chunk
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  // Interleave channels, converting float32 [-1, 1] to int16.
  const channelData: Float32Array[] = []
  for (let ch = 0; ch < numChannels; ch++) channelData.push(buffer.getChannelData(ch))

  let offset = 44
  for (let frame = 0; frame < numFrames; frame++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][frame]))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }

  return new Uint8Array(arrayBuffer)
}
