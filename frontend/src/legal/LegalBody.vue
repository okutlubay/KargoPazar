<script setup>
// Renders one legal text body (see src/legal/content.js for the item format).
defineProps({ body: { type: Array, required: true } })
</script>

<template>
  <div class="legal-body">
    <template v-for="(item, i) in body" :key="i">
      <h3 v-if="item && item.h" class="lh">{{ item.h }}</h3>
      <ul v-else-if="item && item.ul" class="lul">
        <li v-for="(li, j) in item.ul" :key="j">{{ li }}</li>
      </ul>
      <p v-else class="para">{{ item }}</p>
    </template>
  </div>
</template>

<style scoped>
.lh { margin: 20px 0 8px; font-size: 15px; font-weight: 600; color: var(--ink-1); }
.lh:first-child { margin-top: 0; }
.para { margin: 0 0 12px; font-size: 14px; line-height: 1.6; color: var(--ink-2); }
.lul { margin: 0 0 12px; padding-left: 20px; font-size: 14px; line-height: 1.6; color: var(--ink-2); }
.lul li { margin-bottom: 4px; }
</style>
