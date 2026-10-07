// Recording overlays injected into every page by scripts/record-walkthrough.mjs (page.addInitScript).
// Title band (top), caption box (bottom), visible cursor with click ring, full screen transition card.
// State lives in sessionStorage so it survives hash navigation and full page loads in the same tab.
// Every overlay uses pointer-events: none and the highest z-index, so the app stays clickable.
(() => {
  if (window.__rec) return
  const KEY = 'kpz_rec:overlay'
  const POS = 'kpz_rec:cursor'
  const Z = 2147483647

  const read = (k, d) => { try { return JSON.parse(sessionStorage.getItem(k)) ?? d } catch { return d } }
  const write = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)) } catch {} }

  let state = read(KEY, { band: null, caption: '', card: null })
  const errors = []
  let root = null
  let els = {}

  const css = `
  #kpz-rec-root, #kpz-rec-root * { box-sizing: border-box; pointer-events: none !important; }
  #kpz-rec-root { position: fixed; inset: 0; z-index: ${Z}; font-family: Inter, "Segoe UI", system-ui, sans-serif; }
  .kr-band { position: fixed; top: 0; left: 50%; transform: translate(-50%, -110%); width: min(1060px, 62vw); height: 40px;
    display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 16px; padding: 0 18px;
    background: rgba(12, 18, 32, .82); color: #fff; border-radius: 0 0 14px 14px; backdrop-filter: blur(6px);
    box-shadow: 0 6px 24px rgba(0,0,0,.25); transition: transform .45s ease, opacity .45s ease; opacity: 0; }
  .kr-band.on { transform: translate(-50%, 0); opacity: 1; }
  .kr-band.swap .kr-mid, .kr-band.swap .kr-left { opacity: 0; transform: translateY(-6px); }
  .kr-left { font-weight: 700; font-size: 15px; letter-spacing: .02em; color: #9fd0ff; transition: opacity .3s, transform .3s; white-space: nowrap; }
  .kr-mid { font-weight: 600; font-size: 15.5px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 760px; transition: opacity .3s, transform .3s; }
  .kr-right { text-align: right; font-size: 13px; opacity: .75; font-weight: 500; white-space: nowrap; }
  .kr-cap { position: fixed; left: 50%; bottom: 34px; transform: translate(-50%, 20px); max-width: 1100px; padding: 14px 26px;
    background: rgba(12, 18, 32, .86); color: #fff; font-size: 22px; font-weight: 500; line-height: 1.35; text-align: center;
    border-radius: 14px; box-shadow: 0 10px 34px rgba(0,0,0,.3); opacity: 0; transition: opacity .35s ease, transform .35s ease; }
  .kr-cap.on { opacity: 1; transform: translate(-50%, 0); }
  .kr-cursor { position: fixed; left: 0; top: 0; width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50%;
    background: rgba(255, 196, 0, .55); border: 2px solid rgba(255,255,255,.95); box-shadow: 0 0 0 1px rgba(0,0,0,.35), 0 3px 10px rgba(0,0,0,.35);
    transition: transform .08s ease; will-change: left, top; }
  .kr-cursor.down { transform: scale(.78); }
  .kr-ring { position: fixed; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%; border: 3px solid rgba(255, 170, 0, .95);
    animation: kr-ring .55s ease-out forwards; }
  @keyframes kr-ring { from { transform: scale(.6); opacity: 1; } to { transform: scale(3.2); opacity: 0; } }
  .kr-card { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px;
    background: radial-gradient(1200px 700px at 50% 40%, #1b2a4a, #0b1222 70%); color: #fff; opacity: 0; transition: opacity .45s ease; }
  .kr-card.on { opacity: 1; }
  .kr-card .k1 { font-size: 22px; letter-spacing: .28em; text-transform: uppercase; color: #9fd0ff; font-weight: 600; }
  .kr-card .k2 { font-size: 54px; font-weight: 700; text-align: center; max-width: 1400px; line-height: 1.15; }
  .kr-card .k3 { font-size: 22px; opacity: .8; text-align: center; max-width: 1200px; }
  .kr-card .bar { width: 120px; height: 4px; border-radius: 2px; background: #ffc400; }
  `

  function mount() {
    if (root && document.documentElement.contains(root)) return
    if (!document.body) return
    root = document.createElement('div')
    root.id = 'kpz-rec-root'
    root.innerHTML = `<style>${css}</style>
      <div class="kr-card"><div class="k1"></div><div class="bar"></div><div class="k2"></div><div class="k3"></div></div>
      <div class="kr-band"><div class="kr-left"></div><div class="kr-mid"></div><div class="kr-right"></div></div>
      <div class="kr-cap"></div>
      <div class="kr-cursor"></div>`
    document.body.appendChild(root)
    els = {
      band: root.querySelector('.kr-band'), left: root.querySelector('.kr-left'), mid: root.querySelector('.kr-mid'), right: root.querySelector('.kr-right'),
      cap: root.querySelector('.kr-cap'), cursor: root.querySelector('.kr-cursor'), card: root.querySelector('.kr-card'),
    }
    const p = read(POS, { x: 960, y: 540 })
    moveCursor(p.x, p.y)
    render(true)
  }

  function moveCursor(x, y) {
    if (!els.cursor) return
    els.cursor.style.left = x + 'px'
    els.cursor.style.top = y + 'px'
  }

  let lastBand = ''
  function render(initial) {
    if (!els.band) return
    const b = state.band
    if (b) {
      const sig = (b.left || '') + '|' + (b.center || '')
      const apply = () => {
        els.left.textContent = b.left || ''
        els.mid.textContent = b.center || ''
        els.right.textContent = b.right || ''
      }
      if (!initial && lastBand && sig !== lastBand) {
        els.band.classList.add('swap')
        setTimeout(() => { apply(); els.band.classList.remove('swap') }, 300)
      } else apply()
      lastBand = sig
      els.band.classList.add('on')
    } else {
      els.band.classList.remove('on')
      lastBand = ''
    }
    if (state.caption) { els.cap.textContent = state.caption; els.cap.classList.add('on') } else els.cap.classList.remove('on')
    const c = state.card
    if (c) {
      els.card.querySelector('.k1').textContent = c.kicker || ''
      els.card.querySelector('.k2').textContent = c.title || ''
      els.card.querySelector('.k3').textContent = c.sub || ''
      // cards cut in instantly (a sharp edge the recorder uses as a sync anchor) and fade out
      if (!els.card.classList.contains('on')) { els.card.style.transition = 'none'; els.card.classList.add('on'); void els.card.offsetWidth; els.card.style.transition = '' }
    } else els.card.classList.remove('on')
  }

  function set(patch) {
    state = { ...state, ...patch }
    write(KEY, state)
    mount()
    render(false)
  }

  // Error toast watcher: remembers error toasts so the recorder can log them.
  function watchToasts() {
    const sel = '.toast.error, .toast-error, [data-toast-type="error"], [role="alert"].error'
    const seen = new WeakSet()
    const scan = () => {
      for (const el of document.querySelectorAll(sel)) {
        if (seen.has(el)) continue
        seen.add(el)
        errors.push({ at: Date.now(), text: (el.textContent || '').trim().slice(0, 300) })
      }
    }
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true })
  }

  document.addEventListener('mousemove', e => { moveCursor(e.clientX, e.clientY); write(POS, { x: e.clientX, y: e.clientY }) }, true)
  document.addEventListener('mousedown', e => {
    els.cursor?.classList.add('down')
    if (!root) return
    const r = document.createElement('div')
    r.className = 'kr-ring'
    r.style.left = e.clientX + 'px'
    r.style.top = e.clientY + 'px'
    root.appendChild(r)
    setTimeout(() => r.remove(), 700)
  }, true)
  document.addEventListener('mouseup', () => els.cursor?.classList.remove('down'), true)

  window.__rec = { set, get: () => state, errors, takeErrors: () => errors.splice(0) }
  window.__RECORDING__ = true

  const boot = () => { mount(); watchToasts(); new MutationObserver(() => mount()).observe(document.documentElement, { childList: true }) }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
