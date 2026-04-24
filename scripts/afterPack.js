/**
 * afterPack hook — replaces Electron's bundled ffmpeg.dll with the
 * official no-codec minimal build (build/ffmpeg.dll).
 *
 * The full Electron ffmpeg includes H.264/AAC codecs which Windows Defender
 * occasionally flags and quarantines, causing a startup "DLL missing" error.
 * The no-codec version is smaller, clean, and still satisfies Electron's
 * loader — this app has no audio/video features so no functionality is lost.
 */
const fs = require('fs')
const path = require('path')

module.exports = async ({ appOutDir }) => {
  const dest = path.join(appOutDir, 'ffmpeg.dll')
  const stub = path.join(__dirname, '../build/ffmpeg.dll')
  if (fs.existsSync(stub)) {
    fs.copyFileSync(stub, dest)
    console.log('  afterPack: replaced ffmpeg.dll with no-codec minimal build')
  }
}
