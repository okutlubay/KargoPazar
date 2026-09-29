<script setup>
// Account statement PDF for a date range (spec 5.10 "hesap dökümü PDF").
import { ref, watch } from 'vue'
import Modal from '../../components/Modal.vue'
import Spinner from '../../components/Spinner.vue'
import SegmentedControl from '../../components/SegmentedControl.vue'
import { presetRange, toYmd } from '../../components/FilterBar.vue'
import { errorText } from '../../components/billing/apiErrors.js'
import { toast } from '../../components/toast.js'
import { t } from '../../i18n/index.js'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['update:open'])
const preset = ref('last30')
const from = ref('')
const to = ref('')
const err = ref('')
const busy = ref(false)

function applyPreset(p) {
  const r = presetRange(p)
  if (r) { from.value = r.from; to.value = r.to }
}
watch(() => props.open, v => { if (v) { preset.value = 'last30'; applyPreset('last30'); err.value = '' } }, { immediate: true })
watch(preset, p => { if (p !== 'custom') applyPreset(p) })

async function download() {
  err.value = ''
  if (!from.value || !to.value) { err.value = t('billing.statement.rangeRequired'); return }
  if (from.value > to.value) { err.value = t('billing.statement.rangeOrder'); return }
  if (to.value > toYmd(new Date())) { err.value = t('billing.statement.rangeFuture'); return }
  busy.value = true
  try {
    const d = await import('../../docs/index.js')
    d.downloadStatement({ from: new Date(from.value + 'T00:00:00').toISOString(), to: new Date(to.value + 'T23:59:59').toISOString() })
    toast.success(t('billing.statement.done'))
    emit('update:open', false)
  } catch (e) {
    err.value = errorText(e)
  } finally { busy.value = false }
}
</script>

<template>
  <Modal :open="open" :title="t('billing.statement.title')" :subtitle="t('billing.statement.desc')" size="sm" @update:open="v => emit('update:open', v)">
    <div class="st">
      <SegmentedControl v-model="preset" size="sm" block :options="[{ value: 'last30', label: t('common.last30') }, { value: 'last90', label: t('common.last90') }, { value: 'thisMonth', label: t('common.thisMonth') }, { value: 'custom', label: t('common.custom') }]" />
      <div class="dates">
        <label>{{ t('common.from') }}<input v-model="from" type="date" class="input" @input="preset = 'custom'" /></label>
        <label>{{ t('common.to') }}<input v-model="to" type="date" class="input" @input="preset = 'custom'" /></label>
      </div>
      <div v-if="err" class="field-error" role="alert">{{ err }}</div>
    </div>
    <template #footer>
      <button class="btn btn-ghost" :disabled="busy" @click="emit('update:open', false)">{{ t('common.cancel') }}</button>
      <button class="btn btn-primary" :disabled="busy" @click="download"><Spinner v-if="busy" :size="14" /> {{ t('common.downloadPdf') }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.st { display: flex; flex-direction: column; gap: 12px; }
.dates { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.dates label { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: var(--ink-2); }
</style>
