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
  <svg v-else-if="name === 'home'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2.5 7.5L8 3l5.5 4.5V13a.5.5 0 01-.5.5H10v-4H6v4H3a.5.5 0 01-.5-.5V7.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'list'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M5.5 4h8M5.5 8h8M5.5 12h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="2.8" cy="4" r=".9" fill="currentColor"/><circle cx="2.8" cy="8" r=".9" fill="currentColor"/><circle cx="2.8" cy="12" r=".9" fill="currentColor"/>
  </svg>
  <svg v-else-if="name === 'layers'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 2l6 3-6 3-6-3 6-3z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M2 8l6 3 6-3M2 11l6 3 6-3" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'file'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 1.5h5l3.5 3.5v9a.5.5 0 01-.5.5H4a.5.5 0 01-.5-.5v-12A.5.5 0 014 1.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M9 1.5V5h3.5M5.5 8.5h5M5.5 11h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>
  <svg v-else-if="name === 'warehouse'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M1.5 6L8 2.5 14.5 6v7.5h-13V6z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M4.5 13.5V8.5h7v5M4.5 11h7" stroke="currentColor" stroke-width="1.4"/>
  </svg>
  <svg v-else-if="name === 'radar'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.4"/><path d="M8 8l4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>
  <svg v-else-if="name === 'plane'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M14 2L2 7l4.5 1.5L8 13l2-3.5L14 2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M6.5 8.5L14 2" stroke="currentColor" stroke-width="1.4"/>
  </svg>
  <svg v-else-if="name === 'shield'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 1.5l5.5 2v4c0 3.5-2.5 6-5.5 7-3-1-5.5-3.5-5.5-7v-4l5.5-2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'flask'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M6 1.5h4M6.5 1.5v4.5L2.8 12.6a1.2 1.2 0 001 1.9h8.4a1.2 1.2 0 001-1.9L9.5 6V1.5" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M4.5 10h7" stroke="currentColor" stroke-width="1.4"/>
  </svg>
  <svg v-else-if="name === 'store'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2 6l1-3.5h10L14 6M2 6v7.5h12V6M2 6c0 1 .8 1.8 2 1.8S6 7 6 6c0 1 .8 1.8 2 1.8S10 7 10 6c0 1 .8 1.8 2 1.8S14 7 14 6" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M6.5 13.5v-3h3v3" stroke="currentColor" stroke-width="1.4"/>
  </svg>
  <svg v-else-if="name === 'key'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="5" cy="11" r="3" stroke="currentColor" stroke-width="1.4"/><path d="M7.2 8.8L13.5 2.5M11 5l1.8 1.8M12.5 3.5l1.5 1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>
  <svg v-else-if="name === 'code'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5M9 3l-2 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'wallet'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="1.5" y="3.5" width="13" height="10" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M1.5 6.5h13M11 10h1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>
  <svg v-else-if="name === 'star'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 1.8l1.9 3.9 4.2.6-3 3 .7 4.2L8 11.5l-3.8 2 .7-4.2-3-3 4.2-.6L8 1.8z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'settings'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="2.2" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>
  <svg v-else-if="name === 'tag'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M1.5 8.5V2a.5.5 0 01.5-.5h6.5l6 6-7 7-6-6z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="5" cy="5" r="1.2" fill="currentColor"/>
  </svg>
  <svg v-else-if="name === 'server'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="2" y="2" width="12" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="2" y="9" width="12" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/><circle cx="4.8" cy="4.5" r=".9" fill="currentColor"/><circle cx="4.8" cy="11.5" r=".9" fill="currentColor"/>
  </svg>
  <svg v-else-if="name === 'flag'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 14.5V2M3 2.5h9l-2 3 2 3H3" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>
  <svg v-else-if="name === 'users'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="6" cy="5.5" r="2.5" stroke="currentColor" stroke-width="1.4"/><path d="M1.5 13.5c.5-2.5 2.3-3.8 4.5-3.8s4 1.3 4.5 3.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M10.5 3.2a2.4 2.4 0 010 4.6M12 9.9c1.3.5 2.2 1.7 2.5 3.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>
  <svg v-else-if="name === 'user'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="5.5" r="3" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 14c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>
  <svg v-else-if="name === 'map'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M1.5 3.5l4-1.5 5 2 4-1.5v10l-4 1.5-5-2-4 1.5v-10z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M5.5 2v10M10.5 4v10" stroke="currentColor" stroke-width="1.4"/>
  </svg>
  <svg v-else-if="name === 'chart'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2 2v12h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M4.5 10.5l3-3.5 2.5 2 4-5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'bar'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 14V8M8 14V3M13 14v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>
  <svg v-else-if="name === 'dollar'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 1.5v13M11 4.5c-.5-1-1.6-1.5-3-1.5-1.8 0-3 .9-3 2.3 0 3.2 6.3 1.8 6.3 5 0 1.4-1.3 2.4-3.3 2.4-1.6 0-2.8-.6-3.3-1.7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>
  <svg v-else-if="name === 'route'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="3.5" cy="12.5" r="2" stroke="currentColor" stroke-width="1.4"/><circle cx="12.5" cy="3.5" r="2" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 12.5h4a2.5 2.5 0 000-5h-3a2.5 2.5 0 010-5h4" stroke="currentColor" stroke-width="1.4"/>
  </svg>
  <svg v-else-if="name === 'plus'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  </svg>
  <svg v-else-if="name === 'minus'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  </svg>
  <svg v-else-if="name === 'x'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  </svg>
  <svg v-else-if="name === 'chevron-down'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'chevron-up'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 10l4-4 4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'chevron-right'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'chevron-left'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M10 4L6 8l4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'more'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="3.5" cy="8" r="1.2" fill="currentColor"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="12.5" cy="8" r="1.2" fill="currentColor"/>
  </svg>
  <svg v-else-if="name === 'menu'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>
  <svg v-else-if="name === 'sidebar'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M6 2.5v11" stroke="currentColor" stroke-width="1.4"/>
  </svg>
  <svg v-else-if="name === 'download'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 2v8.5M4.5 7L8 10.5 11.5 7M2.5 13.5h11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'upload'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 10.5V2M4.5 5.5L8 2l3.5 3.5M2.5 13.5h11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'printer'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 6V1.5h8V6M4 11.5H2.5V6h11v5.5H12" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><rect x="4" y="9.5" width="8" height="5" stroke="currentColor" stroke-width="1.4"/>
  </svg>
  <svg v-else-if="name === 'copy'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M11 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v7a1 1 0 001 1h2" stroke="currentColor" stroke-width="1.4"/>
  </svg>
  <svg v-else-if="name === 'refresh'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M13.5 8a5.5 5.5 0 11-1.6-3.9M13.5 2v3h-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'sync'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2.5 6.5A5.5 5.5 0 0112.6 4.5M13.5 9.5A5.5 5.5 0 013.4 11.5M12.8 1.8v3h-3M3.2 14.2v-3h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'filter'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2 3h12l-4.5 5.5V13l-3 1.5v-6L2 3z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'calendar'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M2 6.5h12M5 1.5v3M11 1.5v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>
  <svg v-else-if="name === 'clock'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M8 4.5V8l2.5 1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>
  <svg v-else-if="name === 'info'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M8 7.2V11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="4.8" r=".9" fill="currentColor"/>
  </svg>
  <svg v-else-if="name === 'alert'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 1.8L14.8 13.5H1.2L8 1.8z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 6.2v3.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.6" r=".85" fill="currentColor"/>
  </svg>
  <svg v-else-if="name === 'check-circle'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M5 8.2l2 2L11 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'x-circle'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>
  <svg v-else-if="name === 'eye'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.4"/>
  </svg>
  <svg v-else-if="name === 'eye-off'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2 2l12 12M6.5 3.7A6.5 6.5 0 018 3.5c4 0 6.5 4.5 6.5 4.5a11 11 0 01-1.9 2.4M4.2 4.9C2.5 6.1 1.5 8 1.5 8S4 12.5 8 12.5a6 6 0 003-.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>
  <svg v-else-if="name === 'link'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M6.5 9.5a3 3 0 004.2 0l2.3-2.3a3 3 0 00-4.2-4.2l-1 1M9.5 6.5a3 3 0 00-4.2 0L3 8.8A3 3 0 007.2 13l1-1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>
  <svg v-else-if="name === 'external'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M9 2.5h4.5V7M13.5 2.5L7 9M11.5 9.5v3.5a.5.5 0 01-.5.5H3a.5.5 0 01-.5-.5V5a.5.5 0 01.5-.5h3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'edit'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M10.5 2.5l3 3L5 14H2v-3l8.5-8.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'trash'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'play'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4.5 2.5v11l9-5.5-9-5.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'pause'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M5 3v10M11 3v10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg>
  <svg v-else-if="name === 'scan'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M1.5 5V2.5a1 1 0 011-1H5M11 1.5h2.5a1 1 0 011 1V5M14.5 11v2.5a1 1 0 01-1 1H11M5 14.5H2.5a1 1 0 01-1-1V11M4.5 5v6M7 5v6M9 5v6M11.5 5v6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>
  <svg v-else-if="name === 'scale'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2 13.5h12M8 3v10.5M3 5.5h10M3 5.5L1.5 9.5a1.8 1.8 0 003 0L3 5.5zM13 5.5l-1.5 4a1.8 1.8 0 003 0L13 5.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'grip'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="6" cy="4" r="1" fill="currentColor"/><circle cx="10" cy="4" r="1" fill="currentColor"/><circle cx="6" cy="8" r="1" fill="currentColor"/><circle cx="10" cy="8" r="1" fill="currentColor"/><circle cx="6" cy="12" r="1" fill="currentColor"/><circle cx="10" cy="12" r="1" fill="currentColor"/>
  </svg>
  <svg v-else-if="name === 'logout'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M6 2.5H3a.5.5 0 00-.5.5v10a.5.5 0 00.5.5h3M10.5 5l3 3-3 3M13.5 8H6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'mail'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="1.5" y="3" width="13" height="10" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M2 4l6 5 6-5" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'card'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="1.5" y="3" width="13" height="10" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M1.5 6.5h13M4 10.5h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>
  <svg v-else-if="name === 'terminal'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M4.5 6l2 2-2 2M8 10.5h3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'keyboard'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="1.5" y="4" width="13" height="8.5" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M4 7h.5M6.5 7H7M9 7h.5M11.5 7h.5M4.5 10h7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>
  <svg v-else-if="name === 'database'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <ellipse cx="8" cy="3.5" rx="5.5" ry="2" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 3.5v9c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-9M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2" stroke="currentColor" stroke-width="1.4"/>
  </svg>
  <svg v-else-if="name === 'webhook'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="4" cy="11.5" r="2" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="11.5" r="2" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="4" r="2" stroke="currentColor" stroke-width="1.4"/><path d="M6.7 5.6L4.6 9.6M9.3 5.6l2.1 4M6 11.5h4" stroke="currentColor" stroke-width="1.4"/>
  </svg>
  <svg v-else-if="name === 'package-check'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 1.5L14 4.5V11.5L8 14.5L2 11.5V4.5L8 1.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M5.5 8l1.8 1.8L10.8 6.3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'return'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M5.5 3L2 6.5 5.5 10M2 6.5h8a4 4 0 010 8H7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'sort'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M5 2.5v11M2.5 5L5 2.5 7.5 5M11 13.5v-11M8.5 11l2.5 2.5 2.5-2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'target'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="3.5" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="1" fill="currentColor"/>
  </svg>
  <svg v-else-if="name === 'wand'" :width="size" :height="size" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2 14l8.5-8.5M9 3l1-1.5L11 3l1.5 1-1.5 1L10 6.5 9 5 7.5 4 9 3zM13 8.5l.5-1 .5 1 1 .5-1 .5-.5 1-.5-1-1-.5 1-.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
  </svg>
</template>
