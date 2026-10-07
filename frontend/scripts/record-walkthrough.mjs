#!/usr/bin/env node
// Automatic walkthrough video recorder for the KargoPazar demo (Teknopark / consultant presentation).
//
//   npm run narrate                  Turkish voice-over files (edge-tts, tr-TR-AhmetNeural, -5%), cached by text hash
//   npm run record                   runs narrate, then a headless recording: recordings/walkthrough.webm (silent),
//                                    walkthrough.mp4 (H.264 + AAC voice-over), voiceover.m4a, chapters.txt,
//                                    narration.md, narration.json, run-log.txt (STEPS=1,2 limits the steps)
//   npm run record:headed            visible browser, no recording (rehearsal)
//   npm run record:step -- 16        one step only (R&D item number, or open / compare / close), headed, no recording
//                                    (a comma list such as 2,3,4 or 'all' runs several steps; HEADLESS=1 hides the browser)
//
// Environment:
//   BASE_URL      default http://localhost:4173 (vite preview; started here when nothing listens and stopped at the end)
//   API_BASE_URL  default: VITE_API_BASE_URL from .env.production
//   FAST=0        disables the shortened holds used by record:step (default: full timing in record mode)
//   FFMPEG_PATH / FFPROBE_PATH  ffmpeg tools when not on PATH (the WinGet Gyan.FFmpeg folder is also searched)
//
// Timing and sync: a step's narration starts when its title band changes (the real offset is measured).
// On-screen duration = max(30 s, audio + 1.5 s lead-out, action time + audio). The screencast clock drifts a few
// percent from wall time, so wall times are mapped to video times through the transition cards (they cut in
// instantly and are detected in the video as dark frames). Overlaps of a step's narration with the next step
// are checked and logged (exit code 2 when found).
//
// Session decision (admin only screens): the recorder keeps ONE browser context and ONE page, so the video is a
// single file. The demo user signs in through the UI in the opening scene. Admin screens (R&D work packages,
// System Status, Rate Cards, Carriers, Country Configuration and the closing summary) need the platform admin;
// for those the recorder shows a short transition card and swaps the stored session token in the same tab
// (tokens are obtained once per run through the API and cached in recordings/.tokens.json while valid), then
// reloads /app/. This keeps the number of logins far below the backend limit (10 per 5 minutes per IP) and
// never touches the admin password. Presentation mode (sessionStorage kpz_demo:presentation) is written by the
// recorder before every step, so the app's own presentation strip shows the active R&D item in both sessions.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { spawn, spawnSync, execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildSteps } from './walkthrough/steps.mjs'
import { narrate } from './narrate.mjs'
import { findTool } from './walkthrough/tools.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'recordings')
const TEXTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'walkthrough', 'texts.json'), 'utf8'))
const ROADMAP = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'app', 'data', 'seed', 'roadmap.json'), 'utf8'))

const argv = process.argv.slice(2)
const MODE = argv.includes('--step') ? 'step' : argv.includes('--headed') ? 'headed' : 'record'
const STEP_ARG = MODE === 'step' ? (argv[argv.indexOf('--step') + 1] ?? argv.find(a => !a.startsWith('--'))) : (process.env.STEPS || null)
const RECORD = MODE === 'record'
const SHORT_HOLDS = MODE === 'step' ? process.env.FAST !== '0' : process.env.FAST === '1'
const BASE_URL = (process.env.BASE_URL || 'http://localhost:4173').replace(/\/+$/, '')
const LIVE_ORIGIN = 'https://www.kargopazar.com'
const API_BASE = (process.env.API_BASE_URL || readEnvApi() || 'https://mzzf2rnkui.us-east-1.awsapprunner.com/api').replace(/\/+$/, '')
const DEMO = { identifier: 'demo', password: 'Demo123!' }
const ADMIN = { identifier: 'admin', password: 'Istanbul34$' }

function readEnvApi() {
  try {
    const m = fs.readFileSync(path.join(ROOT, '.env.production'), 'utf8').match(/^VITE_API_BASE_URL=(.+)$/m)
    return m ? m[1].trim() : null
  } catch { return null }
}

fs.mkdirSync(OUT, { recursive: true })
const LOG_FILE = path.join(OUT, MODE === 'record' ? 'run-log.txt' : `run-log-${MODE}.txt`)
const logLines = []
function log(line) {
  const s = `[${new Date().toISOString().slice(11, 19)}] ${line}`
  logLines.push(s)
  console.log(s)
  try { fs.writeFileSync(LOG_FILE, logLines.join('\n') + '\n') } catch {}
}

// ---------------------------------------------------------------------------------------------------------------
// Preview server
async function portOpen(port) {
  return (await portOpenOn(port, '127.0.0.1')) || (await portOpenOn(port, '::1'))
}
function portOpenOn(port, host) {
  return new Promise(res => {
    const s = net.connect({ port, host })
    s.once('connect', () => { s.destroy(); res(true) })
    s.once('error', () => res(false))
    s.setTimeout(1000, () => { s.destroy(); res(false) })
  })
}

async function ensurePreview() {
  const u = new URL(BASE_URL)
  if (!['localhost', '127.0.0.1'].includes(u.hostname)) return null
  const port = Number(u.port || 80)
  if (await portOpen(port)) { log(`Preview server already listening on ${port}`); return null }
  if (!fs.existsSync(path.join(ROOT, 'dist', 'app', 'index.html'))) {
    log('dist missing: running npm run build')
    const b = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: true })
    if (b.status !== 0) throw new Error('build failed')
  }
  log(`Starting vite preview on ${port}`)
  const child = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' })
  for (let i = 0; i < 60; i++) {
    if (await portOpen(port)) return child
    await sleep(500)
  }
  stopPreview(child)
  throw new Error('preview server did not start')
}

function stopPreview(child) {
  if (!child) return
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else child.kill('SIGTERM')
  } catch {}
}

// ---------------------------------------------------------------------------------------------------------------
// API: tokens (cached while valid) and demo data reset
const TOKEN_FILE = path.join(OUT, '.tokens.json')
function readTokens() { try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')) } catch { return {} } }
function saveTokens(t) { try { fs.writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 1)) } catch {} }

async function apiLogin(cred) {
  const r = await fetch(API_BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cred) })
  if (!r.ok) throw new Error(`login ${cred.identifier} failed: HTTP ${r.status} ${await r.text().catch(() => '')}`)
  return r.json()
}

async function token(kind) {
  const all = readTokens()
  const t = all[kind]
  const minLeft = 90 * 60 * 1000 // keep at least 90 minutes of validity for a full run
  if (t?.token && Date.parse(t.expiresAt) - Date.now() > minLeft) {
    const ok = await fetch(API_BASE + '/auth/me', { headers: { Authorization: 'Bearer ' + t.token } }).then(r => r.status !== 401).catch(() => false)
    if (ok) return t
  }
  const res = await apiLogin(kind === 'admin' ? ADMIN : DEMO)
  all[kind] = { token: res.token, expiresAt: res.expiresAt, username: res.user?.username ?? (kind === 'admin' ? 'admin' : 'demo') }
  saveTokens(all)
  log(`API login (${kind})`)
  return all[kind]
}

async function resetDemoData() {
  const t = await token('demo')
  const r = await fetch(API_BASE + '/state/reset', { method: 'POST', headers: { Authorization: 'Bearer ' + t.token } })
  if (!r.ok) throw new Error(`reset failed: HTTP ${r.status}`)
  log('Demo data reset on the server (POST /state/reset)')
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers
const sleep = ms => new Promise(r => setTimeout(r, ms))
const rnd = (a, b) => a + Math.random() * (b - a)
const words = s => String(s || '').trim().split(/\s+/).filter(Boolean).length
function fmt(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m).padStart(2, '0')) + ':' + String(r).padStart(2, '0')
}

function wpCards() {
  const out = {}
  for (const it of ROADMAP) if (!out[it.wp]) out[it.wp] = { label: it.wpLabel, name: it.wpName.tr, months: it.wpMonths }
  return out
}

// ---------------------------------------------------------------------------------------------------------------
async function main() {
  const preview = await ensurePreview()
  let browser
  try {
    // Voice-over first (record mode): real audio durations drive the step timing.
    let audio = null
    if (RECORD && process.env.NO_NARRATE !== '1') audio = (await narrate({ log })).steps
    else { try { audio = JSON.parse(fs.readFileSync(path.join(OUT, 'audio', 'durations.json'), 'utf8')).steps } catch {} }
    const audioSec = (id, text) => audio?.[id]?.durationSec ?? words(text) * 0.65
    await resetDemoData()
    const adminTok = await token('admin')

    browser = await chromium.launch({ headless: RECORD || process.env.HEADLESS === '1', args: ['--window-size=1920,1080', '--hide-scrollbars', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] })
    const ctxOpts = {
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      acceptDownloads: true,
      locale: 'tr-TR',
      timezoneId: 'Europe/Istanbul',
    }
    if (RECORD) ctxOpts.recordVideo = { dir: path.join(OUT, 'raw'), size: { width: 1920, height: 1080 } }
    const context = await browser.newContext(ctxOpts)

    // CORS: the API only allows the live origin; answer preflights and add the header for any other origin.
    const pageOrigin = new URL(BASE_URL).origin
    if (pageOrigin !== LIVE_ORIGIN) {
      await context.route(url => url.href.startsWith(API_BASE), async route => {
        const req = route.request()
        const cors = {
          'access-control-allow-origin': pageOrigin,
          'access-control-allow-credentials': 'true',
          'access-control-allow-headers': req.headers()['access-control-request-headers'] || 'authorization,content-type,accept',
          'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
          'access-control-expose-headers': 'Retry-After',
          'access-control-max-age': '3600',
        }
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
        try {
          const headers = { ...req.headers() }
          delete headers.origin
          const response = await route.fetch({ headers })
          await route.fulfill({ response, headers: { ...response.headers(), ...cors } })
        } catch (e) {
          await route.abort().catch(() => {})
        }
      })
    }

    await context.addInitScript(() => {
      try {
        localStorage.setItem('kpz_demo:lang', 'tr')
        localStorage.setItem('kpz_lang', 'tr')
        localStorage.setItem('kpz_demo:currency', 'TRY')
      } catch {}
      window.__RECORDING__ = true
    })
    await context.addInitScript({ path: path.join(__dirname, 'walkthrough', 'overlay.js') })

    const t0 = Date.now() // video starts with the page; chapters are measured from here
    const page = await context.newPage()
    const consoleErrors = []
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 400)) })
    page.on('pageerror', e => consoleErrors.push('pageerror: ' + String(e?.message || e).slice(0, 400)))
    const downloads = []
    page.on('download', d => downloads.push(d))

    const h = createHelpers({ page, context, t0, adminTok, downloads })
    const steps = buildSteps(h)
    const wanted = STEP_ARG && STEP_ARG !== 'all' ? String(STEP_ARG).split(',') : null
    const selected = wanted ? steps.filter(s => wanted.includes(s.id)) : steps
    if (!selected.length) throw new Error(`unknown step "${STEP_ARG}" (use 1..23, open, compare, close)`)

    const timeline = [] // { id, title, startMs, audioMs, audioSec, text }
    const results = []
    const WP = wpCards()
    let lastWp = null

    for (const step of selected) {
      const tx = TEXTS.steps[step.id] ?? {}
      const started = Date.now()
      const stamp = started - t0
      const item = step.no ? ROADMAP.find(r => r.no === step.no) : null
      const title = item ? `${item.wpLabel} #${item.no} ${item.name.tr}` : tx.chapter
      h.stepId = step.id
      h.audioAt = null // set when this step's title band is first shown (narration starts there)
      log(`STEP ${step.id} start (${fmt(stamp)}) ${title}`)
      consoleErrors.length = 0
      let status = 'ok'
      let detail = ''
      try {
        // Session, work package card, title band, presentation state, start route (a known screen per step)
        const band = item ? { left: `${item.wpLabel} · #${item.no}`, center: item.name.tr } : { left: tx.bandLeft ?? '', center: tx.chapter ?? '' }
        const enter = async () => {
          await h.caption('')
          const pres = step.presentation === false ? false : item ? item.id : false
          if (step.route) await h.go(step.route, { presentation: pres })
          else await h.setPresentation(pres)
          if (!step.ownBand) await h.band(band)
        }
        const who = step.session ?? 'demo'
        if (item && item.wp !== lastWp) {
          const w = WP[item.wp]
          await h.card({ kicker: TEXTS.wpKicker.replace('{n}', w.label.replace('İP', '')), title: `${w.label}: ${w.name}`, sub: TEXTS.wpMonths.replace('{a}', w.months[0]).replace('{b}', w.months[1]) }, 2500, async () => {
            await h.ensureSession(who, { silent: true })
            await enter()
          })
          lastWp = item.wp
        } else if (who !== 'none' && who !== h.session && h.session !== null) {
          const c = TEXTS.sessionCards[who]
          await h.card({ kicker: c.kicker, title: c.title, sub: c.sub }, 2500, async () => {
            await h.ensureSession(who, { silent: true })
            await enter()
          })
        } else {
          await h.ensureSession(who, { silent: true })
          await enter()
        }
        await step.run({ item, tx, cap: (k, v) => h.caption(typeof k === 'string' && tx.captions?.[k] ? fill(tx.captions[k], v) : k) })
      } catch (e) {
        status = 'FAIL'
        detail = String(e?.message || e).split('\n')[0].slice(0, 300)
        const shot = path.join(OUT, `fail-${step.id}.png`)
        await page.screenshot({ path: shot }).catch(() => {})
        log(`STEP ${step.id} FAILED: ${detail} (screenshot ${path.basename(shot)})`)
      }
      // Hold: on-screen duration = max(30 s, audio + 1.5 s lead-out from the band change, action time + audio)
      const actionMs = Date.now() - started
      const aMs = Math.round(audioSec(step.id, tx.narration) * 1000)
      const audioAt = h.audioAt ?? started
      const endAt = Math.max(started + 30_000, audioAt + aMs + 1500, started + actionMs + aMs)
      const holdMs = SHORT_HOLDS ? 1500 : endAt - Date.now()
      await h.idle(holdMs)
      timeline.push({ id: step.id, title, startMs: stamp, audioMs: audioAt - t0, audioSec: aMs / 1000, text: tx.narration ?? '' })
      const toastErrors = await page.evaluate(() => window.__rec?.takeErrors?.() ?? []).catch(() => [])
      const errs = [...consoleErrors.filter(e => !/favicon/i.test(e)), ...toastErrors.map(t => 'toast: ' + t.text)]
      if (errs.length) log(`STEP ${step.id} errors: ${errs.join(' | ')}`)
      const dur = Date.now() - started
      results.push({ id: step.id, title, status, detail, errors: errs, dur })
      log(`STEP ${step.id} ${status} in ${(dur / 1000).toFixed(1)} s${errs.length ? `, ${errs.length} error(s)` : ''}`)
    }

    await h.caption('')
    await h.band(null)
    await sleep(800)
    const totalMs = Date.now() - t0
    const video = page.video()
    const closeAt = Date.now()
    await context.close()
    await browser.close()
    browser = null

    // Outputs
    const summary = results.map(r => `${r.status.padEnd(4)} ${r.id.padStart(7)}  ${(r.dur / 1000).toFixed(1).padStart(6)} s  ${r.title}${r.detail ? `  [${r.detail}]` : ''}${r.errors.length ? `  errors: ${r.errors.join(' | ')}` : ''}`)
    log('SUMMARY\n' + summary.join('\n'))
    log(`Total ${fmt(totalMs)}, ${results.filter(r => r.status === 'ok').length}/${results.length} steps ok, ${results.reduce((n, r) => n + r.errors.length, 0)} console/toast errors`)
    // Overlap check: each step's narration must end before the next step starts
    const overlaps = []
    for (let i = 0; i < timeline.length - 1; i++) {
      const a = timeline[i], b = timeline[i + 1]
      const end = a.audioMs + a.audioSec * 1000
      if (end > b.startMs) overlaps.push(`${a.id} audio ends ${fmt(end)} (${((end - b.startMs) / 1000).toFixed(2)} s) after step ${b.id} starts ${fmt(b.startMs)}`)
    }
    if (overlaps.length) log('OVERLAP CHECK FAILED: ' + overlaps.join(' | '))
    else log(`Overlap check passed: no narration overlaps the next step (${timeline.length} steps)`)
    if (RECORD) {
      let dst = null
      if (video) {
        const src = await video.path()
        dst = path.join(OUT, 'walkthrough.webm')
        try { fs.rmSync(dst, { force: true }) } catch {}
        fs.renameSync(src, dst)
        log(`Video: ${dst}`)
      }
      const mp4 = dst ? await encodeVideo(dst) : null
      // The screencast timeline does not run exactly at wall-clock speed (a few % drift), so wall times are
      // mapped to video times piecewise linearly, anchored at the start, at every full-screen transition card
      // (detected in the video as dark frames) and at the end.
      let toVideo = ms => ms
      if (mp4) {
        const videoMs = mp4.durationSec * 1000
        const wallMs = closeAt - t0
        const anchors = [[0, 0]]
        const dark = await detectCards(mp4.file)
        const cards = h.cardTimes
        if (dark.length === cards.length && cards.length) cards.forEach((c, i) => anchors.push([c, dark[i] * 1000]))
        else log(`Card anchors: ${dark.length} dark segments in video vs ${cards.length} cards shown, using linear scaling`)
        anchors.push([wallMs, videoMs])
        for (let i = 1; i < anchors.length; i++) if (anchors[i][1] <= anchors[i - 1][1] || anchors[i][0] <= anchors[i - 1][0]) { anchors.splice(1, anchors.length - 2); break }
        toVideo = ms => {
          let i = 1
          while (i < anchors.length - 1 && ms > anchors[i][0]) i++
          const [w0, v0] = anchors[i - 1], [w1, v1] = anchors[i]
          return Math.max(0, v0 + ((ms - w0) * (v1 - v0)) / (w1 - w0))
        }
        log(`Video length ${fmt(videoMs)} (${mp4.durationSec.toFixed(2)} s) vs wall clock ${(wallMs / 1000).toFixed(2)} s, ${anchors.length - 2} card anchors`)
      }
      const tl = timeline.map(t => ({ ...t, startMs: toVideo(t.startMs), audioMs: toVideo(t.audioMs) }))
      for (let i = 0; i < tl.length - 1; i++) {
        const end = tl[i].audioMs + tl[i].audioSec * 1000
        if (end > tl[i + 1].startMs) { overlaps.push(`video: ${tl[i].id} audio ends after ${tl[i + 1].id} starts`); log(`OVERLAP CHECK FAILED (video time): step ${tl[i].id}`) }
      }
      fs.writeFileSync(path.join(OUT, 'chapters.txt'), tl.map(t => `${fmt(t.startMs)} ${t.title}`).join('\n') + '\n')
      fs.writeFileSync(path.join(OUT, 'narration.md'), renderNarration(tl, totalMs))
      fs.writeFileSync(path.join(OUT, 'narration.json'), JSON.stringify(tl.map(t => ({ id: t.id, title: t.title, startSec: +(t.audioMs / 1000).toFixed(3), durationSec: t.audioSec, text: t.text, chapterStartSec: +(t.startMs / 1000).toFixed(3) })), null, 1))
      if (mp4) await muxVoiceover(mp4, tl)
    }
    if (overlaps.length) process.exitCode = 2
  } finally {
    if (browser) await browser.close().catch(() => {})
    stopPreview(preview)
  }
}

function fill(s, v) { return v ? String(s).replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '') : s }

function renderNarration(list, totalMs) {
  const out = ['# KargoPazar demo videosu: anlatım metni', '', `Toplam süre: ${fmt(totalMs)}`, '', 'Her başlıktaki zaman, seslendirmenin videodaki başlangıç anıdır (başlık şeridinin değiştiği an).', '']
  for (const n of list) out.push(`## ${fmt(n.audioMs)} ${n.title}`, '', `Bölüm başlangıcı ${fmt(n.startMs)} · seslendirme ${n.audioSec.toFixed(1)} sn`, '', n.text, '')
  return out.join('\n')
}

const runTool = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve({ stdout, stderr })))
})

async function probeDuration(file) {
  const ffprobe = findTool('ffprobe')
  const { stdout } = await runTool(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file])
  return parseFloat(String(stdout).trim())
}

/** webm -> silent H.264 mp4 (constant 25 fps). Returns { file, durationSec } or null when ffmpeg is missing. */
async function encodeVideo(webm) {
  const ffmpeg = findTool('ffmpeg')
  if (!ffmpeg || !findTool('ffprobe')) { log('WARNING: ffmpeg/ffprobe not found (PATH, FFMPEG_PATH or WinGet), walkthrough.mp4 was not created'); return null }
  const file = path.join(OUT, 'walkthrough-video.tmp.mp4')
  log('Encoding H.264 video')
  await runTool(ffmpeg, ['-y', '-v', 'error', '-i', webm, '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-fps_mode', 'cfr', '-r', '25', file])
  return { file, durationSec: await probeDuration(file) }
}

/** Start times (s) of full-screen transition cards: runs of dark frames lasting at least 1.2 s. */
async function detectCards(file) {
  const ffmpeg = findTool('ffmpeg')
  const { stdout } = await runTool(ffmpeg, ['-v', 'error', '-i', file, '-vf', 'fps=25,scale=64:36,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'])
  const lines = String(stdout).split(/\r?\n/)
  const out = []
  let t = null, runStart = null, last = null
  for (const line of lines) {
    const mt = line.match(/pts_time:([\d.]+)/)
    if (mt) { t = parseFloat(mt[1]); continue }
    const my = line.match(/YAVG=([\d.]+)/)
    if (!my || t == null) continue
    const dark = parseFloat(my[1]) < 60
    if (dark) { if (runStart == null) runStart = t; last = t }
    else if (runStart != null) { if (last - runStart >= 1.2) out.push(runStart); runStart = null }
  }
  if (runStart != null && last - runStart >= 1.2) out.push(runStart)
  return out
}

/** Places every step's mp3 at its measured start (adelay), mixes without normalisation, pads to the video length. */
async function muxVoiceover(mp4, tl) {
  const ffmpeg = findTool('ffmpeg')
  const parts = tl.map(t => ({ ...t, file: path.join(OUT, 'audio', `${t.id}.mp3`) })).filter(t => fs.existsSync(t.file))
  const m4a = path.join(OUT, 'voiceover.m4a')
  const out = path.join(OUT, 'walkthrough.mp4')
  if (!parts.length) { log('WARNING: no narration audio found, walkthrough.mp4 is silent'); fs.renameSync(mp4.file, out); return }
  const args = ['-y', '-v', 'error']
  for (const p of parts) args.push('-i', p.file)
  const chains = parts.map((p, i) => `[${i}:a]aresample=48000,adelay=delays=${Math.round(p.audioMs)}:all=1[a${i}]`)
  const mix = `${parts.map((_, i) => `[a${i}]`).join('')}amix=inputs=${parts.length}:normalize=0:dropout_transition=0,apad=whole_dur=${mp4.durationSec.toFixed(3)},atrim=0:${mp4.durationSec.toFixed(3)}[out]`
  args.push('-filter_complex', [...chains, mix].join(';'), '-map', '[out]', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', m4a)
  log('Building voice-over track')
  await runTool(ffmpeg, args)
  await runTool(ffmpeg, ['-y', '-v', 'error', '-i', mp4.file, '-i', m4a, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'copy', '-movflags', '+faststart', out])
  try { fs.rmSync(mp4.file, { force: true }) } catch {}
  const [v, a] = [await probeDuration(out), await probeDuration(m4a)]
  log(`MP4 with voice-over: ${out} (${v.toFixed(2)} s, voice track ${a.toFixed(2)} s)`)
  log(`Voice-over: ${m4a}`)
}

// ---------------------------------------------------------------------------------------------------------------
function createHelpers({ page, context, t0, adminTok, downloads }) {
  let current = null // 'demo' | 'admin' | null
  const appUrl = (route, bust = true) => `${BASE_URL}/app/${bust ? `?r=${Date.now().toString(36)}` : ''}#${route.startsWith('/') ? route : '/' + route}`
  let mouse = { x: 960, y: 540 }
  let shot = 0

  const h = {
    page, context, BASE_URL, API_BASE, TEXTS, ROADMAP, sleep, log, appUrl,
    get session() { return current },
    set session(v) { current = v },

    async overlay(patch) { await page.evaluate(p => window.__rec?.set(p), patch).catch(() => {}) },
    async band(b) {
      await h.overlay({ band: b ? { right: 'KargoPazar Demo', ...b } : null })
      if (b && h.audioAt == null) h.audioAt = Date.now() // narration of the current step starts with its band
    },
    async caption(text) {
      await h.overlay({ caption: text || '' })
      if (process.env.SHOTS === '1' && text) {
        await sleep(700)
        const dir = path.join(OUT, 'shots')
        fs.mkdirSync(dir, { recursive: true })
        shot += 1
        await page.screenshot({ path: path.join(dir, `${h.stepId}-${String(shot).padStart(2, '0')}.png`) }).catch(() => {})
      }
    },
    cardTimes: [],
    async card(card, ms = 2500, during) {
      await h.overlay({ card })
      h.cardTimes.push(Date.now() - t0)
      const s = Date.now()
      if (during) await during()
      await h.overlay({ card })
      if (process.env.SHOTS === '1') {
        await sleep(500)
        fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true })
        await page.screenshot({ path: path.join(OUT, 'shots', `${h.stepId}-card.png`) }).catch(() => {})
      }
      const left = ms - (Date.now() - s)
      if (left > 0) await sleep(left)
      await h.overlay({ card: null })
      await sleep(450)
    },

    /** Full page load of a panel route (fresh app state, presentation strip state re-read). */
    async go(route, { presentation } = {}) {
      if (presentation !== undefined) await h.setPresentation(presentation)
      await page.goto(appUrl(route), { waitUntil: 'domcontentloaded' })
      await h.appReady()
    },
    /** In-app hash navigation (no reload). */
    async nav(route) {
      await page.evaluate(r => { location.hash = '#' + r }, route)
      await h.settle()
    },
    async appReady() {
      await page.waitForFunction(() => !!document.querySelector('#app') && document.querySelector('#app').children.length > 0, null, { timeout: 30_000 })
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
      await h.settle()
    },
    async settle(ms = 600) {
      await page.waitForFunction(() => !document.querySelector('.skeleton, .sk, [aria-busy="true"]'), null, { timeout: 8000 }).catch(() => {})
      await sleep(ms)
    },
    async setPresentation(p) {
      await page.evaluate(v => {
        try {
          if (v) sessionStorage.setItem('kpz_demo:presentation', JSON.stringify({ on: true, itemId: v === true ? null : v }))
          else sessionStorage.removeItem('kpz_demo:presentation')
        } catch {}
      }, p).catch(() => {})
    },

    /** Make sure the page is signed in as `who`. Switching shows a transition card unless silent. */
    async ensureSession(who, { silent = false } = {}) {
      if (!who || who === 'none' || who === current) return
      if (!page.url().startsWith(BASE_URL)) {
        // single step runs start on about:blank: open the app origin first so storage can be written
        await page.goto(`${BASE_URL}/app/#/login`, { waitUntil: 'domcontentloaded' })
        silent = true
      }
      const run = async () => {
        const t = who === 'admin' ? adminTok : await token('demo')
        await page.evaluate(({ t, username }) => {
          const payload = JSON.stringify({ username, remember: false, token: t.token, expiresAt: Date.parse(t.expiresAt) })
          try {
            localStorage.removeItem('kpz_demo:session')
            sessionStorage.setItem('kpz_demo:session', payload)
            sessionStorage.removeItem('kpz_demo:rolePreview')
          } catch {}
        }, { t, username: who === 'admin' ? 'admin' : 'demo' })
        current = who
      }
      return run()
    },

    // ----- cursor and input -----
    async moveTo(x, y, ms = rnd(400, 700)) {
      const steps = Math.max(8, Math.round(ms / 16))
      await page.mouse.move(x, y, { steps })
      mouse = { x, y }
    },
    async point(target) {
      const loc = typeof target === 'string' ? page.locator(target).first() : target
      await loc.waitFor({ state: 'visible', timeout: 15_000 })
      await loc.scrollIntoViewIfNeeded().catch(() => {})
      await sleep(150)
      const box = await loc.boundingBox()
      if (!box) throw new Error('no bounding box for ' + (typeof target === 'string' ? target : 'locator'))
      await h.moveTo(box.x + box.width / 2, box.y + box.height / 2)
      return loc
    },
    async click(target, { delay = 250 } = {}) {
      const loc = await h.point(target)
      await sleep(120)
      const box = await loc.boundingBox()
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      } else {
        await loc.click()
      }
      await sleep(delay)
      return loc
    },
    async type(target, text, { clear = true } = {}) {
      const loc = await h.click(target, { delay: 120 })
      if (clear) { await loc.fill(''); await sleep(80) }
      for (const ch of String(text)) await page.keyboard.type(ch, { delay: 0 }).then(() => sleep(rnd(40, 70)))
      await sleep(200)
      return loc
    },
    async select(target, value) {
      const loc = await h.click(target, { delay: 150 })
      await loc.selectOption(value)
      await sleep(300)
      return loc
    },
    async scrollTo(target, { block = 'center' } = {}) {
      const loc = typeof target === 'string' ? page.locator(target).first() : target
      await loc.waitFor({ state: 'attached', timeout: 15_000 })
      await loc.evaluate((el, b) => el.scrollIntoView({ behavior: 'smooth', block: b }), block)
      await sleep(900)
      return loc
    },
    async scrollBy(dy) {
      await page.mouse.wheel(0, dy)
      await sleep(700)
    },
    async wait(target, timeout = 20_000) {
      const loc = typeof target === 'string' ? page.locator(target).first() : target
      await loc.waitFor({ state: 'visible', timeout })
      return loc
    },
    async idle(ms) {
      const end = Date.now() + Math.max(0, ms)
      while (Date.now() < end) {
        const left = end - Date.now()
        const dx = rnd(-60, 60), dy = rnd(-40, 40)
        const x = Math.min(1800, Math.max(120, mouse.x + dx)), y = Math.min(1000, Math.max(120, mouse.y + dy))
        await h.moveTo(x, y, Math.min(left, rnd(500, 900))).catch(() => {})
        await sleep(Math.min(Math.max(0, end - Date.now()), rnd(1200, 2200)))
      }
    },
    /** Waits for a download started by `action`, saves it, and shows a caption. */
    async download(action, captionTpl = TEXTS.pdfDownloaded) {
      const before = downloads.length
      const popupP = context.waitForEvent('page', { timeout: 8000 }).catch(() => null)
      const dlP = page.waitForEvent('download', { timeout: 15_000 }).catch(() => null)
      await action()
      const d = await dlP
      let name = null
      if (d) {
        name = d.suggestedFilename()
        fs.mkdirSync(path.join(OUT, 'downloads'), { recursive: true })
        await d.saveAs(path.join(OUT, 'downloads', name)).catch(() => {})
      } else {
        const popup = await popupP
        if (popup) { name = (await popup.url()).split('/').pop() || 'document.pdf'; await sleep(1500); await popup.close().catch(() => {}) }
      }
      if (!name && downloads.length > before) name = downloads[downloads.length - 1].suggestedFilename()
      if (!name) throw new Error('no download or popup detected')
      await h.caption(captionTpl.replace('{name}', name))
      log(`  download: ${name}`)
      return name
    },
  }
  return h
}

main().catch(e => { log('FATAL ' + (e?.stack || e)); process.exitCode = 1 })
