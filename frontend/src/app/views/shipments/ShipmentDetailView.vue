<script setup>
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import PageHeader from '../../components/PageHeader.vue'
import ShipmentDetail from '../../components/shipments/ShipmentDetail.vue'
import { t } from '../../i18n/index.js'

const route = useRoute()
const id = computed(() => String(route.params.id))
const s = ref(null)
</script>

<template>
  <div class="page page-narrow">
    <PageHeader :title="t('shipments.detail.pageTitle', { id })" :subtitle="s ? `${s.to?.name ?? ''} · ${s.to?.city ?? ''}, ${s.to?.state ?? ''}` : ''" />
    <ShipmentDetail :shipment-id="id" layout="page" @loaded="x => (s = x)" @changed="x => (s = x)" />
  </div>
</template>

<style scoped>
.page-narrow { max-width: 1100px; }
</style>
