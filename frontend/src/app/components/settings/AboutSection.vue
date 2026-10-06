<script setup>
// Settings > About: platform provider (shared/company.js), app version and the demo company.
import { computed } from 'vue'
import Card from '../Card.vue'
import { useI18n } from '../../i18n/index.js'
import { db } from '../../store/db.js'
import { PLATFORM_COMPANY as CO, formatAddress } from '@/shared/company.js'

const { t } = useI18n()
const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '-'
const buildDate = typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : '-'

const platformRows = computed(() => [
  [t('about.legalName'), CO.legalName],
  [t('about.address'), CO.addressLine],
  [t('about.phone'), CO.phone],
  [t('about.email'), CO.email],
  [t('about.taxOffice'), CO.taxOffice],
  [t('about.taxId'), CO.taxId],
])

const company = computed(() => db.doc('user')?.company ?? {})
const demoRows = computed(() => [
  [t('about.legalName'), company.value.legalName || company.value.name],
  [t('about.address'), formatAddress(company.value.hqAddress)],
  [t('about.phone'), company.value.phone],
  [t('about.taxOffice'), company.value.taxOffice],
  [t('about.taxId'), company.value.taxId],
].filter(r => r[1]))

const appRows = computed(() => [
  [t('about.version'), 'v' + version],
  [t('about.build'), buildDate],
  [t('about.seed'), db.seedVersion],
])
</script>

<template>
  <div class="stack-lg">
    <Card :title="t('about.platform')" :subtitle="t('about.desc')">
      <dl class="kv">
        <template v-for="[k, v] in platformRows" :key="k">
          <dt>{{ k }}</dt><dd :class="{ mono: k === t('about.taxId') || k === t('about.phone') }">{{ v }}</dd>
        </template>
      </dl>
    </Card>
    <Card :title="t('about.version')">
      <dl class="kv">
        <template v-for="[k, v] in appRows" :key="k">
          <dt>{{ k }}</dt><dd class="mono">{{ v }}</dd>
        </template>
      </dl>
    </Card>
    <Card :title="t('about.demoCompany')">
      <dl class="kv">
        <template v-for="[k, v] in demoRows" :key="k">
          <dt>{{ k }}</dt><dd>{{ v }}</dd>
        </template>
      </dl>
    </Card>
  </div>
</template>

<style scoped>
.kv { display: grid; grid-template-columns: 200px 1fr; gap: 10px 16px; margin: 0; font-size: 13.5px; }
.kv dt { color: var(--ink-3); }
.kv dd { margin: 0; color: var(--ink-1); overflow-wrap: anywhere; }
@media (max-width: 640px) { .kv { grid-template-columns: 1fr; gap: 2px; } .kv dd { margin-bottom: 8px; } }
</style>
