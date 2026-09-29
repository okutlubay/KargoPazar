<script setup>
import { ref, computed, onUnmounted } from 'vue'
import { useI18n, APP_LINKS } from '../i18n.js'
import Icon from './Icon.vue'
import SectionHeader from './SectionHeader.vue'

const { t, f } = useI18n()

const STORES = [
  { code: 'shopify', name: 'Shopify', color: '#5E8E3E', logo: 'S', auth: 'oauth', host: 'admin.shopify.com/oauth/authorize' },
  { code: 'etsy', name: 'Etsy', color: '#F1641E', logo: 'Etsy', auth: 'oauth', host: 'www.etsy.com/oauth/connect' },
  { code: 'amazon', name: 'Amazon', color: '#FF9900', logo: 'a', auth: 'oauth', host: 'sellercentral.amazon.com/apps/authorize' },
  { code: 'ebay', name: 'eBay', color: '#E53238', logo: 'eb', auth: 'oauth', host: 'auth.ebay.com/oauth2/authorize' },
  { code: 'woocommerce', name: 'WooCommerce', color: '#7F54B3', logo: 'Woo', auth: 'apikey', host: 'your-store.com/wp-admin/admin.php?page=wc-settings' },
]
const SCOPES = [['read'], ['read'], ['read'], ['read', 'write']]

const selected = ref('shopify')
const step = ref(0)
const connecting = ref(false)
let timer = null
onUnmounted(() => clearTimeout(timer))

const store = computed(() => STORES.find((s) => s.code === selected.value))

const pick = (code) => {
  clearTimeout(timer)
  connecting.value = false
  selected.value = code
  step.value = 0
}
const authorize = () => {
  connecting.value = true
  timer = setTimeout(() => {
    connecting.value = false
    step.value = 2
  }, 900)
}
const cancel = () => {
  clearTimeout(timer)
  connecting.value = false
  step.value = 0
}

const scopeRows = computed(() => t.value.integrations.scopes.map((label, i) => ({
  label,
  scope: SCOPES[i].map((s) => (s === 'read' ? t.value.integrations.scopeRead : t.value.integrations.scopeWrite)).join(' / '),
})))

// API-key stores (WooCommerce) do not use OAuth, so that badge is dropped for them.
const trustItems = computed(() => t.value.integrations.trust.filter((x, i) => !(i === 1 && store.value.auth === 'apikey')))

const browserUrl = computed(() => {
  if (step.value === 0) return 'kargopazar.com/app/#/integrations/stores'
  if (step.value === 1) return store.value.host
  return 'kargopazar.com/app/#/integrations/stores?connected=' + store.value.code
})
</script>

<template>
  <section id="integrations" class="section">
    <div class="container">
      <SectionHeader :eyebrow="t.integrations.eyebrow" :title="t.integrations.title" :sub="t.integrations.sub" />

      <div class="layout">
        <!-- Store list -->
        <div class="card list">
          <div class="mono list-head">{{ t.integrations.pick }}</div>
          <div class="col" style="gap: 2px" role="listbox" :aria-label="t.integrations.pick">
            <button
              v-for="s in STORES"
              :key="s.code"
              type="button"
              role="option"
              :aria-selected="selected === s.code"
              :class="['store-btn', { active: selected === s.code }]"
              @click="pick(s.code)"
            >
              <span class="store-logo" :style="{ background: s.color }">{{ s.logo }}</span>
              <div class="col" style="flex: 1; gap: 2px; min-width: 0">
                <span class="store-name">{{ s.name }}</span>
                <span class="store-desc">{{ t.integrations.stores[s.code] }}</span>
              </div>
              <Icon v-if="selected === s.code" name="arrow" />
            </button>
          </div>
        </div>

        <!-- Connection flow -->
        <div class="card flow">
          <div class="window-bar">
            <div class="dots">
              <span class="dot dot-r" />
              <span class="dot dot-y" />
              <span class="dot dot-g" />
            </div>
            <div class="mono url">{{ browserUrl }}</div>
            <div class="bar-spacer" />
          </div>

          <!-- Step 0: start -->
          <div v-if="step === 0" class="screen center">
            <div class="store-big" :style="{ background: store.color }">{{ store.logo }}</div>
            <div class="col" style="gap: 6px; align-items: center">
              <h3 class="h-3" style="margin: 0">{{ f(t.integrations.connectTitle, { name: store.name }) }}</h3>
              <p class="screen-sub">
                {{ f(store.auth === 'apikey' ? t.integrations.connectDescKey : t.integrations.connectDesc, { name: store.name }) }}
              </p>
            </div>
            <button type="button" class="btn btn-accent" @click="step = 1">
              <Icon :name="store.auth === 'apikey' ? 'key' : 'lock'" />
              {{ f(t.integrations.connectBtn, { name: store.name }) }}
            </button>
            <div class="row mono trust">
              <template v-for="(tr, i) in trustItems" :key="i">
                <span v-if="i" aria-hidden="true">·</span>
                <span class="row" style="gap: 4px"><Icon v-if="i === 0" name="lock" :size="11" /> {{ tr }}</span>
              </template>
            </div>
          </div>

          <!-- Step 1: authorize -->
          <div v-else-if="step === 1" class="screen oauth">
            <div class="row" style="gap: 10px; justify-content: center">
              <div class="oauth-icon dark"><Icon name="logo" :size="22" /></div>
              <div class="row" style="gap: 4px">
                <span v-for="i in 3" :key="i" :class="['oauth-dot', { busy: connecting }]" :style="{ animationDelay: i * 0.15 + 's' }" />
              </div>
              <div class="oauth-icon" :style="{ background: store.color }">{{ store.logo }}</div>
            </div>
            <h3 class="h-3" style="margin: 0; text-align: center">{{ t.integrations.authorizeTitle }}</h3>
            <p class="screen-sub" style="text-align: center; margin: 0 auto">{{ f(t.integrations.authorizeDesc, { name: store.name }) }}</p>
            <div class="card-soft scope-list">
              <div v-for="(r, i) in scopeRows" :key="i" :class="['scope-row', { sep: i > 0 }]">
                <span class="check"><Icon name="check" /></span>
                <span class="scope-label">{{ r.label }}</span>
                <span class="mono scope-tag">{{ r.scope }}</span>
              </div>
            </div>
            <div class="row" style="gap: 8px">
              <button type="button" class="btn btn-ghost" style="flex: 1; justify-content: center" :disabled="connecting" @click="cancel">{{ t.integrations.cancel }}</button>
              <button type="button" class="btn btn-accent" style="flex: 2; justify-content: center" :disabled="connecting" @click="authorize">
                <span v-if="connecting" class="spinner" aria-hidden="true" />
                {{ connecting ? t.integrations.connecting : t.integrations.authorize }}
              </button>
            </div>
          </div>

          <!-- Step 2: connected -->
          <div v-else class="screen center">
            <div class="success-circle"><Icon name="check" :size="26" /></div>
            <div class="col" style="gap: 6px; align-items: center">
              <h3 class="h-3" style="margin: 0">{{ f(t.integrations.connectedTitle, { name: store.name }) }}</h3>
              <p class="screen-sub">{{ t.integrations.connectedDesc }}</p>
            </div>
            <div class="card-soft done-list">
              <div v-for="(l, i) in t.integrations.connectedList" :key="i" class="row done-row">
                <span class="check"><Icon name="check-circle" :size="15" /></span>
                <span>{{ l }}</span>
              </div>
            </div>
            <div class="row" style="gap: 8px; flex-wrap: wrap; justify-content: center">
              <a :href="APP_LINKS.demo" class="btn btn-accent">{{ t.integrations.tryPanel }} <Icon name="arrow" /></a>
              <button type="button" class="btn btn-ghost" @click="step = 0">{{ t.integrations.restart }}</button>
            </div>
          </div>

          <div class="footer-bar">
            <div class="row" style="gap: 6px">
              <span v-for="i in 3" :key="i" :class="['progress', { done: i - 1 <= step }]" />
            </div>
            <span class="mono step-label">{{ step + 1 }}/3 · {{ t.integrations.steps[step] }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.layout {
  margin-top: 56px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  align-items: stretch;
}
.list { padding: 8px; }
.list-head {
  padding: 12px 12px 8px;
  font-size: 10.5px; color: var(--ink-4);
  letter-spacing: 0.08em; text-transform: uppercase;
}
.store-btn {
  border: 0; text-align: left; cursor: pointer;
  padding: 12px; border-radius: 8px;
  background: transparent; color: var(--ink-1);
  display: flex; align-items: center; gap: 12px;
  width: 100%; font: inherit;
}
.store-btn:hover { background: var(--bg-2); }
.store-btn.active { background: var(--bg-2); box-shadow: inset 0 0 0 1px var(--line-2); }
.store-logo {
  width: 36px; height: 36px; border-radius: 8px; flex: 0 0 auto;
  color: white;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-display); font-weight: 700; font-size: 13px;
}
.store-name { font-weight: 600; font-size: 14.5px; }
.store-desc { font-size: 12px; color: var(--ink-3); line-height: 1.4; }

.flow { overflow: hidden; display: flex; flex-direction: column; min-height: 460px; }
.window-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line-1);
  background: var(--bg-2);
}
.bar-spacer { width: 50px; }
.dots { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.dots .dot { width: 9px; height: 9px; border-radius: 999px; }
.dots .dot-r { background: #FF5F57; }
.dots .dot-y { background: #FEBC2E; }
.dots .dot-g { background: #28C840; }
.url { font-size: 11px; color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }

.screen { padding: 32px; flex: 1; display: flex; flex-direction: column; gap: 18px; }
.screen.center { justify-content: center; align-items: center; text-align: center; }
.screen.oauth { padding: 28px; }

.store-big {
  width: 56px; height: 56px; border-radius: 12px;
  color: white; display: flex; align-items: center; justify-content: center;
  font-family: var(--font-display); font-weight: 700; font-size: 20px;
}
.screen-sub { margin: 0; font-size: 13.5px; color: var(--ink-3); max-width: 340px; line-height: 1.5; }
.trust { gap: 10px; font-size: 11px; color: var(--ink-4); margin-top: 8px; flex-wrap: wrap; justify-content: center; }

.oauth-icon {
  width: 40px; height: 40px; border-radius: 8px;
  color: white; display: flex; align-items: center; justify-content: center;
  font-family: var(--font-display); font-weight: 700; font-size: 14px;
}
.oauth-icon.dark { background: var(--ink-1); }
.oauth-dot { width: 4px; height: 4px; border-radius: 999px; background: var(--ink-4); }
.oauth-dot.busy { animation: blink 0.9s ease-in-out infinite; background: var(--accent); }
@keyframes blink { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }

.scope-list { padding: 14px; background: var(--bg-2); }
.scope-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; }
.scope-row.sep { border-top: 1px dashed var(--line-2); }
.check { color: var(--success); display: inline-flex; }
.scope-label { font-size: 13px; flex: 1; }
.scope-tag { font-size: 10.5px; color: var(--ink-4); text-transform: uppercase; letter-spacing: 0.05em; }
.btn:disabled { opacity: 0.7; cursor: progress; transform: none; }
.spinner {
  width: 14px; height: 14px; border-radius: 999px;
  border: 2px solid rgba(255, 255, 255, 0.4); border-top-color: white;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.success-circle {
  width: 56px; height: 56px; border-radius: 999px;
  background: var(--success); color: white;
  display: flex; align-items: center; justify-content: center;
}
.done-list { padding: 12px 16px; width: 100%; max-width: 360px; background: var(--bg-2); text-align: left; }
.done-row { gap: 10px; padding: 6px 0; font-size: 13px; }

.footer-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-top: 1px solid var(--line-1);
  background: var(--bg-2); margin-top: auto;
}
.progress { height: 4px; width: 28px; border-radius: 999px; background: var(--line-2); }
.progress.done { background: var(--accent); }
.step-label { font-size: 11px; color: var(--ink-3); }

@media (max-width: 860px) {
  .layout { grid-template-columns: 1fr; }
  .screen, .screen.oauth { padding: 22px; }
}
</style>
