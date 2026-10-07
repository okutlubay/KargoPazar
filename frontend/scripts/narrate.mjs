#!/usr/bin/env node
// Turkish voice-over for the walkthrough video (edge-tts, tr-TR-AhmetNeural, rate -5%).
//
//   npm run narrate          generates recordings/audio/<step id>.mp3 and recordings/audio/durations.json
//
// The narration texts come from scripts/walkthrough/texts.json (the same file the recorder uses, single
// source of truth). Files are regenerated only when text, voice or rate change (hash per step).
// Durations are measured with ffprobe (PATH, FFPROBE_PATH / FFMPEG_PATH, or the WinGet Gyan.FFmpeg folder).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { findTool } from './walkthrough/tools.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const AUDIO = path.join(ROOT, 'recordings', 'audio')
const TEXTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'walkthrough', 'texts.json'), 'utf8'))
export const VOICE = process.env.TTS_VOICE || 'tr-TR-AhmetNeural'
export const RATE = process.env.TTS_RATE || '-5%'

const run = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
    if (err) { err.stderr = stderr; reject(err) } else resolve({ stdout, stderr })
  })
})

async function ttsCommand() {
  const candidates = [['edge-tts', []], ['python', ['-m', 'edge_tts']], ['py', ['-m', 'edge_tts']], ['python3', ['-m', 'edge_tts']]]
  for (const [cmd, pre] of candidates) {
    try { await run(cmd, [...pre, '--help']); return { cmd, pre } } catch {}
  }
  throw new Error('edge-tts not found (pip install edge-tts)')
}

export async function audioDuration(file) {
  const ffprobe = findTool('ffprobe')
  if (!ffprobe) throw new Error('ffprobe not found (set FFPROBE_PATH or FFMPEG_PATH)')
  const { stdout } = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file])
  const d = parseFloat(String(stdout).trim())
  if (!Number.isFinite(d)) throw new Error('could not read duration of ' + file)
  return d
}

export async function narrate({ log = console.log } = {}) {
  fs.mkdirSync(AUDIO, { recursive: true })
  const durFile = path.join(AUDIO, 'durations.json')
  let prev = {}
  try { prev = JSON.parse(fs.readFileSync(durFile, 'utf8')).steps ?? {} } catch {}
  let tts = null
  const steps = {}
  for (const [id, s] of Object.entries(TEXTS.steps)) {
    const text = String(s.narration ?? '').trim()
    if (!text) continue
    const hash = crypto.createHash('sha1').update(`${VOICE}|${RATE}|${text}`).digest('hex')
    const file = path.join(AUDIO, `${id}.mp3`)
    const cached = prev[id]
    if (cached?.hash === hash && fs.existsSync(file) && cached.durationSec > 0) {
      steps[id] = cached
      continue
    }
    tts ??= await ttsCommand()
    log(`TTS ${id} (${text.split(/\s+/).length} words)`)
    let ok = false
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        await run(tts.cmd, [...tts.pre, '--voice', VOICE, `--rate=${RATE}`, '--text', text, '--write-media', file])
        ok = true
      } catch (e) {
        if (attempt === 3) throw new Error(`edge-tts failed for step ${id}: ${e.stderr || e.message}`)
        await new Promise(r => setTimeout(r, 2000 * attempt))
      }
    }
    const durationSec = await audioDuration(file)
    steps[id] = { hash, file: path.basename(file), durationSec: Math.round(durationSec * 1000) / 1000, words: text.split(/\s+/).length }
  }
  const out = { voice: VOICE, rate: RATE, generatedAt: new Date().toISOString(), steps }
  fs.writeFileSync(durFile, JSON.stringify(out, null, 1))
  const total = Object.values(steps).reduce((n, s) => n + s.durationSec, 0)
  log(`Narration ready: ${Object.keys(steps).length} files, ${total.toFixed(1)} s total (${durFile})`)
  return out
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  narrate().catch(e => { console.error('narrate failed:', e?.message || e); process.exitCode = 1 })
}
