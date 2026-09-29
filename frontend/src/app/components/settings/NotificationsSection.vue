<script setup>
import { ref, computed, onMounted } from 'vue'
import Card from '../Card.vue'
import Toggle from '../Toggle.vue'
import Skeleton from '../Skeleton.vue'
import Spinner from '../Spinner.vue'
import { toast } from '../toast.js'
import { useI18n } from '../../i18n/index.js'
import { can } from '../../store/session.js'
import { getSettings, updateNotificationPrefs, NOTIFICATION_EVENTS, NOTIFICATION_CHANNELS } from '../../api/settings.js'
import { errorText } from './util.js'

const { t } = useI18n()
const loading = ref(true)
const saving = ref(false)
const prefs = ref({})
let initial = ''
const dirty = computed(() => JSON.stringify(prefs.value) !== initial)
const locked = computed(() => !can('settings.manage'))
const email = ref('')

onMounted(async () => {
  try {
    const s = await getSettings()
    prefs.value = s.notificationPrefs
    email.value = s.user.email
    initial = JSON.stringify(prefs.value)
  } catch (e) { toast.error(errorText(e)) } finally { loading.value = false }
})

function allOn(ch) { return NOTIFICATION_EVENTS.every(e => prefs.value[e]?.[ch]) }
function setAll(ch, v) { for (const e of NOTIFICATION_EVENTS) prefs.value[e][ch] = v }
const counts = computed(() => Object.fromEntries(NOTIFICATION_CHANNELS.map(ch => [ch, NOTIFICATION_EVENTS.filter(e => prefs.value[e]?.[ch]).length])))

async function save() {
  saving.value = true
  try {
    prefs.value = await updateNotificationPrefs(prefs.value)
    initial = JSON.stringify(prefs.value)
    toast.success(t('settings.notifications.saved'))
  } catch (e) { toast.error(errorText(e)) } finally { saving.value = false }
}
</script>

<template>
  <Card :title="t('settings.notifications.title')" :subtitle="t('settings.notifications.desc', { email })" padding="none">
    <div v-if="loading" class="pad"><Skeleton :lines="8" /></div>
    <div v-else class="table-wrap">
      <table class="table-simple matrix">
        <thead>
          <tr>
            <th>{{ t('settings.notifications.event') }}</th>
            <th v-for="ch in NOTIFICATION_CHANNELS" :key="ch" class="c">
              <div class="chh">
                <span>{{ t('settings.notifications.channels.' + ch) }}</span>
                <span class="cnt">{{ counts[ch] }}/{{ NOTIFICATION_EVENTS.length }}</span>
                <button class="btn-link small" :disabled="locked" @click="setAll(ch, !allOn(ch))">{{ allOn(ch) ? t('settings.notifications.noneAll') : t('settings.notifications.selectAll') }}</button>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in NOTIFICATION_EVENTS" :key="e">
            <td>
              <div class="ev">{{ t('settings.notifications.events.' + e + '.title') }}</div>
              <div class="evd">{{ t('settings.notifications.events.' + e + '.desc') }}</div>
            </td>
            <td v-for="ch in NOTIFICATION_CHANNELS" :key="ch" class="c">
              <Toggle v-model="prefs[e][ch]" size="sm" :disabled="locked" :aria-label="t('settings.notifications.toggleAria', { event: t('settings.notifications.events.' + e + '.title'), channel: t('settings.notifications.channels.' + ch) })" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <template v-if="!loading" #footer>
      <div class="actions">
        <span class="note">{{ t('settings.notifications.note') }}</span>
        <button class="btn btn-ghost" :disabled="!dirty || saving" @click="prefs = JSON.parse(initial)">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="!dirty || saving || locked" :title="locked ? t('common.noPermission') : undefined" @click="save">
          <Spinner v-if="saving" :size="14" />{{ saving ? t('common.saving') : t('common.save') }}
        </button>
      </div>
    </template>
  </Card>
</template>

<style scoped>
.pad { padding: 18px 20px; }
.matrix td, .matrix th { padding-left: 20px; }
.c { text-align: center; width: 150px; }
.chh { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.cnt { font-family: var(--font-mono); font-size: 11px; color: var(--ink-4); }
.small { font-size: 11.5px; }
.ev { font-weight: 500; }
.evd { font-size: 12.5px; color: var(--ink-3); }
.c :deep(.toggle), .c :deep(label) { justify-content: center; }
.actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; flex-wrap: wrap; }
.note { margin-right: auto; font-size: 12.5px; color: var(--ink-3); }
</style>
