<script setup>
// "AI önerisi al": HS code suggestion from the Naive Bayes model (spec 5.4, 6.5).
//   <HsSuggestModal v-model:open="x" :title="item.title" :sku="item.sku" :busy="saving" @select="code => ..." />
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Modal from '../Modal.vue'
import Skeleton from '../Skeleton.vue'
import ProgressBar from '../ProgressBar.vue'
import { t, tx, fmt } from '../../i18n/index.js'
import { suggestHs } from '../../api/ai.js'
import { apiErrorText } from '../shipments/helpers.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  sku: { type: String, default: '' },
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['update:open', 'select'])
const router = useRouter()

const loading = ref(false)
const result = ref(null)
const error = ref('')
const picked = ref(null)

watch(() => props.open, async v => {
  if (!v) return
  loading.value = true
  result.value = null
  error.value = ''
  picked.value = null
  try {
    result.value = await suggestHs(props.title, '', { source: 'order' })
    picked.value = result.value.top[0]?.code ?? null
  } catch (e) {
    error.value = apiErrorText(e)
  } finally { loading.value = false }
})

function openModel() {
  emit('update:open', false)
  router.push({ name: 'ai-hs', query: { title: props.title } })
}
function openCustoms() {
  if (!picked.value) return
  emit('update:open', false)
  router.push({ name: 'customs-info', query: { hs: picked.value, title: props.title || undefined } })
}
</script>

<template>
  <Modal :open="open" :title="t('orders.hs.title')" :subtitle="title" size="md" @update:open="v => emit('update:open', v)">
    <div v-if="loading" class="stack"><Skeleton variant="rect" :height="56" /><Skeleton variant="rect" :height="56" /><Skeleton variant="rect" :height="56" /></div>
    <div v-else-if="error" class="callout danger"><Icon name="alert" :size="15" />{{ error }}</div>
    <template v-else-if="result">
      <div v-if="result.lowConfidence" class="callout warn mb"><Icon name="alert" :size="15" />{{ t('orders.hs.low') }}</div>
      <div class="opts" role="radiogroup" :aria-label="t('orders.hs.title')">
        <label v-for="(c, i) in result.top" :key="c.code" class="opt" :class="{ on: picked === c.code }">
          <input v-model="picked" type="radio" name="hs-pick" :value="c.code" />
          <span class="code mono">{{ c.code }}</span>
          <span class="desc">
            <span class="d1">{{ tx(c.desc) }}</span>
            <ProgressBar :value="Math.round(c.prob * 100)" size="sm" :tone="i === 0 ? 'accent' : 'ink'" />
          </span>
          <span class="prob mono">{{ fmt.percent(c.prob, 0) }}</span>
        </label>
      </div>
      <div class="words">
        <span class="muted small">{{ t('orders.hs.words') }}</span>
        <span v-for="w in result.topWords" :key="w.word" class="tag">{{ w.word }}</span>
      </div>
      <div class="muted small">{{ t('orders.hs.model', { v: result.modelVersion }) }}</div>
    </template>
    <template #footer>
      <button class="btn btn-ghost" @click="openModel"><Icon name="external" :size="13" />{{ t('orders.hs.openModel') }}</button>
      <button class="btn btn-ghost" :disabled="!picked" data-testid="hs-modal-customs-link" @click="openCustoms"><Icon name="shield" :size="13" />{{ t('customsInfo.viewInfo') }}</button>
      <button class="btn btn-primary" :disabled="!picked || busy || loading" @click="emit('select', { code: picked, predicted: result?.top?.[0]?.code ?? null })">
        <span v-if="busy" class="spin" />{{ t('orders.hs.use') }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.stack { display: flex; flex-direction: column; gap: 8px; }
.mb { margin-bottom: 12px; }
.opts { display: flex; flex-direction: column; gap: 8px; }
.opt { display: grid; grid-template-columns: auto auto 1fr auto; gap: 12px; align-items: center; padding: 10px 12px; border: 1px solid var(--line-2); border-radius: var(--r-md); cursor: pointer; }
.opt.on { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.opt input { accent-color: var(--accent); }
.code { font-weight: 600; font-size: 14px; }
.desc { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.d1 { font-size: 13px; }
.prob { font-size: 13px; font-weight: 600; }
.words { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 14px 0 8px; }
.small { font-size: 12px; }
.spin { width: 14px; height: 14px; border-radius: 999px; border: 2px solid rgba(255,255,255,.35); border-top-color: white; animation: sp .7s linear infinite; }
@keyframes sp { to { transform: rotate(360deg); } }
</style>
