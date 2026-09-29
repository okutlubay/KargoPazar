<script setup>
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import PageHeader from '../../components/PageHeader.vue'
import OrderDetail from '../../components/orders/OrderDetail.vue'
import { t } from '../../i18n/index.js'

const route = useRoute()
const id = computed(() => String(route.params.id))
const order = ref(null)
</script>

<template>
  <div class="page page-narrow">
    <PageHeader :title="t('orders.detail.pageTitle', { id })" :subtitle="order ? `${order.customer?.name ?? ''} · ${order.shipTo?.city ?? ''}, ${order.shipTo?.state ?? ''}` : ''" />
    <OrderDetail :order-id="id" layout="page" @loaded="o => (order = o)" @changed="o => (order = o)" />
  </div>
</template>

<style scoped>
.page-narrow { max-width: 1080px; }
</style>
