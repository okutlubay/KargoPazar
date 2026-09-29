<script setup>
import Icon from '@/components/Icon.vue'
import { t } from '../i18n/index.js'

defineProps({ name: { type: String, default: '' } })
</script>

<template>
  <div class="page">
    <div class="panel panel-pad ph">
      <Icon name="layers" :size="22" />
      <div class="h">{{ t('placeholder.title') }}</div>
      <div class="muted mono">{{ name }}</div>
    </div>
  </div>
</template>

<style scoped>
.ph { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 64px 20px; color: var(--ink-3); }
.h { font-family: var(--font-display); font-weight: 600; color: var(--ink-1); font-size: 16px; }
</style>
