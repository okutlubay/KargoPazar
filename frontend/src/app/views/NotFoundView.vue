<script setup>
import EmptyState from '../components/EmptyState.vue'
import { t } from '../i18n/index.js'
</script>

<template>
  <div class="page">
    <div class="panel">
      <EmptyState icon="search" :title="t('common.notFoundTitle')" :description="t('common.notFoundDesc')">
        <RouterLink :to="{ name: 'overview' }" class="btn btn-primary btn-sm">{{ t('common.goHome') }}</RouterLink>
      </EmptyState>
    </div>
  </div>
</template>
