<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import PageHeader from '../../components/PageHeader.vue'
import AddressForm from '../../components/AddressForm.vue'
import PackageForm from '../../components/PackageForm.vue'
import FormField from '../../components/FormField.vue'
import SegmentedControl from '../../components/SegmentedControl.vue'
import Money from '../../components/Money.vue'
import Weight from '../../components/Weight.vue'
import ScoreBadge from '../../components/ScoreBadge.vue'
import { validateAll, min, number } from '../../components/validation.js'
import { t, tx, fmt } from '../../i18n/index.js'
import { toast } from '../../components/toast.js'
import { confirm } from '../../components/confirm.js'
import { db } from '../../store/db.js'
import { createOrder, estimatePackageFromItems } from '../../api/orders.js'
import { makeAddressValidator } from '../../components/orders/addressValidator.js'
import { apiErrorText, fieldErrorText } from '../../components/shipments/helpers.js'

const router = useRouter()
const address = ref({ name: '', company: '', line1: '', line2: '', city: '', state: '', zip: '', country: 'US', phone: '', email: '', residential: true })
const addrForm = ref(null)
const validator = makeAddressValidator()
const addrResult = ref(null)

const products = computed(() => db.all('products'))
let seq = 0
const newItem = () => reactive({ key: ++seq, sku: '', title: '', qty: 1, unitPrice: '', weightLb: '' })
const items = ref([newItem()])
const itemRefs = ref([])
const itemsError = ref('')

function pickProduct(it, sku) {
  const p = products.value.find(x => x.sku === sku)
  it.sku = sku
  if (p) { it.title = tx(p.title); it.unitPrice = p.value; it.weightLb = p.weightLb }
}
function addItem() { items.value.push(newItem()); itemsError.value = '' }
function removeItem(i) { items.value.splice(i, 1) }
const itemsTotal = computed(() => items.value.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unitPrice) || 0), 0))

const pkgMode = ref('estimate')
const pkg = ref({ lengthIn: 12, widthIn: 10, heightIn: 6, weightLb: 1, preset: 'medium' })
const pkgForm = ref(null)
const estimated = computed(() => estimatePackageFromItems(items.value.filter(i => i.title || i.sku).map(i => ({ sku: i.sku || null, qty: Number(i.qty) || 1, weightLb: Number(i.weightLb) || null }))))
watch(pkgMode, m => { if (m === 'manual') pkg.value = { ...estimated.value, preset: 'custom' } })

const tagsText = ref('')
const notes = ref('')
const saving = ref(false)
const serverError = ref('')

async function save() {
  serverError.value = ''
  itemsError.value = items.value.length ? '' : t('orders.new.noItems')
  const refs = [addrForm.value, ...itemRefs.value.filter(Boolean)]
  if (pkgMode.value === 'manual' && pkgForm.value) refs.push(pkgForm.value)
  if (!validateAll(refs) || itemsError.value) return
  if (addrResult.value && addrResult.value.score < 70) {
    const ok = await confirm({ title: t('orders.new.lowScoreTitle', { n: addrResult.value.score }), message: t('orders.new.lowScoreMsg'), confirmLabel: t('orders.new.saveAnyway') })
    if (!ok) return
  }
  saving.value = true
  try {
    const { email, phone, ...shipTo } = address.value
    const order = await createOrder({
      customer: { name: shipTo.name, email, phone },
      shipTo,
      items: items.value.map(i => ({ sku: i.sku || null, title: i.title, qty: Number(i.qty), unitPrice: Number(i.unitPrice), weightLb: Number(i.weightLb) || null })),
      package: pkgMode.value === 'manual' ? { lengthIn: pkg.value.lengthIn, widthIn: pkg.value.widthIn, heightIn: pkg.value.heightIn, weightLb: pkg.value.weightLb } : null,
      tags: tagsText.value.split(',').map(x => x.trim()).filter(Boolean),
      channel: 'manual',
    })
    toast.success(t('orders.new.created', { id: order.id, score: order.addressCheck?.score ?? '-' }), {
      action: { label: t('orders.actions.createShipment'), onClick: () => router.push({ name: 'shipment-new', query: { orderId: order.id } }) },
      duration: 6000,
    })
    router.push({ name: 'orders', query: { highlight: order.id } })
  } catch (e) {
    if (e.code === 'VALIDATION' && e.details) {
      serverError.value = Object.entries(e.details).map(([f, c]) => `${t('orders.new.fieldNames.' + f.split('.')[0])}: ${fieldErrorText(c)}`).join(' · ')
    } else serverError.value = apiErrorText(e)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  } finally { saving.value = false }
}
</script>

<template>
  <div class="page page-narrow">
    <PageHeader :title="t('nav.orderNew')" :subtitle="t('orders.new.subtitle')">
      <template #actions>
        <RouterLink class="btn btn-ghost" :to="{ name: 'orders' }">{{ t('common.cancel') }}</RouterLink>
        <button class="btn btn-primary" :disabled="saving" @click="save"><span v-if="saving" class="spin" /><Icon v-else name="check" :size="14" />{{ t('orders.new.save') }}</button>
      </template>
    </PageHeader>

    <div v-if="serverError" class="callout danger mb" role="alert"><Icon name="alert" :size="15" />{{ serverError }}</div>

    <div class="layout">
      <div class="main">
        <section class="panel panel-pad">
          <h2 class="section-title">{{ t('orders.new.customer') }}</h2>
          <AddressForm ref="addrForm" v-model="address" :validator="validator" :required-fields="['name']" @validated="r => (addrResult = r)" />
        </section>

        <section class="panel panel-pad">
          <div class="spread head">
            <h2 class="section-title">{{ t('orders.new.items') }}</h2>
            <button class="btn btn-ghost btn-sm" @click="addItem"><Icon name="plus" :size="13" />{{ t('orders.new.addItem') }}</button>
          </div>
          <div v-if="itemsError" class="field-error mb" role="alert">{{ itemsError }}</div>
          <div v-for="(it, i) in items" :key="it.key" class="item">
            <div class="item-head">
              <span class="mono muted">#{{ i + 1 }}</span>
              <select class="input select sm" :value="it.sku" :aria-label="t('orders.new.catalog')" @change="pickProduct(it, $event.target.value)">
                <option value="">{{ t('orders.new.freeItem') }}</option>
                <option v-for="p in products" :key="p.sku" :value="p.sku">{{ tx(p.title) }} · {{ p.sku }}</option>
              </select>
              <button v-if="items.length > 1" class="btn-icon" :aria-label="t('orders.new.removeItem')" @click="removeItem(i)"><Icon name="trash" :size="14" /></button>
            </div>
            <div class="item-grid">
              <FormField :ref="el => (itemRefs[i * 3] = el)" class="span2" :label="t('orders.new.title')" required :value="it.title" v-slot="{ id, invalid, describedBy }">
                <input :id="id" v-model="it.title" class="input" :aria-invalid="invalid" :aria-describedby="describedBy" />
              </FormField>
              <FormField :ref="el => (itemRefs[i * 3 + 1] = el)" :label="t('orders.new.qty')" required :rules="[number(), min(1)]" :value="it.qty" v-slot="{ id, invalid, describedBy }">
                <input :id="id" v-model="it.qty" type="number" min="1" step="1" class="input" :aria-invalid="invalid" :aria-describedby="describedBy" />
              </FormField>
              <FormField :ref="el => (itemRefs[i * 3 + 2] = el)" :label="t('orders.new.unitPrice')" required :rules="[number(), min(0)]" :value="it.unitPrice" v-slot="{ id, invalid, describedBy }">
                <input :id="id" v-model="it.unitPrice" type="number" min="0" step="0.01" class="input" :aria-invalid="invalid" :aria-describedby="describedBy" />
              </FormField>
              <FormField :label="t('orders.new.weight')" optional :value="it.weightLb" v-slot="{ id }">
                <input :id="id" v-model="it.weightLb" type="number" min="0" step="0.1" class="input" />
              </FormField>
            </div>
          </div>
        </section>

        <section class="panel panel-pad">
          <div class="spread head">
            <h2 class="section-title">{{ t('orders.new.package') }}</h2>
            <SegmentedControl v-model="pkgMode" size="sm" :options="[{ value: 'estimate', label: t('orders.new.pkgEstimate') }, { value: 'manual', label: t('orders.new.pkgManual') }]" />
          </div>
          <div v-if="pkgMode === 'estimate'" class="callout neutral">
            <Icon name="box" :size="15" />
            <span>{{ t('orders.new.estimateText', { dims: fmt.dims(estimated), weight: fmt.weight(estimated.weightLb) }) }}</span>
          </div>
          <PackageForm v-else ref="pkgForm" v-model="pkg" />
        </section>

        <section class="panel panel-pad">
          <h2 class="section-title">{{ t('orders.new.extra') }}</h2>
          <div class="form-grid">
            <div>
              <label class="field-label" for="on-tags">{{ t('orders.new.tags') }}</label>
              <input id="on-tags" v-model="tagsText" class="input" :placeholder="t('orders.new.tagsPh')" />
            </div>
          </div>
        </section>
      </div>

      <aside class="side">
        <div class="panel panel-pad sticky">
          <h3 class="section-title">{{ t('orders.new.summary') }}</h3>
          <dl class="kv">
            <dt>{{ t('orders.new.channel') }}</dt><dd>{{ t('orders.channels.manual') }}</dd>
            <dt>{{ t('orders.new.recipient') }}</dt><dd>{{ address.name || '-' }}</dd>
            <dt>{{ t('orders.cols.destination') }}</dt><dd>{{ address.city ? `${address.city}, ${address.state}` : '-' }}</dd>
            <dt>{{ t('orders.cols.score') }}</dt><dd><ScoreBadge :score="addrResult?.score ?? null" size="sm" show-label /></dd>
            <dt>{{ t('orders.new.itemCount') }}</dt><dd class="mono">{{ items.reduce((s, i) => s + (Number(i.qty) || 0), 0) }}</dd>
            <dt>{{ t('orders.new.package') }}</dt><dd><Weight :lb="pkgMode === 'manual' ? pkg.weightLb : estimated.weightLb" /></dd>
          </dl>
          <hr class="divider" />
          <div class="spread total"><span>{{ t('orders.cols.total') }}</span><Money :value="itemsTotal" /></div>
          <button class="btn btn-primary full" :disabled="saving" @click="save"><span v-if="saving" class="spin" />{{ t('orders.new.save') }}</button>
          <p class="muted xs">{{ t('orders.new.note') }}</p>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.page-narrow { max-width: 1180px; }
.mb { margin-bottom: 12px; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 16px; align-items: start; }
.main { display: flex; flex-direction: column; gap: 16px; }
.head { margin-bottom: 10px; }
.head .section-title { margin: 0; }
.item { border: 1px solid var(--line-1); border-radius: var(--r-md); padding: 12px; margin-bottom: 10px; background: var(--bg); }
.item-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.item-head .select { flex: 1; }
.select.sm { height: 34px; font-size: 13px; }
.item-grid { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 10px; }
.item-grid :deep(.span2) { grid-column: span 1; }
.sticky { position: sticky; top: calc(var(--kpz-sticky-top, 56px) + 16px); }
.total { font-weight: 600; font-size: 15px; margin-bottom: 12px; }
.full { width: 100%; justify-content: center; }
.xs { font-size: 11.5px; margin: 10px 0 0; }
.spin { width: 13px; height: 13px; border-radius: 999px; border: 2px solid rgba(255,255,255,.35); border-top-color: white; animation: sp .7s linear infinite; }
@keyframes sp { to { transform: rotate(360deg); } }
@media (max-width: 1024px) { .layout { grid-template-columns: 1fr; } .sticky { position: static; } }
@media (max-width: 860px) { .item-grid { grid-template-columns: 1fr 1fr; } }
</style>
