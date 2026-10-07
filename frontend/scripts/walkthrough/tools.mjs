// Locates ffmpeg / ffprobe: explicit env vars, PATH, then the WinGet Gyan.FFmpeg package folder.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const EXE = process.platform === 'win32' ? '.exe' : ''

function onPath(name) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' })
  if (r.status !== 0) return null
  return String(r.stdout).split(/\r?\n/).map(s => s.trim()).find(Boolean) || null
}

function wingetBin() {
  const base = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages') : null
  if (!base || !fs.existsSync(base)) return null
  for (const pkg of fs.readdirSync(base).filter(d => /^Gyan\.FFmpeg/i.test(d))) {
    const dir = path.join(base, pkg)
    for (const sub of fs.readdirSync(dir)) {
      const bin = path.join(dir, sub, 'bin')
      if (fs.existsSync(path.join(bin, 'ffmpeg' + EXE))) return bin
    }
  }
  return null
}

/** 'ffmpeg' | 'ffprobe' -> absolute path or null */
export function findTool(name) {
  const envExact = process.env[name === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH']
  if (envExact) {
    if (fs.existsSync(envExact) && fs.statSync(envExact).isFile()) return envExact
    const inDir = path.join(envExact, name + EXE)
    if (fs.existsSync(inDir)) return inDir
  }
  if (process.env.FFMPEG_PATH) {
    const dir = fs.existsSync(process.env.FFMPEG_PATH) && fs.statSync(process.env.FFMPEG_PATH).isFile() ? path.dirname(process.env.FFMPEG_PATH) : process.env.FFMPEG_PATH
    const p = path.join(dir, name + EXE)
    if (fs.existsSync(p)) return p
  }
  const p = onPath(name)
  if (p) return p
  const bin = wingetBin()
  if (bin) return path.join(bin, name + EXE)
  return null
}
