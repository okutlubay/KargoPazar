<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import Card from '../Card.vue'
import FormField from '../FormField.vue'
import Skeleton from '../Skeleton.vue'
import Spinner from '../Spinner.vue'
import AddressForm from '../AddressForm.vue'
import { pattern, validateAll } from '../validation.js'
import { toast } from '../toast.js'
import { useI18n } from '../../i18n/index.js'
import { db } from '../../store/db.js'
import { can } from '../../store/session.js'
import { getSettings, updateCompany } from '../../api/settings.js'
import { errorText, fieldErrors } from './util.js'

const { t, tx } = useI18n()
const loading = ref(true)
const saving = ref(false)
const form = reactive({ name: '', legalName: '', taxId: '', phone: '', defaultHub: 'NJ01', senderAddress: {} })
const errors = ref({})
const fields = ref([])
const addressRef = ref(null)
const locked = computed(() => !can('settings.manage'))
const hubs = computed(() => db.all('hubs').filter(h => h.type === 'us_hub'))
let initial = ''
const dirty = computed(() => JSON.stringify(form) !== initial)

onMounted(async () => {
  try {
    const s = await getSettings()
    const c = s.company
    Object.assign(form, { name: c.name, legalName: c.legalName, taxId: c.taxId, phone: c.phone ?? '', defaultHub: c.defaultHub, senderAddress: { ...c.senderAddress, company: c.senderAddress?.company ?? '', residential: false } })
    initial = JSON.stringify(form)
  } catch (e) { toast.error(errorText(e)) } finally { loading.value = false }
})

async function save() {
  errors.value = {}
  if (!validateAll([...fields.value, addressRef.value])) return
  saving.value = true
  try {
    await updateCompany(JSON.parse(JSON.stringify(form)))
    initial = JSON.stringify(form)
    toast.success(t('settings.company.saved'))
  } catch (e) {
    errors.value = fieldErrors(e)
    toast.error(errorText(e))
  } finally { saving.value = false }
}
function reset() { Object.assign(form, JSON.parse(initial)); errors.value = {} }
</script>

<template>
  <div class="stack-lg">
    <Card :title="t('settings.company.title')" :subtitle="t('settings.company.desc')">
      <div v-if="loading"><Skeleton :lines="8" /></div>
      <form v-else id="company-form" class="stack-lg" novalidate @submit.prevent="save">
        <div class="form-grid">
          <FormField :ref="el => (fields[0] = el)" :label="t('settings.company.name')" required :value="form.name" :error="errors.name" v-slot="{ id, invalid, describedBy }">
            <input :id="id" v-model="form.name" class="input" :disabled="locked" :aria-invalid="invalid" :aria-describedby="describedBy" />
          </FormField>
          <FormField :ref="el => (fields[1] = el)" :label="t('settings.company.legalName')" required :value="form.legalName" :error="errors.legalName" v-slot="{ id, invalid, describedBy }">
            <input :id="id" v-model="form.legalName" class="input" :disabled="locked" :aria-invalid="invalid" :aria-describedby="describedBy" />
          </FormField>
          <FormField :ref="el => (fields[2] = el)" :label="t('settings.company.taxId')" required :hint="t('settings.company.taxIdHint')"
            :rules="[pattern(/^\d{2}-\d{7}$/, 'settings.validation.tax_id')]" :value="form.taxId" :error="errors.taxId" v-slot="{ id, invalid, describedBy }">
            <input :id="id" v-model="form.taxId" class="input mono" placeholder="88-1234567" :disabled="locked" :aria-invalid="invalid" :aria-describedby="describedBy" />
          </FormField>
          <FormField :ref="el => (fields[3] = el)" :label="t('settings.company.phone')" optional :value="form.phone" v-slot="{ id }">
            <input :id="id" v-model="form.phone" class="input" :disabled="locked" />
          </FormField>
        </div>
      </form>
    </Card>

    <Card v-if="!loading" :title="t('settings.company.hubTitle')" :subtitle="t('settings.company.hubDesc')">
      <div class="hubs" role="radiogroup" :aria-label="t('settings.company.hubTitle')">
        <label v-for="h in hubs" :key="h.code" :class="['hub', { on: form.defaultHub === h.code, dis: locked }]">
          <input v-model="form.defaultHub" type="radio" name="hub" :value="h.code" :disabled="locked" />
          <span class="hub-code mono">{{ h.code }}</span>
          <span class="hub-name">{{ tx(h.name) }}</span>
          <span class="hub-addr">{{ h.address.city }}, {{ h.address.state }} · {{ t('settings.company.cutoff', { time: h.cutoff }) }}</span>
        </label>
      </div>
    </Card>

    <Card v-if="!loading" :title="t('settings.company.senderTitle')" :subtitle="t('settings.company.senderDesc')">
      <AddressForm ref="addressRef" v-model="form.senderAddress" country="US" :show-email="false" :show-residential="false" :show-phone="false" :disabled="locked" />
      <template #footer>
        <div class="actions">
          <span v-if="locked" class="lock-note">{{ t('common.noPermission') }}</span>
          <button type="button" class="btn btn-ghost" :disabled="!dirty || saving" @click="reset">{{ t('common.cancel') }}</button>
          <button type="submit" form="company-form" class="btn btn-primary" :disabled="saving || !dirty || locked" :title="locked ? t('common.noPermission') : undefined" @click.prevent="save">
            <Spinner v-if="saving" :size="14" />{{ saving ? t('common.saving') : t('common.save') }}
          </button>
        </div>
      </template>
    </Card>
  </div>
</template>

<style scoped>
.hubs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.hub { position: relative; display: flex; flex-direction: column; gap: 2px; padding: 14px 16px; border: 1px solid var(--line-2); border-radius: var(--r-md); cursor: pointer; background: var(--surface); }
.hub input { position: absolute; opacity: 0; }
.hub.on { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.hub.dis { cursor: not-allowed; opacity: .75; }
.hub:focus-within { box-shadow: 0 0 0 3px var(--accent-soft); }
.hub-code { font-size: 12px; font-weight: 600; color: var(--accent-ink); }
.hub-name { font-weight: 600; }
.hub-addr { font-size: 12.5px; color: var(--ink-3); }
.actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
.lock-note { margin-right: auto; font-size: 12.5px; color: var(--ink-3); }
@media (max-width: 860px) { .hubs { grid-template-columns: 1fr; } }
</style>
