<script setup>
// Ctrl/Cmd+K palette: pages, actions, orders and shipments search.
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import { t } from '../i18n/index.js'
import { db } from '../store/db.js'
import { flatNav } from '../nav.js'
import { isPlatformAdmin } from '../store/session.js'
import { pushLayer, popLayer } from './layers.js'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['update:open'])
const router = useRouter()
const query = ref('')
const active = ref(0)
const input = ref(null)
let layerId = null

function close() { emit('update:open', false) }

watch(() => props.open, async v => {
  if (v) {
    query.value = ''
    active.value = 0
    layerId = pushLayer(close)
    await nextTick()
    input.value?.focus()
  } else if (layerId) { popLayer(layerId); layerId = null }
})
onBeforeUnmount(() => { if (layerId) popLayer(layerId) })

const norm = s => (s ?? '').toString().toLocaleLowerCase('tr')

// The platform administrator only reaches admin pages: no shipment/order actions or record search.
const actions = computed(() => isPlatformAdmin() ? [] : [
  { kind: 'action', icon: 'plus', label: t('palette.newShipment'), hint: 'N', go: { name: 'shipment-new' } },
  { kind: 'action', icon: 'list', label: t('palette.newOrder'), go: { name: 'order-new' } },
  { kind: 'action', icon: 'sync', label: t('palette.syncStores'), go: { name: 'orders', query: { sync: '1' } } },
  { kind: 'action', icon: 'wallet', label: t('palette.topUp'), go: { name: 'billing', query: { topup: '1' } } },
])

const pages = computed(() => flatNav().map(n => {
  const r = router.getRoutes().find(x => x.name === n.name)
  return { kind: 'page', icon: n.icon, label: t(r?.meta?.title ?? n.name), hint: t(`nav.groups.${n.group}`), go: { name: n.name } }
}))

const results = computed(() => {
  const q = norm(query.value.trim())
  const sections = []
  const match = s => !q || norm(s).includes(q)
  const act = actions.value.filter(a => match(a.label))
  const pg = pages.value.filter(p => match(p.label) || match(p.hint))
  if (act.length) sections.push({ title: t('palette.actions'), items: act.slice(0, 5) })
  if (pg.length) sections.push({ title: t('palette.pages'), items: pg.slice(0, q ? 8 : 6) })
  if (q.length >= 2 && !isPlatformAdmin()) {
    const orders = db.all('orders').filter(o =>
      norm(o.id).includes(q) || norm(o.channelOrderNo).includes(q) || norm(o.customer?.name).includes(q) || norm(o.customer?.email).includes(q),
    ).slice(0, 5).map(o => ({ kind: 'order', icon: 'list', label: `${o.id} · ${o.customer?.name ?? ''}`, hint: `${o.shipTo?.city ?? ''}, ${o.shipTo?.state ?? ''}`, go: { name: 'order-detail', params: { id: o.id } } }))
    const ships = db.all('shipments').filter(s =>
      norm(s.id).includes(q) || norm(s.trackingNo).includes(q) || norm(s.to?.name).includes(q),
    ).slice(0, 5).map(s => ({ kind: 'shipment', icon: 'box', label: `${s.id} · ${s.to?.name ?? ''}`, hint: s.trackingNo, go: { name: 'shipment-detail', params: { id: s.id } } }))
    if (orders.length) sections.push({ title: t('palette.orders'), items: orders })
    if (ships.length) sections.push({ title: t('palette.shipments'), items: ships })
  }
  let i = 0
  for (const s of sections) for (const it of s.items) it.index = i++
  return sections
})

const flat = computed(() => results.value.flatMap(s => s.items))
watch(query, () => { active.value = 0 })

function run(item) {
  if (!item) return
  close()
  router.push(item.go)
}

function onKey(e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); active.value = Math.min(flat.value.length - 1, active.value + 1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); active.value = Math.max(0, active.value - 1) }
  else if (e.key === 'Enter') { e.preventDefault(); run(flat.value[active.value]) }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="pal">
      <div v-if="open" class="overlay" @mousedown.self="close">
        <div class="pal" role="dialog" aria-modal="true" :aria-label="t('palette.title')">
          <div class="search">
            <Icon name="search" :size="16" />
            <input ref="input" v-model="query" :placeholder="t('palette.placeholder')" :aria-label="t('palette.placeholder')" @keydown="onKey" />
            <kbd>Esc</kbd>
          </div>
          <div class="list">
            <div v-if="!flat.length" class="empty">{{ t('palette.noResults') }}</div>
            <div v-for="s in results" :key="s.title" class="sec">
              <div class="sec-title mono">{{ s.title }}</div>
              <button
                v-for="it in s.items" :key="it.kind + it.label"
                :class="['item', { on: it.index === active }]"
                @mouseenter="active = it.index" @click="run(it)"
              >
                <Icon :name="it.icon" :size="14" class="ic" />
                <span class="lbl truncate">{{ it.label }}</span>
                <span v-if="it.hint" class="hint mono truncate">{{ it.hint }}</span>
              </button>
            </div>
          </div>
          <div class="foot mono">{{ t('palette.hint') }}</div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; z-index: 950; background: oklch(0.2 0.02 265 / 0.3); display: flex; justify-content: center; align-items: flex-start; padding: 12vh 16px 16px; }
.pal { width: 100%; max-width: 620px; background: var(--surface); border-radius: var(--r-lg); box-shadow: var(--shadow-lg); overflow: hidden; }
.search { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--line-1); color: var(--ink-3); }
.search input { flex: 1; border: 0; outline: 0; font: inherit; font-size: 15px; color: var(--ink-1); background: transparent; }
kbd { font-family: var(--font-mono); font-size: 11px; padding: 2px 6px; border: 1px solid var(--line-2); border-radius: 5px; color: var(--ink-3); }
.list { max-height: 52vh; overflow-y: auto; padding: 6px; }
.sec-title { font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-4); padding: 10px 10px 4px; }
.item { width: 100%; display: flex; align-items: center; gap: 10px; padding: 9px 10px; border: 0; background: transparent; border-radius: 8px; text-align: left; font-size: 14px; }
.item.on { background: var(--accent-soft); color: var(--accent-ink); }
.ic { flex: none; color: var(--ink-3); }
.item.on .ic { color: var(--accent-ink); }
.lbl { flex: 1; min-width: 0; }
.hint { font-size: 11.5px; color: var(--ink-4); max-width: 40%; }
.empty { padding: 28px; text-align: center; color: var(--ink-3); }
.foot { font-size: 11px; color: var(--ink-4); padding: 8px 14px; border-top: 1px solid var(--line-1); background: var(--bg-2); }
.pal-enter-active, .pal-leave-active { transition: opacity .15s ease; }
.pal-enter-from, .pal-leave-to { opacity: 0; }
</style>
