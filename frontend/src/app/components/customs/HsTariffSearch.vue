<script setup>
// Search the bundled 6-digit tariff (5,600+ HS codes) by description words or code prefix.
//   <HsTariffSearch :initial="description" @pick="code => ..." />
import { ref, computed, watch, onMounted } from 'vue'
import Icon from '@/components/Icon.vue'
import { useI18n } from '@/app/i18n/index.js'
import { loadTariff, searchHs, tariffVersion } from '@/shared/tariff/index.js'

const props = defineProps({ initial: { type: String, default: '' }, limit: { type: Number, default: 6 }, compact: { type: Boolean, default: false } })
const emit = defineEmits(['pick'])
const { t } = useI18n()
const q = ref(props.initial)
watch(() => props.initial, v => { if (!q.value) q.value = v })
const loading = ref(true)
onMounted(() => { loadTariff().finally(() => { loading.value = false }) })
const results = computed(() => { void tariffVersion.value; return searchHs(q.value, props.limit) })
</script>

<template>
  <div class="hts" :class="{ compact }" data-testid="hs-tariff-search">
    <div class="hts-head">
      <Icon name="search" :size="12" />
      <span class="hts-title">{{ t('customsInfo.tariff.title') }}</span>
    </div>
    <input v-model="q" class="input input-sm" :placeholder="t('customsInfo.tariff.placeholder')" data-testid="hs-tariff-query" @keydown.enter.prevent="results[0] && emit('pick', results[0].code)" />
    <div v-if="loading" class="muted small">{{ t('common.loading') }}</div>
    <template v-else>
      <button v-for="r in results" :key="r.code" type="button" class="hts-opt" :data-testid="'hs-tariff-hit-' + r.code" @click="emit('pick', r.code)">
        <span class="mono strong">{{ r.code }}</span>
        <span class="hts-desc">{{ r.desc }}</span>
      </button>
      <div v-if="q && !results.length" class="muted small">{{ t('customsInfo.tariff.none') }}</div>
      <div class="muted tiny">{{ t('customsInfo.tariff.hint') }}</div>
    </template>
  </div>
</template>

<style scoped>
.hts { display: flex; flex-direction: column; gap: 6px; }
.hts-head { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 12.5px; color: var(--ink-2); }
.input-sm { height: 32px; font-size: 13px; }
.hts-opt { display: grid; grid-template-columns: auto 1fr; gap: 8px; align-items: start; padding: 7px 8px; border-radius: 8px; border: 1px solid var(--line-1); background: var(--surface); text-align: left; cursor: pointer; font-size: 12.5px; color: var(--ink-1); }
.hts-opt:hover { border-color: var(--accent); background: var(--accent-soft); }
.hts-desc { color: var(--ink-2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.strong { font-weight: 600; }
.small { font-size: 12px; }
.tiny { font-size: 11px; }
</style>
