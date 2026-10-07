<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Wordmark from '@/components/Wordmark.vue'
import CommandPalette from '../components/CommandPalette.vue'
import PresentationBar from '../components/PresentationBar.vue'
import { t, tx, fmt, locale, setLocale } from '../i18n/index.js'
import { db } from '../store/db.js'
import { session, hasFeature, setRolePreview, ROLES, isPlatformAdmin, homeRoute } from '../store/session.js'
import { logout as apiLogout } from '../api/auth.js'
import { visibleNav } from '../nav.js'
import { toast } from '../components/toast.js'
import { confirm } from '../components/confirm.js'
import { hasLayers } from '../components/layers.js'
import { fx, CURRENCIES, setPanelCurrency } from '../store/currency.js'

const route = useRoute()
const router = useRouter()

const COLLAPSE_KEY = 'kpz_demo:ui:sidebar'
const collapsed = ref(false)
try { collapsed.value = localStorage.getItem(COLLAPSE_KEY) === '1' } catch {}
watch(collapsed, v => { try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0') } catch {} })

const mobileOpen = ref(false)
const paletteOpen = ref(false)
const bellOpen = ref(false)
const userOpen = ref(false)
const roleMenuOpen = ref(false)
const aiOpen = ref(route.path.startsWith('/ai'))

watch(() => route.fullPath, () => {
  mobileOpen.value = false
  bellOpen.value = false
  userOpen.value = false
  if (route.path.startsWith('/ai')) aiOpen.value = true
})

const routeTitle = name => {
  const r = router.getRoutes().find(x => x.name === name)
  return r ? t(r.meta.title) : name
}

function isActive(name) {
  if (route.name === name) return true
  const r = router.getRoutes().find(x => x.name === name)
  if (!r || name === 'overview') return false
  if (route.meta.parent === name) return true
  if (name === 'ai') return false
  if (name === 'customs' && route.name === 'customs-info') return false
  return route.path.startsWith(r.path.replace(/\/:.*$/, '') + '/')
}

const wallet = computed(() => db.doc('wallet'))
const notifications = computed(() => db.all('notifications'))
const unread = computed(() => notifications.value.filter(n => !n.read).length)
const latest = computed(() => notifications.value.slice(0, 8))
const user = computed(() => session.user)
// The platform administrator gets only the admin module: no wallet, notifications, settings or demo tools.
const platformAdmin = computed(() => isPlatformAdmin())
const nav = computed(() => visibleNav())
const initials = computed(() => (user.value?.name ?? 'D K').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase())

function markRead(n) {
  if (n.read) return
  db.update('notifications', n.id, { read: true })
  toast.info(t('shell.markedRead'), { action: { label: t('common.undo'), onClick: () => db.update('notifications', n.id, { read: false }) } })
}
function openNotification(n) {
  if (!n.read) db.update('notifications', n.id, { read: true })
  bellOpen.value = false
  if (n.link) router.push(n.link)
}
function markAllRead() {
  const ids = notifications.value.filter(n => !n.read).map(n => n.id)
  ids.forEach(id => db.update('notifications', id, { read: true }))
  toast.info(t('shell.markAllRead'), { action: { label: t('common.undo'), onClick: () => ids.forEach(id => db.update('notifications', id, { read: false })) } })
}

async function resetDemo() {
  userOpen.value = false
  const ok = await confirm({ title: t('shell.resetTitle'), message: t('shell.resetDesc'), confirmLabel: t('shell.resetDemo'), danger: true })
  if (!ok) return
  try { await db.reset() } catch { toast.error(t('sync.resetFailed')); return }
  try { sessionStorage.setItem('kpz_demo:flash', 'reset') } catch {}
  location.hash = '#/'
  location.reload()
}

async function logout() {
  userOpen.value = false
  await apiLogout()
  router.push({ name: 'login' })
  toast.info(t('shell.loggedOut'))
}

function previewRole(r) {
  setRolePreview(r)
  roleMenuOpen.value = false
  userOpen.value = false
}

function toggleLang() { setLocale(locale.value === 'tr' ? 'en' : 'tr') }

// Outside-click for dropdowns
function onDocClick(e) {
  if (!e.target.closest('.dd-bell')) bellOpen.value = false
  if (!e.target.closest('.dd-user')) { userOpen.value = false; roleMenuOpen.value = false }
}

// Keyboard shortcuts (spec 4.4)
let gPending = false
let gTimer = null
function isTyping(e) {
  const el = e.target
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}
function onKey(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); paletteOpen.value = !paletteOpen.value; return }
  if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey || hasLayers()) return
  const k = e.key.toLowerCase()
  if (gPending) {
    gPending = false
    clearTimeout(gTimer)
    if (k === 'o') router.push({ name: 'orders' })
    else if (k === 's') router.push({ name: 'shipments' })
    return
  }
  if (k === 'g') { gPending = true; gTimer = setTimeout(() => { gPending = false }, 900); return }
  if (k === 'n') { e.preventDefault(); router.push({ name: 'shipment-new' }) }
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  window.addEventListener('keydown', onKey)
  let flash = null
  try { flash = sessionStorage.getItem('kpz_demo:flash'); sessionStorage.removeItem('kpz_demo:flash') } catch {}
  if (flash === 'reset') toast.success(t('shell.resetDone'))
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  window.removeEventListener('keydown', onKey)
})

const sync = db.syncState
const syncKey = computed(() => (sync.status === 'error' ? 'error' : sync.status === 'saving' || sync.pending > 0 ? 'saving' : 'saved'))
const syncTitle = computed(() => (sync.lastSavedAt ? t('sync.lastSaved', { time: fmt.relative(sync.lastSavedAt) }) : t('sync.tip')))

const badgeOf = it => (typeof it.badge === 'function' ? it.badge() : null)
</script>

<template>
  <div :class="['shell', { collapsed, 'mobile-open': mobileOpen }]">
    <div class="scrim" @click="mobileOpen = false" />
    <aside class="side" :aria-label="t('shell.openMenu')">
      <div class="side-top">
        <RouterLink :to="homeRoute()" class="brand" :aria-label="t('nav.overview')">
          <Wordmark v-if="!collapsed" />
          <Icon v-else name="logo" :size="28" />
        </RouterLink>
        <button class="btn-icon collapse-btn hide-md" :aria-label="collapsed ? t('shell.expand') : t('shell.collapse')" @click="collapsed = !collapsed">
          <Icon name="sidebar" :size="15" />
        </button>
        <button class="btn-icon show-md" :aria-label="t('shell.closeMenu')" @click="mobileOpen = false"><Icon name="x" :size="14" /></button>
      </div>

      <nav class="side-nav">
        <div v-for="g in nav" :key="g.key" class="grp">
          <div class="grp-title mono">
            <span class="grp-label">{{ t(`nav.groups.${g.key}`) }}</span>
            <span v-if="g.platform" class="platform">{{ t('nav.platformBadge') }}</span>
          </div>
          <template v-for="it in g.items" :key="it.name">
            <component
              :is="it.children ? 'button' : 'RouterLink'"
              :to="it.children ? undefined : { name: it.name }"
              :class="['item', { active: isActive(it.name) && !it.children, open: it.children && aiOpen, parentActive: it.children && route.path.startsWith('/ai') }]"
              :title="collapsed ? routeTitle(it.name) : undefined"
              @click="it.children ? (aiOpen = !aiOpen, collapsed && router.push({ name: it.name })) : null"
            >
              <Icon :name="it.icon" :size="15" class="ic" />
              <span class="lbl">{{ routeTitle(it.name) }}</span>
              <Icon v-if="it.feature && !hasFeature(it.feature)" name="lock" :size="12" class="lock" />
              <span v-else-if="badgeOf(it)" :class="['count', it.badgeTone]">{{ badgeOf(it) }}</span>
              <Icon v-if="it.children" name="chevron-down" :size="12" class="chev" />
            </component>
            <div v-if="it.children && aiOpen && !collapsed" class="sub">
              <RouterLink :to="{ name: it.name }" :class="['item sub-item', { active: route.name === it.name }]">
                <span class="lbl">{{ t('nav.ai') }}</span>
              </RouterLink>
              <RouterLink v-for="c in it.children" :key="c.name" :to="{ name: c.name }" :class="['item sub-item', { active: isActive(c.name) }]">
                <span class="lbl">{{ routeTitle(c.name) }}</span>
                <span v-if="badgeOf(c)" class="count">{{ badgeOf(c) }}</span>
              </RouterLink>
            </div>
          </template>
        </div>
      </nav>
    </aside>

    <div class="main">
      <header class="top">
        <button class="btn-icon show-md" :aria-label="t('shell.openMenu')" @click="mobileOpen = true"><Icon name="menu" :size="16" /></button>
        <button class="search" @click="paletteOpen = true">
          <Icon name="search" :size="14" />
          <span class="ph hide-sm">{{ t('shell.searchPlaceholder') }}</span>
          <kbd class="hide-sm">{{ t('shell.searchHint') }}</kbd>
        </button>
        <span class="demo-badge" :title="t('common.demoTip')">{{ t('common.demo') }}</span>
        <button v-if="syncKey === 'error'" type="button" class="sync-ind err hide-sm" :title="t('sync.retryTip')" @click="db.retry()">
          <Icon name="alert" :size="12" /><span>{{ t('sync.status.error') }}</span><span class="sync-retry">{{ t('sync.retry') }}</span>
        </button>
        <span v-else :class="['sync-ind hide-sm', syncKey]" :title="syncTitle" role="status" aria-live="polite">
          <span class="sync-dot" /><span>{{ t(`sync.status.${syncKey}`) }}</span>
        </span>
        <div class="spacer" />
        <RouterLink v-if="!platformAdmin" :to="{ name: 'billing' }" class="bal" :title="t('shell.balance')">
          <Icon name="wallet" :size="14" />
          <span class="num">{{ fmt.money(wallet?.balance ?? 0) }}</span>
        </RouterLink>
        <select data-testid="app-currency" class="cur mono" :value="fx.display" :aria-label="t('fx.selector')" :title="t('fx.selector')" @change="setPanelCurrency($event.target.value)">
          <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
        </select>
        <button class="lang mono" :aria-label="t('shell.language')" @click="toggleLang">
          <span :class="{ on: locale === 'tr' }">TR</span><span class="sl">/</span><span :class="{ on: locale === 'en' }">EN</span>
        </button>
        <div v-if="!platformAdmin" class="dd dd-bell">
          <button class="btn-icon bell" :aria-label="t('shell.notifications')" @click="bellOpen = !bellOpen">
            <Icon name="bell" :size="16" />
            <span v-if="unread" class="dot-count">{{ unread }}</span>
          </button>
          <div v-if="bellOpen" class="menu bell-menu">
            <div class="menu-head">
              <strong>{{ t('shell.notifications') }}</strong>
              <button v-if="unread" class="btn-link" @click="markAllRead">{{ t('shell.markAllRead') }}</button>
            </div>
            <div v-if="!latest.length" class="menu-empty">{{ t('shell.noNotifications') }}</div>
            <div v-for="n in latest" :key="n.id" :class="['notif', { unread: !n.read }]">
              <button class="notif-main" @click="openNotification(n)">
                <span :class="['ndot', n.type]" />
                <span class="ntext">
                  <span class="ntitle">{{ tx(n.title) }}</span>
                  <span class="ntime">{{ fmt.relative(n.at ?? n.createdAt) }}</span>
                </span>
              </button>
              <button v-if="!n.read" class="btn-icon nread" :aria-label="t('shell.markedRead')" @click.stop="markRead(n)"><Icon name="check" :size="12" /></button>
            </div>
            <RouterLink :to="{ name: 'notifications' }" class="menu-foot">{{ t('shell.allNotifications') }}</RouterLink>
          </div>
        </div>
        <div class="dd dd-user">
          <button class="avatar" data-testid="user-menu-button" :aria-label="t('shell.profile')" @click="userOpen = !userOpen">{{ initials }}</button>
          <div v-if="userOpen" class="menu user-menu">
            <div class="menu-user">
              <div class="uname">{{ user?.name }}</div>
              <div class="umail">{{ user?.email }}</div>
              <div v-if="platformAdmin" class="ucomp">{{ t('shell.platformAdmin') }}</div>
              <div v-else class="ucomp">{{ user?.company?.name }} · {{ t(`plans.${session.plan}`) }}</div>
            </div>
            <template v-if="!platformAdmin">
              <RouterLink class="mi" :to="{ name: 'settings', params: { section: 'profile' } }"><Icon name="user" :size="14" />{{ t('shell.profile') }}</RouterLink>
              <RouterLink class="mi" :to="{ name: 'settings' }"><Icon name="settings" :size="14" />{{ t('shell.settings') }}</RouterLink>
              <button class="mi" data-testid="user-menu-roles" @click="roleMenuOpen = !roleMenuOpen"><Icon name="users" :size="14" />{{ t('shell.viewAsRole') }}<Icon name="chevron-right" :size="11" class="mr" /></button>
              <div v-if="roleMenuOpen" class="roles">
                <button v-for="r in ROLES" :key="r" :data-testid="'role-option-' + r" :class="['mi small', { on: session.effectiveRole === r }]" @click="previewRole(r)">
                  {{ t(`roles.${r}`) }}<Icon v-if="session.effectiveRole === r" name="check" :size="12" class="mr" />
                </button>
              </div>
              <RouterLink class="mi" :to="{ name: 'onboarding' }"><Icon name="wand" :size="14" />{{ t('shell.restartOnboarding') }}</RouterLink>
              <button class="mi" @click="resetDemo"><Icon name="refresh" :size="14" />{{ t('shell.resetDemo') }}</button>
              <div class="sep" />
            </template>
            <button class="mi" @click="logout"><Icon name="logout" :size="14" />{{ t('shell.logout') }}</button>
          </div>
        </div>
      </header>

      <div v-if="session.rolePreview && !platformAdmin" class="preview-bar">
        <Icon name="eye" :size="14" />
        <span>{{ t('shell.rolePreviewBar', { role: t(`roles.${session.rolePreview}`) }) }}</span>
        <button class="btn-link" data-testid="role-preview-exit" @click="setRolePreview(null)">{{ t('shell.exitPreview') }}</button>
      </div>
      <PresentationBar />

      <main class="content">
        <RouterView v-slot="{ Component }">
          <component :is="Component" :key="route.name === 'settings' ? 'settings' : route.fullPath" />
        </RouterView>
      </main>
    </div>

    <CommandPalette v-model:open="paletteOpen" />
  </div>
</template>

<style scoped>
.shell { --side-w: 240px; display: grid; grid-template-columns: var(--side-w) 1fr; min-height: 100vh; }
.shell.collapsed { --side-w: 64px; }
.side { position: sticky; top: 0; height: 100vh; background: var(--surface); border-right: 1px solid var(--line-1); display: flex; flex-direction: column; overflow: hidden; z-index: 30; }
.side-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 16px 14px 12px; }
.collapsed .side-top { flex-direction: column; padding: 14px 8px 10px; }
.brand { display: inline-flex; align-items: center; min-width: 0; }
.side-nav { flex: 1; overflow-y: auto; padding: 4px 10px 24px; }
.collapsed .side-nav { padding: 4px 8px 24px; }
.grp { margin-top: 14px; }
.grp-title { display: flex; align-items: center; gap: 6px; font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-4); padding: 0 8px 6px; white-space: nowrap; }
.collapsed .grp-label { display: none; }
.collapsed .grp-title { justify-content: center; border-top: 1px solid var(--line-1); padding-top: 10px; }
.platform { font-size: 9.5px; padding: 1px 6px; border-radius: 5px; background: var(--ink-1); color: var(--bg); letter-spacing: .04em; }
.collapsed .platform { display: none; }
.item { width: 100%; display: flex; align-items: center; gap: 10px; height: 34px; padding: 0 10px; border-radius: 8px; color: var(--ink-2); font-size: 13.5px; font-weight: 500; border: 0; background: transparent; text-align: left; white-space: nowrap; }
.item:hover { background: var(--bg-2); color: var(--ink-1); }
.item.active { background: var(--accent-soft); color: var(--accent-ink); }
.item.parentActive { color: var(--ink-1); }
.item .ic { flex: none; color: var(--ink-3); }
.item.active .ic { color: var(--accent-ink); }
.lbl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.collapsed .item { justify-content: center; padding: 0; }
.collapsed .item .lbl, .collapsed .item .count, .collapsed .item .chev, .collapsed .item .lock { display: none; }
.count { font-family: var(--font-mono); font-size: 11px; padding: 0 6px; height: 18px; line-height: 18px; border-radius: 999px; background: var(--bg-3); color: var(--ink-2); }
.count.danger { background: oklch(0.95 0.04 25); color: var(--danger); }
.lock { color: var(--ink-4); }
.chev { color: var(--ink-4); transition: transform .15s; }
.item.open .chev { transform: rotate(180deg); }
.sub { margin: 2px 0 4px 18px; padding-left: 10px; border-left: 1px solid var(--line-1); }
.sub-item { height: 30px; font-size: 13px; }

.main { min-width: 0; display: flex; flex-direction: column; --kpz-sticky-top: 56px; }
.top { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 10px; height: 56px; padding: 0 20px; background: color-mix(in oklch, var(--bg-2) 86%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--line-1); }
.search { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 10px; min-width: 280px; border: 1px solid var(--line-2); border-radius: 9px; background: var(--surface); color: var(--ink-3); font-size: 13px; }
.search:hover { border-color: var(--line-strong); }
.search .ph { flex: 1; text-align: left; }
.search kbd { font-family: var(--font-mono); font-size: 10.5px; padding: 1px 6px; border: 1px solid var(--line-2); border-radius: 5px; }
.spacer { flex: 1; }
.sync-ind { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px; border-radius: 999px; font-size: 11.5px; color: var(--ink-3); border: 1px solid transparent; background: transparent; white-space: nowrap; }
.sync-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--success); }
.sync-ind.saving .sync-dot { background: var(--warning); animation: syncp 1s ease-in-out infinite; }
.sync-ind.err { color: var(--danger); border-color: color-mix(in oklch, var(--danger) 35%, transparent); cursor: pointer; }
.sync-retry { text-decoration: underline; font-weight: 600; }
@keyframes syncp { 50% { opacity: .35; } }
.bal { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--line-2); background: var(--surface); font-size: 13px; font-weight: 600; }
.bal:hover { border-color: var(--line-strong); }
.lang { display: inline-flex; gap: 3px; height: 32px; align-items: center; padding: 0 8px; border: 1px solid var(--line-2); border-radius: 8px; background: var(--surface); font-size: 11.5px; color: var(--ink-4); }
.lang .on { color: var(--ink-1); font-weight: 600; }
.lang .sl { color: var(--line-strong); }
.cur { height: 32px; padding: 0 6px; border: 1px solid var(--line-2); border-radius: 8px; background: var(--surface); color: var(--ink-1); font-size: 11.5px; font-weight: 600; cursor: pointer; }
.cur:hover { border-color: var(--line-strong); }
.dd { position: relative; }
.bell { position: relative; }
.dot-count { position: absolute; top: 2px; right: 1px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px; background: var(--danger); color: white; font-size: 10px; font-weight: 600; display: grid; place-items: center; }
.avatar { width: 32px; height: 32px; border-radius: 999px; border: 0; background: var(--ink-1); color: var(--bg); font-size: 12px; font-weight: 600; letter-spacing: .02em; }
.menu { position: absolute; right: 0; top: calc(100% + 8px); background: var(--surface); border: 1px solid var(--line-1); border-radius: var(--r-md); box-shadow: var(--shadow-lg); z-index: 50; }
.bell-menu { width: 360px; max-width: calc(100vw - 24px); }
.menu-head { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--line-1); font-size: 13.5px; }
.menu-empty { padding: 24px; text-align: center; color: var(--ink-3); }
.notif { display: flex; align-items: flex-start; gap: 4px; padding: 4px 6px 4px 4px; border-bottom: 1px solid var(--line-1); }
.notif.unread { background: color-mix(in oklch, var(--accent-soft) 45%, transparent); }
.notif-main { flex: 1; display: flex; gap: 10px; align-items: flex-start; padding: 8px; border: 0; background: transparent; text-align: left; border-radius: 8px; }
.notif-main:hover { background: var(--bg-2); }
.ndot { flex: none; width: 8px; height: 8px; border-radius: 999px; margin-top: 6px; background: var(--accent); }
.ndot.warning { background: var(--warning); } .ndot.error { background: var(--danger); } .ndot.success { background: var(--success); }
.ntext { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ntitle { font-size: 13px; line-height: 1.4; color: var(--ink-1); }
.ntime { font-size: 11.5px; color: var(--ink-3); }
.nread { width: 26px; height: 26px; margin-top: 6px; }
.menu-foot { display: block; padding: 10px 14px; text-align: center; font-size: 13px; font-weight: 500; color: var(--accent); }
.user-menu { width: 260px; padding: 6px; }
.menu-user { padding: 10px 10px 12px; border-bottom: 1px solid var(--line-1); margin-bottom: 4px; }
.uname { font-weight: 600; }
.umail, .ucomp { font-size: 12px; color: var(--ink-3); }
.mi { width: 100%; display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 7px; border: 0; background: transparent; font-size: 13.5px; text-align: left; color: var(--ink-1); }
.mi:hover { background: var(--bg-2); }
.mi.small { padding-left: 34px; font-size: 13px; }
.mi.on { color: var(--accent-ink); font-weight: 600; }
.mr { margin-left: auto; color: var(--ink-4); }
.sep { height: 1px; background: var(--line-1); margin: 4px 0; }
.preview-bar { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 8px 16px; background: oklch(0.93 0.1 95); color: oklch(0.38 0.1 80); font-size: 13px; font-weight: 500; }
.content { flex: 1; min-width: 0; }
.show-md { display: none; }
.scrim { display: none; }

@media (max-width: 860px) {
  .shell, .shell.collapsed { grid-template-columns: 1fr; --side-w: 260px; }
  .side { position: fixed; left: 0; top: 0; bottom: 0; width: 260px; transform: translateX(-100%); transition: transform .2s ease; box-shadow: var(--shadow-lg); z-index: 60; }
  .mobile-open .side { transform: none; }
  .mobile-open .scrim { display: block; position: fixed; inset: 0; background: oklch(0.2 0.02 265 / 0.3); z-index: 55; }
  .collapsed .item .lbl, .collapsed .item .count, .collapsed .grp-label { display: initial; }
  .show-md { display: inline-flex; }
  .search { min-width: 0; }
  .top { padding: 0 12px; gap: 6px; }
  .bal span { display: none; }
}
</style>
