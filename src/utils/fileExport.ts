import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

// Shared save/share plumbing for exported files (MIDI, WAV, ...) — native share sheet
// inside the Capacitor shell (WKWebView ignores <a download>), plain browser download on
// the web. Extracted out of midiUtils.ts when audio export needed the identical
// native/web branching a second time, rather than a second copy of it.
export async function saveAndShareBytes(
  bytes: Uint8Array,
  filename: string,
  mimeType: string,
  dialogTitle: string
): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    let binary = ''
    bytes.forEach(b => { binary += String.fromCharCode(b) })
    const { uri } = await Filesystem.writeFile({
      path: filename,
      data: btoa(binary),
      directory: Directory.Cache,
    })
    await Share.share({ url: uri, dialogTitle })
    return
  }

  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
