<script setup>
// Small SVG country flag (emoji flags do not render on Windows). Unknown codes get a code badge.
import { computed } from 'vue'

const props = defineProps({
  code: { type: String, required: true },
  size: { type: Number, default: 18 }, // height in px (width = 1.5x)
  title: { type: String, default: '' },
})
const c = computed(() => String(props.code || '').toUpperCase())
const w = computed(() => Math.round(props.size * 1.5))
</script>

<template>
  <span class="kpz-flag" :style="{ width: w + 'px', height: size + 'px' }" :title="title || c" role="img" :aria-label="title || c">
    <svg v-if="c === 'US'" viewBox="0 0 30 20" preserveAspectRatio="none">
      <rect width="30" height="20" fill="#B22234" />
      <g fill="#fff"><rect y="1.54" width="30" height="1.54" /><rect y="4.62" width="30" height="1.54" /><rect y="7.7" width="30" height="1.54" /><rect y="10.78" width="30" height="1.54" /><rect y="13.86" width="30" height="1.54" /><rect y="16.94" width="30" height="1.54" /></g>
      <rect width="13" height="10.78" fill="#3C3B6E" />
      <g fill="#fff"><circle cx="2.2" cy="2" r=".6" /><circle cx="5.2" cy="2" r=".6" /><circle cx="8.2" cy="2" r=".6" /><circle cx="11" cy="2" r=".6" /><circle cx="3.7" cy="4.2" r=".6" /><circle cx="6.7" cy="4.2" r=".6" /><circle cx="9.6" cy="4.2" r=".6" /><circle cx="2.2" cy="6.4" r=".6" /><circle cx="5.2" cy="6.4" r=".6" /><circle cx="8.2" cy="6.4" r=".6" /><circle cx="11" cy="6.4" r=".6" /><circle cx="3.7" cy="8.6" r=".6" /><circle cx="6.7" cy="8.6" r=".6" /><circle cx="9.6" cy="8.6" r=".6" /></g>
    </svg>
    <svg v-else-if="c === 'GB'" viewBox="0 0 60 40" preserveAspectRatio="none">
      <rect width="60" height="40" fill="#012169" />
      <path d="M0 0L60 40M60 0L0 40" stroke="#fff" stroke-width="8" />
      <path d="M0 0L60 40M60 0L0 40" stroke="#C8102E" stroke-width="3" />
      <path d="M30 0V40M0 20H60" stroke="#fff" stroke-width="12" />
      <path d="M30 0V40M0 20H60" stroke="#C8102E" stroke-width="7" />
    </svg>
    <svg v-else-if="c === 'TR'" viewBox="0 0 30 20" preserveAspectRatio="none">
      <rect width="30" height="20" fill="#E30A17" />
      <circle cx="11" cy="10" r="5" fill="#fff" />
      <circle cx="12.3" cy="10" r="4" fill="#E30A17" />
      <path d="M16.2 10l3.9-1.3-2.4 3.3V8l2.4 3.3z" fill="#fff" />
    </svg>
    <svg v-else-if="c === 'DE'" viewBox="0 0 30 18" preserveAspectRatio="none">
      <rect width="30" height="6" fill="#000" /><rect y="6" width="30" height="6" fill="#DD0000" /><rect y="12" width="30" height="6" fill="#FFCE00" />
    </svg>
    <svg v-else-if="c === 'FR'" viewBox="0 0 30 20" preserveAspectRatio="none">
      <rect width="10" height="20" fill="#002395" /><rect x="10" width="10" height="20" fill="#fff" /><rect x="20" width="10" height="20" fill="#ED2939" />
    </svg>
    <svg v-else-if="c === 'NL'" viewBox="0 0 30 18" preserveAspectRatio="none">
      <rect width="30" height="6" fill="#AE1C28" /><rect y="6" width="30" height="6" fill="#fff" /><rect y="12" width="30" height="6" fill="#21468B" />
    </svg>
    <svg v-else-if="c === 'CA'" viewBox="0 0 40 20" preserveAspectRatio="none">
      <rect width="40" height="20" fill="#fff" /><rect width="10" height="20" fill="#D52B1E" /><rect x="30" width="10" height="20" fill="#D52B1E" />
      <path d="M20 4l1.2 2.6 2-.8-.8 3.6 2-1.4.4 1.4 1.8-.2-1.2 2 .8.6L22 13.2l.3 1.8H20.4v2.2h-.8V15h-1.9l.3-1.8-4.2-1.6.8-.6-1.2-2 1.8.2.4-1.4 2 1.4-.8-3.6 2 .8z" fill="#D52B1E" />
    </svg>
    <svg v-else-if="c === 'AU'" viewBox="0 0 30 20" preserveAspectRatio="none">
      <rect width="30" height="20" fill="#012169" />
      <path d="M0 0L15 10M15 0L0 10" stroke="#fff" stroke-width="2" /><path d="M7.5 0V10M0 5H15" stroke="#fff" stroke-width="3" /><path d="M7.5 0V10M0 5H15" stroke="#C8102E" stroke-width="1.6" />
      <g fill="#fff"><circle cx="7.5" cy="15" r="1.6" /><circle cx="22.5" cy="5" r=".8" /><circle cx="19" cy="9" r=".8" /><circle cx="25.5" cy="8.5" r=".8" /><circle cx="22.5" cy="16" r=".9" /></g>
    </svg>
    <span v-else class="code">{{ c }}</span>
  </span>
</template>

<style scoped>
.kpz-flag { display: inline-flex; flex-shrink: 0; border-radius: 3px; overflow: hidden; box-shadow: 0 0 0 1px rgba(20, 22, 40, 0.12); vertical-align: middle; background: var(--bg-3); }
.kpz-flag svg { width: 100%; height: 100%; display: block; }
.code { display: grid; place-items: center; width: 100%; height: 100%; font-family: var(--font-mono); font-size: 9px; font-weight: 700; color: var(--ink-2); }
</style>
