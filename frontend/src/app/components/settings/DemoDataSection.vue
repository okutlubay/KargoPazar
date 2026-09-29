<script setup>
import { ref, computed, onMounted } from 'vue'
import Icon from '@/components/Icon.vue'
import Card from '../Card.vue'
import Modal from '../Modal.vue'
import Spinner from '../Spinner.vue'
import ProgressBar from '../ProgressBar.vue'
import FileDrop from '../FileDrop.vue'
import { toast } from '../toast.js'
import { confirm } from '../confirm.js'
import { useI18n } from '../../i18n/index.js'
import { can } from '../../store/session.js'
import { storageInfo, exportState, importState, resetDemo } from '../../api/settings.js'
import { errorText, downloadText, formatBytes } from './util.js'

const { t, fmt } = useI18n()
const info = ref(storageInfo())
const refresh = () => { info.value = storageInfo() }
onMounted(refresh)
const locked = computed(() => !can('settings.manage'))
const bytes = n => formatBytes(n, (v, d = 0) => fmt.number(v, d))
const usedPct = computed(() => Math.min(100, (info.value.bytes / info.value.quotaBytes) * 100))
const showAll = ref(false)
const shown = computed(() => (showAll.value ? info.value.collections : info.value.collections.slice(0, 8)))

const resetting = ref(false)
async function reset() {
  const ok = await confirm({ title: t('shell.resetTitle'), message: t('settings.demo.resetConfirm'), confirmLabel: t('shell.resetDemo'), danger: true })
  if (!ok) return
  resetting.value = true
  try {
    await resetDemo()
    try { sessionStorage.setItem('kpz_demo:flash', 'reset') } catch {}
    location.hash = '#/'
    location.reload()
  } catch (e) { toast.error(errorText(e)); resetting.value = false }
}

const exporting = ref(false)
async function doExport() {
  exporting.value = true
  try {
    const { filename, json } = await exportState()
    downloadText(filename, json)
    toast.success(t('settings.demo.exported', { name: filename }))
    refresh()
  } catch (e) { toast.error(errorText(e)) } finally { exporting.value = false }
}

const importOpen = ref(false)
const file = ref(null)
const preview = ref(null)
const importError = ref('')
const importing = ref(false)
const drop = ref(null)
function openImport() { file.value = null; preview.value = null; importError.value = ''; importOpen.value = true }
function onFile(f) {
  importError.value = ''
  file.value = f
  try {
    const p = JSON.parse(f.text)
    if (!p || typeof p.data !== 'object') throw new Error('shape')
    preview.value = { version: p.version, exportedAt: p.exportedAt, collections: Object.keys(p.data).length, orders: Array.isArray(p.data.orders) ? p.data.orders.length : null, shipments: Array.isArray(p.data.shipments) ? p.data.shipments.length : null, balance: p.data.wallet?.balance ?? null }
    if (p.version !== info.value.seedVersion) importError.value = t('settings.errors.VERSION_MISMATCH', { version: p.version ?? '-', expected: info.value.seedVersion })
  } catch {
    preview.value = null
    importError.value = t('settings.errors.INVALID_EXPORT')
  }
}
async function doImport() {
  if (!file.value || importError.value) return
  const ok = await confirm({ title: t('settings.demo.importConfirmTitle'), message: t('settings.demo.importConfirm'), confirmLabel: t('settings.demo.import'), danger: true })
  if (!ok) return
  importing.value = true
  try {
    await importState(file.value.text)
    try { sessionStorage.setItem('kpz_demo:flash', 'import') } catch {}
    toast.success(t('settings.demo.imported'))
    setTimeout(() => location.reload(), 400)
  } catch (e) {
    importError.value = e?.code === 'VERSION_MISMATCH' ? t('settings.errors.VERSION_MISMATCH', { version: e.details?.version ?? '-', expected: info.value.seedVersion }) : errorText(e)
    importing.value = false
  }
}
</script>

<template>
  <div class="stack-lg">
    <Card :title="t('settings.demo.title')" :subtitle="t('sync.demo.desc')">
      <div class="facts">
        <div class="fact"><span class="fl">{{ t('settings.demo.seedVersion') }}</span><span class="fv mono">{{ info.seedVersion }}</span></div>
        <div class="fact"><span class="fl">{{ t('sync.demo.storage') }}</span><span class="fv mono">{{ bytes(info.bytes) }}</span></div>
        <div class="fact"><span class="fl">{{ t('sync.demo.collections') }}</span><span class="fv mono">{{ info.stored }}</span></div>
        <div class="fact"><span class="fl">{{ t('settings.demo.seedFiles') }}</span><span class="fv mono">{{ info.seedCollections }}</span></div>
      </div>
      <div class="quota">
        <ProgressBar :value="usedPct" :tone="usedPct > 80 ? 'danger' : usedPct > 60 ? 'warning' : 'accent'" size="sm" />
        <span class="hint">{{ t('sync.demo.quota', { used: bytes(info.bytes), total: bytes(info.quotaBytes), pct: fmt.number(usedPct, 1) }) }}</span>
      </div>
    </Card>

    <div class="grid-3 actions">
      <Card :title="t('settings.demo.exportTitle')" :subtitle="t('settings.demo.exportDesc')">
        <button class="btn btn-ghost" :disabled="exporting" @click="doExport"><Spinner v-if="exporting" :size="14" /><Icon v-else name="download" :size="14" />{{ t('settings.demo.export') }}</button>
      </Card>
      <Card :title="t('settings.demo.importTitle')" :subtitle="t('settings.demo.importDesc')">
        <button class="btn btn-ghost" :disabled="locked" :title="locked ? t('common.noPermission') : undefined" @click="openImport"><Icon name="upload" :size="14" />{{ t('settings.demo.import') }}</button>
      </Card>
      <Card :title="t('settings.demo.resetTitle')" :subtitle="t('settings.demo.resetDesc')">
        <button class="btn btn-danger" :disabled="resetting" @click="reset"><Spinner v-if="resetting" :size="14" /><Icon v-else name="refresh" :size="14" />{{ t('shell.resetDemo') }}</button>
      </Card>
    </div>

    <Card :title="t('sync.demo.breakdown')" :subtitle="t('sync.demo.breakdownDesc')" padding="none">
      <template #actions><button class="btn btn-ghost btn-sm" @click="refresh"><Icon name="refresh" :size="13" />{{ t('common.refresh') }}</button></template>
      <div v-if="!info.collections.length" class="empty">{{ t('sync.demo.nothingStored') }}</div>
      <div v-else class="table-wrap">
        <table class="table-simple">
          <thead><tr><th>{{ t('sync.demo.key') }}</th><th class="r">{{ t('settings.demo.records') }}</th><th class="r">{{ t('settings.demo.size') }}</th><th class="bar-col" /></tr></thead>
          <tbody>
            <tr v-for="c in shown" :key="c.name">
              <td class="mono">{{ c.name }}</td>
              <td class="r num">{{ c.records != null ? fmt.number(c.records) : '-' }}</td>
              <td class="r num">{{ bytes(c.bytes) }}</td>
              <td class="bar-col"><div class="mini"><span :style="{ width: Math.max(2, (c.bytes / info.collections[0].bytes) * 100) + '%' }" /></div></td>
            </tr>
          </tbody>
        </table>
      </div>
      <template v-if="info.collections.length > 8" #footer>
        <button class="btn-link" @click="showAll = !showAll">{{ showAll ? t('settings.demo.showLess') : t('settings.demo.showAll', { n: info.collections.length }) }}</button>
      </template>
    </Card>

    <Modal v-model:open="importOpen" :title="t('settings.demo.importTitle')" :subtitle="t('settings.demo.importDesc')" size="md">
      <div class="stack">
        <FileDrop ref="drop" accept=".json,application/json" :max-size-mb="12" :title="t('settings.demo.dropTitle')" :hint="t('settings.demo.dropHint')" @file="onFile" @error="m => (importError = m)" @clear="() => { file = null; preview = null; importError = '' }" />
        <div v-if="importError" class="callout danger"><Icon name="alert" :size="14" />{{ importError }}</div>
        <dl v-if="preview" class="kv">
          <dt>{{ t('settings.demo.seedVersion') }}</dt><dd class="mono">{{ preview.version ?? '-' }}</dd>
          <dt>{{ t('settings.demo.exportedAt') }}</dt><dd>{{ preview.exportedAt ? fmt.dateTime(preview.exportedAt) : '-' }}</dd>
          <dt>{{ t('settings.demo.collections') }}</dt><dd>{{ preview.collections }}</dd>
          <dt>{{ t('settings.demo.orders') }}</dt><dd>{{ preview.orders ?? '-' }}</dd>
          <dt>{{ t('settings.demo.shipments') }}</dt><dd>{{ preview.shipments ?? '-' }}</dd>
          <dt>{{ t('settings.demo.balance') }}</dt><dd>{{ preview.balance != null ? fmt.money(preview.balance) : '-' }}</dd>
        </dl>
        <div class="callout warn"><Icon name="info" :size="14" />{{ t('settings.demo.importWarn') }}</div>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="importOpen = false">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="!preview || !!importError || importing" @click="doImport"><Spinner v-if="importing" :size="14" />{{ t('settings.demo.import') }}</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.fact { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; border: 1px solid var(--line-1); border-radius: 10px; background: var(--bg-2); }
.fl { font-size: 12px; color: var(--ink-3); }
.fv { font-size: 16px; font-weight: 600; }
.quota { margin-top: 14px; display: flex; flex-direction: column; gap: 6px; }
.hint { font-size: 12.5px; color: var(--ink-3); }
.actions :deep(.kpz-card) { height: 100%; }
.r { text-align: right; }
.bar-col { width: 30%; }
.mini { height: 6px; background: var(--bg-3); border-radius: 99px; overflow: hidden; }
.mini span { display: block; height: 100%; background: var(--accent); border-radius: 99px; }
.empty { padding: 20px; color: var(--ink-3); text-align: center; }
@media (max-width: 860px) { .facts { grid-template-columns: repeat(2, 1fr); } .bar-col { display: none; } }
</style>
