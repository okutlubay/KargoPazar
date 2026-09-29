<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import Icon from '@/components/Icon.vue'
import Card from '../Card.vue'
import Modal from '../Modal.vue'
import FormField from '../FormField.vue'
import Skeleton from '../Skeleton.vue'
import Spinner from '../Spinner.vue'
import EmptyState from '../EmptyState.vue'
import Dropdown from '../Dropdown.vue'
import { min, validateAll } from '../validation.js'
import { toast } from '../toast.js'
import { confirm } from '../confirm.js'
import { useI18n } from '../../i18n/index.js'
import { can, session } from '../../store/session.js'
import { listBoxPresets, saveBoxPreset, removeBoxPreset, restoreBoxPreset, setDefaultBoxPreset } from '../../api/settings.js'
import { errorText, fieldErrors } from './util.js'

const { t, tx, fmt } = useI18n()
const loading = ref(true)
const presets = ref([])
const locked = computed(() => !can('settings.manage'))
const metric = computed(() => session.user?.preferences?.units === 'metric')
const CM = 2.54
const KG = 2.20462

async function load() {
  try { presets.value = await listBoxPresets() } catch (e) { toast.error(errorText(e)) } finally { loading.value = false }
}
onMounted(load)

const TYPES = ['box', 'poly', 'envelope', 'tube']
const open = ref(false)
const saving = ref(false)
const errors = ref({})
const fields = ref([])
const form = reactive({ id: null, name: '', type: 'box', l: '', w: '', h: '', tare: '' })

function toDisplay(inches) { return metric.value ? Math.round(inches * CM * 10) / 10 : inches }
function fromDisplay(v) { return metric.value ? Math.round((Number(v) / CM) * 100) / 100 : Number(v) }
const dimUnit = computed(() => (metric.value ? 'cm' : 'in'))
const wUnit = computed(() => (metric.value ? 'kg' : 'lb'))

function edit(p) {
  errors.value = {}
  if (p) Object.assign(form, { id: p.id, name: tx(p.name), type: p.type, l: toDisplay(p.lengthIn), w: toDisplay(p.widthIn), h: toDisplay(p.heightIn), tare: metric.value ? Math.round((p.tareLb / KG) * 100) / 100 : p.tareLb })
  else Object.assign(form, { id: null, name: '', type: 'box', l: '', w: '', h: '', tare: '' })
  open.value = true
}

async function submit() {
  errors.value = {}
  if (!validateAll(fields.value.filter(Boolean))) return
  saving.value = true
  try {
    const existing = presets.value.find(p => p.id === form.id)
    const name = existing && tx(existing.name) === form.name ? existing.name : form.name
    await saveBoxPreset({
      id: form.id, name, type: form.type,
      lengthIn: fromDisplay(form.l), widthIn: fromDisplay(form.w), heightIn: fromDisplay(form.h),
      tareLb: form.tare === '' ? 0 : metric.value ? Math.round(Number(form.tare) * KG * 100) / 100 : Number(form.tare),
    })
    toast.success(form.id ? t('settings.presets.updated') : t('settings.presets.created'))
    open.value = false
    await load()
  } catch (e) {
    errors.value = fieldErrors(e)
    toast.error(errorText(e))
  } finally { saving.value = false }
}

async function remove(p) {
  const ok = await confirm({ title: t('settings.presets.deleteTitle'), message: t('settings.presets.deleteDesc', { name: tx(p.name) }), confirmLabel: t('common.delete'), danger: true })
  if (!ok) return
  try {
    const { removed, index } = await removeBoxPreset(p.id)
    await load()
    toast.info(t('settings.presets.deleted'), { action: { label: t('common.undo'), onClick: async () => { await restoreBoxPreset(removed, index); await load() } } })
  } catch (e) { toast.error(errorText(e)) }
}

async function makeDefault(p) {
  try { presets.value = await setDefaultBoxPreset(p.id); toast.success(t('settings.presets.defaultSet', { name: tx(p.name) })) } catch (e) { toast.error(errorText(e)) }
}

function dimWeight(p) { return Math.ceil((p.lengthIn * p.widthIn * p.heightIn) / 139) }
function menu(p) {
  return [
    { key: 'edit', label: t('common.edit'), icon: 'edit', disabled: locked.value, onClick: () => edit(p) },
    { key: 'default', label: t('settings.presets.makeDefault'), icon: 'star', disabled: locked.value || p.isDefault, onClick: () => makeDefault(p) },
    { divider: true, key: 'd' },
    { key: 'del', label: t('common.delete'), icon: 'trash', danger: true, disabled: locked.value, onClick: () => remove(p) },
  ]
}
</script>

<template>
  <Card :title="t('settings.presets.title')" :subtitle="t('settings.presets.desc')" padding="none">
    <template #actions>
      <button class="btn btn-primary btn-sm" :disabled="locked" :title="locked ? t('common.noPermission') : undefined" @click="edit(null)"><Icon name="plus" :size="13" />{{ t('settings.presets.add') }}</button>
    </template>
    <div v-if="loading" class="pad"><Skeleton :lines="4" /></div>
    <EmptyState v-else-if="!presets.length" icon="box" :title="t('settings.presets.emptyTitle')" :description="t('settings.presets.emptyDesc')" :action-label="locked ? '' : t('settings.presets.add')" @action="edit(null)" />
    <div v-else class="table-wrap">
      <table class="table-simple">
        <thead>
          <tr>
            <th>{{ t('settings.presets.name') }}</th>
            <th>{{ t('settings.presets.type') }}</th>
            <th>{{ t('settings.presets.dims') }}</th>
            <th class="hide-lg">{{ t('settings.presets.tare') }}</th>
            <th class="hide-lg">{{ t('settings.presets.dimWeight') }}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in presets" :key="p.id">
            <td>
              <div class="nm">
                <span class="sym"><Icon :name="p.type === 'poly' ? 'layers' : 'box'" :size="14" /></span>
                <strong>{{ tx(p.name) }}</strong>
                <span v-if="p.isDefault" class="tag tag-accent">{{ t('settings.presets.default') }}</span>
              </div>
            </td>
            <td>{{ t('settings.presets.types.' + p.type) }}</td>
            <td class="num">{{ fmt.dims(p) }}</td>
            <td class="num hide-lg">{{ fmt.weight(p.tareLb, undefined, 2) }}</td>
            <td class="num hide-lg">{{ fmt.weight(dimWeight(p), undefined, 0) }}</td>
            <td class="r"><Dropdown :items="menu(p)" size="sm" /></td>
          </tr>
        </tbody>
      </table>
    </div>
  </Card>

  <Modal v-model:open="open" :title="form.id ? t('settings.presets.editTitle') : t('settings.presets.addTitle')" size="md">
    <form id="preset-form" class="stack" novalidate @submit.prevent="submit">
      <FormField :ref="el => (fields[0] = el)" :label="t('settings.presets.name')" required :value="form.name" :error="errors.name" v-slot="{ id, invalid, describedBy }">
        <input :id="id" v-model="form.name" class="input" :placeholder="t('settings.presets.namePh')" :aria-invalid="invalid" :aria-describedby="describedBy" />
      </FormField>
      <FormField :label="t('settings.presets.type')" :value="form.type" v-slot="{ id }">
        <select :id="id" v-model="form.type" class="select">
          <option v-for="ty in TYPES" :key="ty" :value="ty">{{ t('settings.presets.types.' + ty) }}</option>
        </select>
      </FormField>
      <div class="dims">
        <FormField :ref="el => (fields[1] = el)" :label="t('settings.presets.length') + ' (' + dimUnit + ')'" required :rules="[min(0.1)]" :value="form.l" :error="errors.lengthIn" v-slot="{ id, invalid }">
          <input :id="id" v-model="form.l" type="number" step="0.1" min="0" class="input num" :aria-invalid="invalid" />
        </FormField>
        <FormField :ref="el => (fields[2] = el)" :label="t('settings.presets.width') + ' (' + dimUnit + ')'" required :rules="[min(0.1)]" :value="form.w" :error="errors.widthIn" v-slot="{ id, invalid }">
          <input :id="id" v-model="form.w" type="number" step="0.1" min="0" class="input num" :aria-invalid="invalid" />
        </FormField>
        <FormField :ref="el => (fields[3] = el)" :label="t('settings.presets.height') + ' (' + dimUnit + ')'" required :rules="[min(0.1)]" :value="form.h" :error="errors.heightIn" v-slot="{ id, invalid }">
          <input :id="id" v-model="form.h" type="number" step="0.1" min="0" class="input num" :aria-invalid="invalid" />
        </FormField>
      </div>
      <FormField :ref="el => (fields[4] = el)" :label="t('settings.presets.tare') + ' (' + wUnit + ')'" optional :rules="[min(0)]" :value="form.tare" :error="errors.tareLb" v-slot="{ id, invalid }">
        <input :id="id" v-model="form.tare" type="number" step="0.01" min="0" class="input num" :aria-invalid="invalid" />
      </FormField>
      <div v-if="Number(form.l) > 0 && Number(form.w) > 0 && Number(form.h) > 0" class="callout neutral">
        {{ t('settings.presets.dimHint', { lb: Math.ceil((fromDisplay(form.l) * fromDisplay(form.w) * fromDisplay(form.h)) / 139) }) }}
      </div>
    </form>
    <template #footer>
      <button class="btn btn-ghost" @click="open = false">{{ t('common.cancel') }}</button>
      <button type="submit" form="preset-form" class="btn btn-primary" :disabled="saving"><Spinner v-if="saving" :size="14" />{{ t('common.save') }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.pad { padding: 18px 20px; }
.nm { display: flex; align-items: center; gap: 10px; }
.sym { width: 28px; height: 28px; border-radius: 8px; background: var(--bg-2); display: grid; place-items: center; color: var(--ink-3); }
.r { text-align: right; width: 48px; }
.dims { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 560px) { .dims { grid-template-columns: 1fr; } }
</style>
