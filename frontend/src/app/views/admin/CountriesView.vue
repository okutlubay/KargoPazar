<script setup>
// Country configuration (spec 9.6): country cards, detail editor (all fields, drag and drop address
// field order, live postcode regex test) and the new market wizard.
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '@/app/components/PageHeader.vue'
import Skeleton from '@/app/components/Skeleton.vue'
import Spinner from '@/app/components/Spinner.vue'
import EmptyState from '@/app/components/EmptyState.vue'
import StatusPill from '@/app/components/StatusPill.vue'
import DateTime from '@/app/components/DateTime.vue'
import Toggle from '@/app/components/Toggle.vue'
import Drawer from '@/app/components/Drawer.vue'
import Tabs from '@/app/components/Tabs.vue'
import KpiCard from '@/app/components/KpiCard.vue'
import CountryForm from '@/app/components/admin/CountryForm.vue'
import AddressFormatEditor from '@/app/components/admin/AddressFormatEditor.vue'
import CountryWizard from '@/app/components/admin/CountryWizard.vue'
import Flag from '@/app/components/intl/Flag.vue'
import { toast } from '@/app/components/toast.js'
import { confirm } from '@/app/components/confirm.js'
import { useI18n } from '@/app/i18n/index.js'
import { can } from '@/app/store/session.js'
import { listCountries, saveCountry, setCountryActive } from '@/app/api/countries.js'
import { errorText, fieldText } from '@/app/components/settings/util.js'

const { t, tx, fmt } = useI18n()
const router = useRouter()
const loading = ref(true)
const failed = ref(false)
const rows = ref([])
const locked = computed(() => !can('admin.platform'))
const wizardOpen = ref(false)
const highlight = ref('')

async function load() {
  failed.value = false
  try { rows.value = await listCountries() } catch (e) { if (!rows.value.length) failed.value = true; toast.error(errorText(e, 'admin')) } finally { loading.value = false }
}
onMounted(load)

const kpis = computed(() => ({
  active: rows.value.filter(r => r.active !== false).length,
  origins: rows.value.filter(r => r.active !== false && (r.role === 'origin' || r.role === 'both')).length,
  newMarkets: rows.value.filter(r => r.isNewMarket).length,
  shipments: rows.value.reduce((s, r) => s + (r.stats?.intlShipments ?? 0), 0),
}))

// active toggle
const busy = ref('')
async function toggleActive(c, v) {
  if (!v) {
    const ok = await confirm({ title: t('admin.countries.deactivateTitle', { name: tx(c.name) }), message: t('admin.countries.deactivateDesc'), confirmLabel: t('admin.countries.deactivate'), danger: true })
    if (!ok) return
  }
  busy.value = c.code
  try {
    await setCountryActive(c.code, v)
    await load()
    toast.success(v ? t('admin.countries.activated', { name: tx(c.name) }) : t('admin.countries.deactivated', { name: tx(c.name) }),
      v ? undefined : { action: { label: t('common.undo'), onClick: async () => { await setCountryActive(c.code, true); await load() } } })
  } catch (e) { toast.error(errorText(e, 'admin')) } finally { busy.value = '' }
}

// editor
const editorOpen = ref(false)
const edit = ref(null)
const editTab = ref('general')
const editErr = ref({})
const saving = ref(false)
const original = ref('')
function openEditor(c) {
  const copy = JSON.parse(JSON.stringify(c))
  copy.deMinimis = { status: 'applied', ...(copy.deMinimis ?? { amount: 0, currency: copy.currency }) }
  copy.prohibited = copy.prohibited ?? []
  copy.carriers = copy.carriers ?? []
  edit.value = copy
  original.value = JSON.stringify(copy)
  editErr.value = {}
  editTab.value = 'general'
  editorOpen.value = true
}
const dirty = computed(() => !!edit.value && JSON.stringify(edit.value) !== original.value)
const editTabs = computed(() => {
  const errKeys = Object.keys(editErr.value)
  const has = test => errKeys.some(test)
  return [
    { key: 'general', label: t('admin.countries.tabs.general'), count: has(k => /^(name|currency|currencySymbol|fxToUsd|units|defaultLang|role)/.test(k)) ? '!' : undefined },
    { key: 'address', label: t('admin.countries.tabs.address'), count: has(k => k.startsWith('addressFormat')) ? '!' : undefined },
    { key: 'carriers', label: t('admin.countries.tabs.carriers'), count: edit.value?.carriers?.length },
    { key: 'customs', label: t('admin.countries.tabs.customs'), count: has(k => k.startsWith('deMinimis') || k === 'vatRate') ? '!' : undefined },
  ]
})
const errMsg = computed(() => Object.fromEntries(Object.entries(editErr.value).map(([k, v]) => [k, fieldText(v, 'admin')])))
async function saveEdit() {
  saving.value = true
  editErr.value = {}
  try {
    const c = edit.value
    await saveCountry(c.code, c)
    await load()
    original.value = JSON.stringify(edit.value)
    editorOpen.value = false
    toast.success(t('admin.countries.saved', { name: tx(c.name) }))
    flash(c.code)
  } catch (e) {
    editErr.value = e?.details ?? {}
    const keys = Object.keys(editErr.value)
    if (keys.some(k => k.startsWith('addressFormat'))) editTab.value = 'address'
    else if (keys.includes('carriers')) editTab.value = 'carriers'
    else if (keys.some(k => k.startsWith('deMinimis') || k === 'vatRate')) editTab.value = 'customs'
    else if (keys.length) editTab.value = 'general'
    toast.error(errorText(e, 'admin'))
  } finally { saving.value = false }
}
async function closeEditor() {
  if (dirty.value) {
    const ok = await confirm({ title: t('admin.countries.unsavedTitle'), message: t('admin.countries.unsavedDesc'), confirmLabel: t('admin.countries.discard'), danger: true })
    if (!ok) return
  }
  editorOpen.value = false
}
function onDrawer(v) { if (!v) closeEditor(); else editorOpen.value = true }

function flash(code) { highlight.value = code; setTimeout(() => { if (highlight.value === code) highlight.value = '' }, 2500) }
async function onCreated(c) { await load(); flash(c.code) }
const roleTone = r => (r === 'destination' ? 'info' : r === 'both' ? 'success' : 'neutral')
</script>

<template>
  <div class="page">
    <PageHeader :title="t('nav.adminCountries')" :subtitle="t('admin.countries.subtitle')">
      <template #actions>
        <button class="btn btn-primary" :disabled="locked || loading" :title="locked ? t('common.noPermission') : undefined" @click="wizardOpen = true"><Icon name="plus" :size="14" />{{ t('admin.countries.addMarket') }}</button>
      </template>
    </PageHeader>

    <div class="grid-kpi mb">
      <KpiCard :label="t('admin.countries.kpiActive')" :value="loading ? '' : String(kpis.active)" :loading="loading" icon="globe" />
      <KpiCard :label="t('admin.countries.kpiOrigins')" :value="loading ? '' : String(kpis.origins)" :loading="loading" icon="plane" />
      <KpiCard :label="t('admin.countries.kpiNew')" :value="loading ? '' : String(kpis.newMarkets)" :loading="loading" icon="flag" />
      <KpiCard :label="t('admin.countries.kpiShipments')" :value="loading ? '' : fmt.number(kpis.shipments)" :loading="loading" icon="box" />
    </div>

    <div v-if="loading" class="cards"><Skeleton v-for="i in 4" :key="i" variant="rect" :height="250" /></div>
    <EmptyState v-else-if="failed" icon="globe" :title="t('common.errorGeneric')" :action-label="t('common.retry')" @action="load" />
    <EmptyState v-else-if="!rows.length" icon="globe" :title="t('admin.countries.empty')" :action-label="t('admin.countries.addMarket')" @action="wizardOpen = true" />
    <div v-else class="cards">
      <article v-for="c in rows" :key="c.code" :class="['cc', { off: c.active === false, hl: highlight === c.code }]">
        <header>
          <Flag :code="c.code" :size="24" :title="tx(c.name)" />
          <div class="ttl">
            <strong>{{ tx(c.name) }}</strong>
            <span class="mono sub">{{ c.code }}</span>
          </div>
          <span v-if="c.isNewMarket" class="tag tag-accent">{{ t('admin.countries.newMarket') }}</span>
        </header>
        <div class="pills">
          <StatusPill :status="c.role" :label="t('admin.countries.roles.' + c.role)" :tone="roleTone(c.role)" size="sm" :dot="false" />
          <StatusPill :status="c.active === false ? 'inactive' : 'active'" size="sm" />
        </div>
        <dl class="facts">
          <div><dt>{{ t('admin.countries.currency') }}</dt><dd>{{ c.currency }} {{ c.currencySymbol }}</dd></div>
          <div><dt>{{ t('admin.countries.units') }}</dt><dd>{{ c.units === 'metric' ? t('admin.countries.metric') : t('admin.countries.imperial') }}</dd></div>
          <div><dt>{{ t('admin.countries.lang') }}</dt><dd>{{ (c.defaultLang || '-').toUpperCase() }}</dd></div>
          <div><dt>{{ t('admin.countries.deMinimis') }}</dt><dd>{{ !c.deMinimis ? '-' : c.deMinimis.status === 'suspended' ? `${t('admin.countries.deMinimisSuspended')} (${fmt.number(c.deMinimis.amount)} ${c.deMinimis.currency})` : `${fmt.number(c.deMinimis.amount)} ${c.deMinimis.currency}` }}</dd></div>
          <div><dt>{{ t('admin.countries.carriersTitle') }}</dt><dd>{{ t('admin.countries.servicesN', { n: c.carriers?.length ?? 0 }) }}</dd></div>
          <div><dt>{{ t('admin.countries.intlShipments') }}</dt><dd>{{ fmt.number(c.stats?.intlShipments ?? 0) }}</dd></div>
        </dl>
        <div class="fmt mono" :title="t('admin.countries.postalRegex')">{{ c.addressFormat?.postalRegex || '-' }}<span v-if="c.addressFormat?.postalExample"> · {{ c.addressFormat.postalExample }}</span></div>
        <div v-if="c.stats?.originPoints?.length" class="points"><Icon name="warehouse" :size="12" />{{ c.stats.originPoints.map(p => p.code).join(', ') }}</div>
        <div class="launch"><template v-if="c.launchedAt">{{ t('admin.countries.launched') }} <DateTime :value="c.launchedAt" mode="date" /></template></div>
        <footer>
          <Toggle :model-value="c.active !== false" size="sm" :label="t('admin.countries.activeLabel')" :disabled="locked || c.code === 'US' || busy === c.code" @update:model-value="v => toggleActive(c, v)" />
          <Spinner v-if="busy === c.code" :size="13" />
          <span class="grow" />
          <button class="btn btn-ghost btn-sm" @click="openEditor(c)"><Icon name="edit" :size="12" />{{ locked ? t('common.view') : t('common.edit') }}</button>
        </footer>
      </article>
      <button v-if="!locked" class="cc add" @click="wizardOpen = true">
        <Icon name="plus" :size="20" />
        <strong>{{ t('admin.countries.addMarket') }}</strong>
        <span>{{ t('admin.countries.addMarketHint') }}</span>
      </button>
    </div>

    <Drawer :open="editorOpen" :title="edit ? `${tx(edit.name)} (${edit.code})` : ''" :subtitle="t('admin.countries.editorSubtitle')" width="820px" @update:open="onDrawer">
      <div v-if="edit" class="stack-lg">
        <Tabs v-model="editTab" :tabs="editTabs" />
        <CountryForm v-if="editTab === 'general'" :country="edit" section="general" :errors="errMsg" :lock-role="edit.code === 'US'" :disabled="locked" />
        <AddressFormatEditor v-else-if="editTab === 'address'" v-model="edit.addressFormat" :errors="errMsg" :disabled="locked" />
        <CountryForm v-else-if="editTab === 'carriers'" :country="edit" section="carriers" :errors="errMsg" :disabled="locked" />
        <CountryForm v-else :country="edit" section="customs" :errors="errMsg" :disabled="locked" />
      </div>
      <template #footer>
        <span v-if="dirty" class="dirty">{{ t('admin.countries.unsaved') }}</span>
        <span class="grow" />
        <button class="btn btn-ghost" @click="closeEditor">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="saving || !dirty || locked" :title="locked ? t('common.noPermission') : undefined" @click="saveEdit"><Spinner v-if="saving" :size="14" />{{ t('common.save') }}</button>
      </template>
    </Drawer>

    <CountryWizard v-model:open="wizardOpen" @done="onCreated" />
  </div>
</template>

<style scoped>
.mb { margin-bottom: 16px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 14px; }
.cc { display: flex; flex-direction: column; gap: 10px; padding: 16px; border: 1px solid var(--line-1); border-radius: var(--r-lg); background: var(--surface); transition: box-shadow .4s, border-color .4s; }
.cc.off { opacity: .7; }
.cc.hl { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.cc header { display: flex; align-items: center; gap: 10px; }
.flag { font-size: 30px; line-height: 1; }
.ttl { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.ttl strong { font-size: 15px; }
.sub { font-size: 11.5px; color: var(--ink-3); }
.pills { display: flex; gap: 6px; flex-wrap: wrap; }
.facts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; margin: 0; }
.facts dt { font-size: 11.5px; color: var(--ink-4); }
.facts dd { margin: 1px 0 0; font-size: 13px; font-weight: 500; }
.fmt { font-size: 11.5px; color: var(--ink-3); background: var(--bg-2); border-radius: 6px; padding: 4px 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.points { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-2); }
.launch { font-size: 12px; color: var(--ink-3); min-height: 16px; }
.cc footer { display: flex; align-items: center; gap: 8px; border-top: 1px solid var(--line-1); padding-top: 10px; margin-top: auto; }
.cc.add { align-items: center; justify-content: center; text-align: center; border-style: dashed; cursor: pointer; color: var(--ink-2); min-height: 250px; }
.cc.add:hover { border-color: var(--accent); color: var(--accent-ink); }
.cc.add span { font-size: 12.5px; color: var(--ink-3); max-width: 220px; }
.grow { flex: 1; }
.dirty { font-size: 12.5px; color: var(--warning); }
</style>
