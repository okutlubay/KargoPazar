<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '@/services/api';

const status = ref<string>('checking...');
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    const { data } = await api.get<{ status: string; service: string; time: string }>('/health');
    status.value = `${data.status} (${data.service}) @ ${data.time}`;
  } catch (e: any) {
    error.value = e?.message ?? 'unknown error';
    status.value = 'unreachable';
  }
});
</script>

<template>
  <section>
    <h1>KargoPazar</h1>
    <p>API health: <strong>{{ status }}</strong></p>
    <p v-if="error" style="color: #b91c1c;">{{ error }}</p>
  </section>
</template>
