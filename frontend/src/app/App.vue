<script setup>
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppShell from './layouts/AppShell.vue'
import AuthLayout from './layouts/AuthLayout.vue'
import ToastHost from './components/ToastHost.vue'
import ConfirmHost from './components/ConfirmHost.vue'
import { t, locale } from './i18n/index.js'

const route = useRoute()
const layout = computed(() => route.meta.layout ?? 'app')

watch([() => route.meta.title, locale], () => {
  document.title = route.meta.title ? `${t(route.meta.title)} | KargoPazar` : 'KargoPazar | Panel'
}, { immediate: true })
</script>

<template>
  <AppShell v-if="layout === 'app'" />
  <AuthLayout v-else-if="layout === 'auth'" />
  <RouterView v-else />
  <ToastHost />
  <ConfirmHost />
</template>
