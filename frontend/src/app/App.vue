<script setup>
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppShell from './layouts/AppShell.vue'
import AuthLayout from './layouts/AuthLayout.vue'
import ToastHost from './components/ToastHost.vue'
import ConfirmHost from './components/ConfirmHost.vue'
import { t, locale } from './i18n/index.js'
import { db } from './store/db.js'
import { toast } from './components/toast.js'

const route = useRoute()
const layout = computed(() => route.meta.layout ?? 'app')

watch([() => route.meta.title, locale], () => {
  document.title = route.meta.title ? `${t(route.meta.title)} | KargoPazar` : 'KargoPazar | Panel'
}, { immediate: true })

// Save status toasts: one warning when a save fails (retries continue silently), one success on recovery.
let failToast = null
watch(() => db.syncState.status, (now, before) => {
  if (now === 'error' && failToast == null) failToast = toast.warning(t('sync.failedRetrying'), { duration: 6000 })
  else if (now === 'idle' && before !== undefined && failToast != null) {
    toast.dismiss(failToast)
    failToast = null
    if (db.ready && !db.syncState.error && db.syncState.lastSavedAt) toast.success(t('sync.recovered'))
  }
})
</script>

<template>
  <AppShell v-if="layout === 'app'" />
  <AuthLayout v-else-if="layout === 'auth'" />
  <RouterView v-else />
  <ToastHost />
  <ConfirmHost />
</template>
