<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '../../components/PageHeader.vue'
import Tabs from '../../components/Tabs.vue'
import FilterBar from '../../components/FilterBar.vue'
import EmptyState from '../../components/EmptyState.vue'
import Skeleton from '../../components/Skeleton.vue'
import { t, tx, fmt } from '../../i18n/index.js'
import { toast } from '../../components/toast.js'
import { confirm } from '../../components/confirm.js'
import { db } from '../../store/db.js'
import {
  listNotifications, unreadCount, markRead, markUnread, markAllRead, markUnreadMany,
  removeNotification, restoreNotification, clearRead,
} from '../../api/notifications.js'
import { apiErrorText, hasKey } from '../../components/shipments/helpers.js'

const router = useRouter()
const loading = ref(true)
const items = ref([])
const busy = ref('')

async function load(quiet = false) {
  if (!quiet) loading.value = true
  try { items.value = await listNotifications() } catch (e) { toast.error(apiErrorText(e)) } finally { loading.value = false }
}
// Keep in sync with changes made elsewhere (bell menu, new labels, syncs).
const signature = computed(() => db.all('notifications').map(n => `${n.id}:${n.read ? 1 : 0}`).join(','))
let syncTimer = null
watch(signature, () => { if (!loading.value) { clearTimeout(syncTimer); syncTimer = setTimeout(() => load(true), 150) } })

// ---- tabs + filters
const tab = ref('all')
const unread = computed(() => unreadCount())
const tabs = computed(() => [
  { key: 'all', label: t('notifications.tabs.all'), count: db.all('notifications').length },
  { key: 'unread', label: t('notifications.tabs.unread'), count: unread.value },
])
const search = ref('')
const filters = ref({ type: [] })
const TYPE_ICON = {
  address: 'pin', adjustment: 'scale', forecast: 'chart', pricing: 'dollar', integration: 'store', manifest: 'file', wallet: 'wallet',
  refund: 'return', system: 'server', country: 'globe', tests: 'flask', success: 'check-circle', warning: 'alert', error: 'x-circle', info: 'info',
}
const TYPE_TONE = { success: 'success', refund: 'success', warning: 'warning', adjustment: 'warning', address: 'warning', error: 'danger', forecast: 'accent', pricing: 'accent' }
const typeLabel = ty => (hasKey('notifications.types.' + ty) ? t('notifications.types.' + ty) : ty)
const chips = computed(() => {
  const m = new Map()
  for (const n of items.value) m.set(n.type, (m.get(n.type) ?? 0) + 1)
  return [{ key: 'type', label: t('notifications.filters.type'), icon: 'filter', options: [...m.keys()].sort().map(k => ({ value: k, label: typeLabel(k), count: m.get(k) })) }]
})
const hasFilters = computed(() => !!search.value || (filters.value.type ?? []).length > 0)
function clearFilters() { search.value = ''; filters.value = { type: [] } }

const rows = computed(() => {
  const q = search.value.trim().toLowerCase()
  return items.value.filter(n => {
    if (tab.value === 'unread' && n.read) return false
    if (filters.value.type?.length && !filters.value.type.includes(n.type)) return false
    if (q && ![tx(n.title), tx(n.body)].some(v => String(v ?? '').toLowerCase().includes(q))) return false
    return true
  })
})

// ---- day groups
function dayKey(iso) {
  const d = new Date(iso)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000)
  if (diff <= 0) return 'today'
  if (diff === 1) return 'yesterday'
  if (diff < 7) return 'week'
  return 'older'
}
const groups = computed(() => {
  const order = ['today', 'yesterday', 'week', 'older']
  const g = Object.fromEntries(order.map(k => [k, []]))
  for (const n of rows.value) g[dayKey(n.at)].push(n)
  return order.filter(k => g[k].length).map(k => ({ key: k, label: t('notifications.groups.' + k), items: g[k] }))
})

// ---- actions
async function open(n) {
  if (!n.read) { try { await markRead(n.id) } catch {} }
  if (n.link) router.push(n.link)
  else load(true)
}
async function toggleRead(n) {
  busy.value = n.id
  try {
    if (n.read) { await markUnread(n.id); toast.info(t('notifications.toast.unread')) }
    else {
      await markRead(n.id)
      toast.info(t('notifications.toast.read'), { action: { label: t('common.undo'), onClick: async () => { await markUnread(n.id); load(true) } } })
    }
    await load(true)
  } catch (e) { toast.error(apiErrorText(e)) } finally { busy.value = '' }
}
async function remove(n) {
  busy.value = n.id
  try {
    const r = await removeNotification(n.id)
    await load(true)
    toast.info(t('notifications.toast.removed'), { action: { label: t('common.undo'), onClick: async () => { await restoreNotification(r.removed); load(true) } } })
  } catch (e) { toast.error(apiErrorText(e)) } finally { busy.value = '' }
}
async function readAll() {
  busy.value = 'all'
  try {
    const r = await markAllRead()
    await load(true)
    if (!r.ids.length) toast.info(t('notifications.toast.nothingUnread'))
    else toast.success(t('notifications.toast.allRead', { n: r.ids.length }), { action: { label: t('common.undo'), onClick: async () => { await markUnreadMany(r.ids); load(true) } } })
  } catch (e) { toast.error(apiErrorText(e)) } finally { busy.value = '' }
}
const readCount = computed(() => items.value.filter(n => n.read).length)
async function clearAllRead() {
  const ok = await confirm({ title: t('notifications.clear.title'), message: t('notifications.clear.message', { n: readCount.value }), confirmLabel: t('notifications.clear.confirm'), danger: true })
  if (!ok) return
  busy.value = 'clear'
  try {
    const r = await clearRead()
    await load(true)
    toast.success(t('notifications.toast.cleared', { n: r.removed.length }), {
      action: { label: t('common.undo'), onClick: async () => { for (const x of r.removed) await restoreNotification(x); load(true) } },
    })
  } catch (e) { toast.error(apiErrorText(e)) } finally { busy.value = '' }
}

onMounted(() => load())
</script>

<template>
  <div class="page page-narrow">
    <PageHeader :title="t('nav.notifications')" :subtitle="t('notifications.subtitle')">
      <template #actions>
        <button class="btn btn-ghost" :disabled="busy === 'clear' || !readCount" @click="clearAllRead"><Icon name="trash" :size="14" />{{ t('notifications.actions.clearRead') }}</button>
        <button class="btn btn-primary" :disabled="busy === 'all' || !unread" @click="readAll"><Icon name="check" :size="14" />{{ t('notifications.actions.readAll') }}</button>
      </template>
    </PageHeader>

    <Tabs v-model="tab" :tabs="tabs" :aria-label="t('nav.notifications')" class="tabs" />
    <FilterBar v-model:search="search" v-model:filters="filters" :chips="chips" :search-placeholder="t('notifications.searchPlaceholder')" class="fb" @clear="clearFilters" />

    <div v-if="loading" class="panel list">
      <div v-for="i in 6" :key="i" class="sk"><Skeleton variant="circle" :width="34" :height="34" /><Skeleton :lines="2" style="flex: 1" /></div>
    </div>
    <div v-else-if="!items.length" class="panel"><EmptyState icon="bell" :title="t('notifications.empty.title')" :description="t('notifications.empty.desc')" /></div>
    <div v-else-if="!rows.length" class="panel">
      <EmptyState v-if="hasFilters" icon="search" :title="t('common.emptyFiltered')" :description="t('notifications.empty.filtered')" :action-label="t('common.clearFilters')" action-variant="ghost" @action="clearFilters" />
      <EmptyState v-else icon="check-circle" :title="t('notifications.empty.allReadTitle')" :description="t('notifications.empty.allReadDesc')" :action-label="t('notifications.tabs.all')" action-variant="ghost" @action="tab = 'all'" />
    </div>
    <template v-else>
      <section v-for="g in groups" :key="g.key" class="group">
        <h2 class="g-title">{{ g.label }}</h2>
        <ul class="panel list" role="list">
          <li v-for="n in g.items" :key="n.id" class="item" :class="{ unread: !n.read }">
            <button type="button" class="item-main" @click="open(n)">
              <span class="ic" :class="'t-' + (TYPE_TONE[n.type] ?? 'neutral')"><Icon :name="TYPE_ICON[n.type] ?? 'bell'" :size="15" /></span>
              <span class="txt">
                <span class="title">{{ tx(n.title) }}</span>
                <span v-if="n.body" class="body">{{ tx(n.body) }}</span>
                <span class="meta"><span class="type">{{ typeLabel(n.type) }}</span> · <span :title="fmt.dateTime(n.at)">{{ fmt.relative(n.at) }}</span><template v-if="n.link"> · <span class="go">{{ t('notifications.open') }}<Icon name="chevron-right" :size="11" /></span></template></span>
              </span>
              <span v-if="!n.read" class="dot" :aria-label="t('notifications.unreadLabel')" />
            </button>
            <div class="acts">
              <button type="button" class="btn-icon" :disabled="busy === n.id" :aria-label="n.read ? t('notifications.actions.markUnread') : t('notifications.actions.markRead')" :title="n.read ? t('notifications.actions.markUnread') : t('notifications.actions.markRead')" @click="toggleRead(n)">
                <Icon :name="n.read ? 'mail' : 'check'" :size="14" />
              </button>
              <button type="button" class="btn-icon" :disabled="busy === n.id" :aria-label="t('notifications.actions.remove')" :title="t('notifications.actions.remove')" @click="remove(n)"><Icon name="trash" :size="14" /></button>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.page-narrow { max-width: 920px; }
.tabs { margin-bottom: 12px; }
.fb { margin-bottom: 14px; }
.list { list-style: none; margin: 0; padding: 0; overflow: hidden; }
.sk { display: flex; gap: 12px; align-items: center; padding: 14px 16px; border-bottom: 1px solid var(--line-1); }
.group { margin-bottom: 18px; }
.g-title { margin: 0 0 8px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-3); }
.item { display: flex; align-items: flex-start; gap: 8px; padding-right: 10px; border-bottom: 1px solid var(--line-1); transition: background .15s; }
.item:last-child { border-bottom: 0; }
.item:hover { background: var(--bg); }
.item.unread { background: color-mix(in oklch, var(--accent-soft) 35%, var(--surface)); }
.item-main { flex: 1; min-width: 0; display: flex; gap: 12px; align-items: flex-start; text-align: left; padding: 14px 6px 14px 16px; background: none; border: 0; cursor: pointer; color: inherit; font: inherit; border-radius: 0; }
.item-main:focus-visible { outline: none; box-shadow: inset 0 0 0 3px var(--accent-soft); }
.ic { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; flex: none; background: var(--bg-3); color: var(--ink-2); }
.ic.t-success { background: oklch(0.95 0.05 155); color: var(--success); }
.ic.t-warning { background: oklch(0.96 0.06 80); color: oklch(0.5 0.12 65); }
.ic.t-danger { background: oklch(0.95 0.04 25); color: var(--danger); }
.ic.t-accent { background: var(--accent-soft); color: var(--accent-ink); }
.txt { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
.title { font-weight: 600; font-size: 14px; color: var(--ink-1); }
.item:not(.unread) .title { font-weight: 500; }
.body { font-size: 13px; color: var(--ink-2); line-height: 1.45; }
.meta { font-size: 12px; color: var(--ink-3); }
.type { text-transform: none; }
.go { color: var(--accent); display: inline-flex; align-items: center; gap: 1px; }
.dot { width: 8px; height: 8px; border-radius: 999px; background: var(--accent); margin-top: 8px; flex: none; }
.acts { display: flex; gap: 2px; padding-top: 12px; opacity: .35; transition: opacity .15s; }
.item:hover .acts, .item:focus-within .acts { opacity: 1; }
@media (max-width: 860px) { .acts { opacity: 1; } }
</style>
