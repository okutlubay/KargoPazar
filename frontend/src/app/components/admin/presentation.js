// Presentation mode for the R&D work package walkthrough (spec 10.5).
// State lives in sessionStorage so it survives reloads but ends with the tab.
//
//   import { presentation, setPresentation, openItem, nextItem, roadmapItems } from '@/app/components/admin/presentation.js'
//   presentation.on          -> boolean
//   presentation.itemId      -> active roadmap item id ('RD-05') or null
//   openItem(router, id, linkIndex = 0)  -> navigates to that item's demo link and marks it active
//   nextItem(router) / prevItem(router)  -> walks the 23 items in order
import { reactive, watch } from 'vue'
import { db } from '../../store/db.js'

const KEY = 'kpz_demo:presentation'

function load() {
  try { return JSON.parse(sessionStorage.getItem(KEY)) ?? {} } catch { return {} }
}

const saved = load()
export const presentation = reactive({ on: !!saved.on, itemId: saved.itemId ?? null })

watch(() => [presentation.on, presentation.itemId], () => {
  try { sessionStorage.setItem(KEY, JSON.stringify({ on: presentation.on, itemId: presentation.itemId })) } catch {}
})

export function roadmapItems() {
  return [...db.all('roadmap')].sort((a, b) => a.no - b.no)
}

export function setPresentation(on) {
  presentation.on = !!on
  if (!on) presentation.itemId = null
}

export function activeItem() {
  if (!presentation.itemId) return null
  return db.get('roadmap', presentation.itemId) ?? null
}

export function openItem(router, id, linkIndex = 0) {
  const item = db.get('roadmap', id)
  if (!item) return
  presentation.itemId = id
  const link = item.demoLinks?.[linkIndex] ?? item.demoLinks?.[0]
  if (link) router.push(link.path)
}

function step(router, dir) {
  const items = roadmapItems()
  const i = items.findIndex(x => x.id === presentation.itemId)
  const next = items[i + dir]
  if (next) openItem(router, next.id)
  else router.push('/admin/rnd')
  return next ?? null
}
export const nextItem = router => step(router, 1)
export const prevItem = router => step(router, -1)

/** Route path of a demo link (links may carry a query, e.g. ?tab=customs). */
export function linkPath(link) { return String(link.path).split('?')[0] }

/** True when `path` is one of the item's demo screens. */
export function matchesItem(item, path) {
  if (!item) return false
  return (item.demoLinks ?? []).some(l => { const p = linkPath(l); return p === path || (p !== '/' && path.startsWith(p + '/')) })
}
