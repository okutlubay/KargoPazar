<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import Card from '../Card.vue'
import FormField from '../FormField.vue'
import Skeleton from '../Skeleton.vue'
import Spinner from '../Spinner.vue'
import SegmentedControl from '../SegmentedControl.vue'
import DateTime from '../DateTime.vue'
import { required, email as emailRule, validateAll } from '../validation.js'
import { toast } from '../toast.js'
import { useI18n } from '../../i18n/index.js'
import { getSettings, updateProfile, TIMEZONES } from '../../api/settings.js'
import { errorText, fieldErrors } from './util.js'

const { t, setLocale, locale } = useI18n()
const loading = ref(true)
const saving = ref(false)
const form = reactive({ name: '', email: '', phone: '', timezone: 'America/New_York', lang: 'tr' })
const meta = ref(null)
const errors = ref({})
const fields = ref([])
let initial = ''

const initials = computed(() => form.name.trim().split(/\s+/).filter(Boolean).map(p => p[0]).slice(0, 2).join('').toUpperCase() || '?')
const dirty = computed(() => JSON.stringify(form) !== initial)

async function load() {
  loading.value = true
  try {
    const s = await getSettings()
    Object.assign(form, { name: s.user.name, email: s.user.email, phone: s.user.phone ?? '', timezone: s.user.timezone, lang: locale.value })
    meta.value = s.user
    initial = JSON.stringify(form)
  } catch (e) { toast.error(errorText(e)) } finally { loading.value = false }
}
onMounted(load)

async function save() {
  errors.value = {}
  if (!validateAll(fields.value)) return
  saving.value = true
  try {
    await updateProfile({ ...form })
    if (form.lang !== locale.value) setLocale(form.lang)
    initial = JSON.stringify(form)
    toast.success(t('settings.profile.saved'))
  } catch (e) {
    errors.value = fieldErrors(e)
    toast.error(errorText(e))
  } finally { saving.value = false }
}
function reset() { Object.assign(form, JSON.parse(initial)); errors.value = {} }
</script>

<template>
  <Card :title="t('settings.profile.title')" :subtitle="t('settings.profile.desc')">
    <div v-if="loading" class="stack"><Skeleton :lines="6" /></div>
    <form v-else class="stack-lg" novalidate @submit.prevent="save">
      <div class="avatar-row">
        <div class="avatar" aria-hidden="true">{{ initials }}</div>
        <div>
          <div class="av-name">{{ form.name || '-' }}</div>
          <div class="av-sub">{{ t('settings.profile.avatarHint') }}</div>
          <div v-if="meta" class="av-sub">{{ t('settings.profile.username') }}: <span class="mono">{{ meta.username }}</span> · {{ t('settings.profile.memberSince') }} <DateTime :value="meta.createdAt" mode="date" /></div>
        </div>
      </div>
      <div class="form-grid">
        <FormField :ref="el => (fields[0] = el)" :label="t('settings.profile.name')" required :value="form.name" :error="errors.name" v-slot="{ id, invalid, describedBy }">
          <input :id="id" v-model="form.name" class="input" autocomplete="name" :aria-invalid="invalid" :aria-describedby="describedBy" />
        </FormField>
        <FormField :ref="el => (fields[1] = el)" :label="t('settings.profile.email')" required :rules="[emailRule()]" :value="form.email" :error="errors.email" v-slot="{ id, invalid, describedBy }">
          <input :id="id" v-model="form.email" type="email" class="input" autocomplete="email" :aria-invalid="invalid" :aria-describedby="describedBy" />
        </FormField>
        <FormField :ref="el => (fields[2] = el)" :label="t('settings.profile.phone')" optional :value="form.phone" :error="errors.phone" v-slot="{ id, invalid, describedBy }">
          <input :id="id" v-model="form.phone" class="input" autocomplete="tel" :aria-invalid="invalid" :aria-describedby="describedBy" />
        </FormField>
        <FormField :label="t('settings.profile.timezone')" :value="form.timezone" v-slot="{ id }">
          <select :id="id" v-model="form.timezone" class="select">
            <option v-for="tz in TIMEZONES" :key="tz" :value="tz">{{ tz.replace('_', ' ') }}</option>
          </select>
        </FormField>
        <div class="full">
          <div class="lbl">{{ t('settings.profile.language') }}</div>
          <SegmentedControl v-model="form.lang" :options="[{ value: 'tr', label: 'Türkçe' }, { value: 'en', label: 'English' }]" :aria-label="t('settings.profile.language')" />
        </div>
      </div>
      <div class="actions">
        <button type="button" class="btn btn-ghost" :disabled="!dirty || saving" @click="reset">{{ t('common.cancel') }}</button>
        <button type="submit" class="btn btn-primary" :disabled="saving || !dirty">
          <Spinner v-if="saving" :size="14" />{{ saving ? t('common.saving') : t('common.save') }}
        </button>
      </div>
    </form>
  </Card>
</template>

<style scoped>
.avatar-row { display: flex; align-items: center; gap: 16px; }
.avatar { width: 64px; height: 64px; border-radius: 999px; background: var(--ink-1); color: var(--bg); display: grid; place-items: center; font-family: var(--font-display); font-size: 22px; font-weight: 600; letter-spacing: .02em; flex: none; }
.av-name { font-weight: 600; font-size: 15px; }
.av-sub { color: var(--ink-3); font-size: 12.5px; margin-top: 2px; }
.lbl { font-size: 13px; font-weight: 500; margin-bottom: 6px; color: var(--ink-2); }
.actions { display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid var(--line-1); padding-top: 16px; }
</style>
