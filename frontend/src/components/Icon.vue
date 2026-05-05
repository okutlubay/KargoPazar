<script setup>
defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 16 },
})
</script>

<template>
  <svg v-if="name === 'logo'" :width="size" :height="size" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <rect x="2" y="2" width="28" height="28" rx="7" fill="var(--ink-1)"/>
    <path d="M9 9 L9 23 M9 16 L18 9 M9 16 L18 23" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="22.5" cy="9.5" r="2" fill="var(--accent-2)"/>
  </svg>
  <svg v-else-if="name === 'arrow'" :width="size" :height="size" viewBox="0 0 16 16" fill="none">
    <path d="M3 8h10m0 0L8.5 3.5M13 8l-4.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'check'" :width="size" :height="size" viewBox="0 0 16 16" fill="none">
    <path d="M3 8.5L6.5 12L13 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'spark'" :width="size" :height="size" viewBox="0 0 16 16" fill="none">
    <path d="M8 1.5l1.5 4L13.5 7l-4 1.5L8 12.5L6.5 8.5L2.5 7l4-1.5L8 1.5z" fill="currentColor"/>
  </svg>
  <svg v-else-if="name === 'bolt'" :width="size" :height="size" viewBox="0 0 16 16" fill="none">
    <path d="M9 1L3 9h4l-1 6 6-8H8l1-6z" fill="currentColor"/>
  </svg>
  <svg v-else-if="name === 'globe'" :width="size" :height="size" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/>
    <path d="M1.5 8h13M8 1.5c2 2 3 4 3 6.5s-1 4.5-3 6.5c-2-2-3-4-3-6.5s1-4.5 3-6.5z" stroke="currentColor" stroke-width="1.4"/>
  </svg>
  <svg v-else-if="name === 'lock'" :width="size" :height="size" viewBox="0 0 16 16" fill="none">
    <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.4"/>
    <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" stroke-width="1.4"/>
  </svg>
  <svg v-else-if="name === 'box'" :width="size" :height="size" viewBox="0 0 16 16" fill="none">
    <path d="M8 1.5L14 4.5V11.5L8 14.5L2 11.5V4.5L8 1.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M2 4.5L8 7.5L14 4.5M8 7.5V14.5" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'truck'" :width="size" :height="size" viewBox="0 0 16 16" fill="none">
    <path d="M1.5 4.5h8v6.5h-8z" stroke="currentColor" stroke-width="1.4"/>
    <path d="M9.5 7h3l2 2v2h-5z" stroke="currentColor" stroke-width="1.4"/>
    <circle cx="4.5" cy="12" r="1.4" fill="var(--bg)" stroke="currentColor" stroke-width="1.4"/>
    <circle cx="11.5" cy="12" r="1.4" fill="var(--bg)" stroke="currentColor" stroke-width="1.4"/>
  </svg>
  <svg v-else-if="name === 'brain'" :width="size" :height="size" viewBox="0 0 16 16" fill="none">
    <path d="M5.5 3a2 2 0 00-2 2v.5a2 2 0 00-1 1.7v.6a2 2 0 001 1.7V11a2 2 0 002 2h.5V3h-.5zM10.5 3a2 2 0 012 2v.5a2 2 0 011 1.7v.6a2 2 0 01-1 1.7V11a2 2 0 01-2 2h-.5V3h.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'pin'" :width="size" :height="size" viewBox="0 0 16 16" fill="none">
    <path d="M8 14s5-4.5 5-8.5a5 5 0 10-10 0c0 4 5 8.5 5 8.5z" stroke="currentColor" stroke-width="1.4"/>
    <circle cx="8" cy="5.5" r="1.8" fill="currentColor"/>
  </svg>
  <svg v-else-if="name === 'search'" :width="size" :height="size" viewBox="0 0 16 16" fill="none">
    <circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.4"/>
    <path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>
  <svg v-else-if="name === 'bell'" :width="size" :height="size" viewBox="0 0 16 16" fill="none">
    <path d="M3 11h10l-1.5-2V7a3.5 3.5 0 00-7 0v2L3 11zM6 13a2 2 0 004 0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
</template>
