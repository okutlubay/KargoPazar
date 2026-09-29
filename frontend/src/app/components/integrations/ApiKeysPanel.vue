<script setup>
// API keys (spec 7.5): list, create with scopes (full key shown ONCE with copy + warning), revoke.
import { ref, computed, onMounted } from 'vue'
import Icon from '@/components/Icon.vue'
import DataTable from '../DataTable.vue'
import StatusPill from '../StatusPill.vue'
import DateTime from '../DateTime.vue'
import Modal from '../Modal.vue'
import FormField from '../FormField.vue'
import SegmentedControl from '../SegmentedControl.vue'
import CopyButton from '../CopyButton.vue'
import Spinner from '../Spinner.vue'
import { toast } from '../toast.js'
import { confirm } from '../confirm.js'
import { useI18n } from '../../i18n/index.js'
import { can } from '../../store/session.js'
import { listApiKeys, createApiKey, revokeApiKey, API_SCOPES } from '../../api/apiKeys.js'
import { errorMessage, fieldError } from './storeUtils.js'

const emit = defineEmits(['open-console'])
const { t } = useI18n()
const loading = ref(true)
const keys = ref([])
const revoking = ref(null)
const highlight = ref([])
const mayManage = computed(() => can('api.manage'))

// create modal
const createOpen = ref(false)
const form = ref({ name: '', env: 'live', scopes: [] })
const nameErr = ref('')
const scopesErr = ref('')
const creating = ref(false)
const created = ref(null) // { key, secret }
const savedAck = ref(false)
const nameField = ref(null)

async function load({ silent = false } = {}) {
  if (!silent) loading.value = true
  try { keys.value = await listApiKeys() } catch (e) { toast.error(errorMessage(e)) } finally { loading.value = false }
}
onMounted(load)

const columns = computed(() => [
  { key: 'name', label: t('apiConsole.keys.name'), sortable: true },
  { key: 'masked', label: t('apiConsole.keys.key'), width: 300 },
  { key: 'scopes', label: t('apiConsole.keys.scopes'), hideBelow: 'lg' },
  { key: 'createdAt', label: t('apiConsole.keys.created'), sortable: true, width: 130, hideBelow: 'md' },
  { key: 'lastUsedAt', label: t('apiConsole.keys.lastUsed'), sortable: true, width: 130 },
  { key: 'status', label: t('common.status'), width: 110 },
  { key: 'actions', label: '', isAction: true, width: 100, align: 'right', hideable: false },
])

function openCreate() {
  form.value = { name: '', env: 'live', scopes: ['orders:read', 'rates:read', 'shipments:write', 'tracking:read'] }
  nameErr.value = ''
  scopesErr.value = ''
  created.value = null
  savedAck.value = false
  createOpen.value = true
}

function validateName() {
  const v = form.value.name.trim()
  nameErr.value = !v ? t('common.validation.required') : v.length < 3 ? t('apiConsole.keys.nameShort') : ''
  return !nameErr.value
}
function validateScopes() {
  scopesErr.value = form.value.scopes.length ? '' : t('apiConsole.keys.scopesRequired')
  return !scopesErr.value
}
function toggleScope(s) {
  const set = new Set(form.value.scopes)
  set.has(s) ? set.delete(s) : set.add(s)
  form.value.scopes = API_SCOPES.filter(x => set.has(x))
  if (scopesErr.value) validateScopes()
}

async function submitCreate() {
  const okName = validateName()
  const okScopes = validateScopes()
  if (!okName) { nameField.value?.focus(); return }
  if (!okScopes) return
  creating.value = true
  try {
    created.value = await createApiKey({ ...form.value, scopes: [...form.value.scopes] })
    highlight.value = [created.value.key.id]
    toast.success(t('apiConsole.keys.createdToast', { name: created.value.key.name }))
    load({ silent: true })
  } catch (e) {
    if (e.details?.name) nameErr.value = fieldError(e.details.name)
    if (e.details?.scopes) scopesErr.value = t('apiConsole.keys.scopesRequired')
    toast.error(errorMessage(e))
  } finally {
    creating.value = false
  }
}

async function closeCreate() {
  if (created.value && !savedAck.value) {
    const ok = await confirm({ title: t('apiConsole.keys.closeWarnTitle'), message: t('apiConsole.keys.closeWarnMsg'), confirmLabel: t('apiConsole.keys.closeAnyway') })
    if (!ok) return
  }
  createOpen.value = false
  created.value = null
}

async function revoke(k) {
  const ok = await confirm({
    title: t('apiConsole.keys.revokeTitle', { name: k.name }),
    message: t('apiConsole.keys.revokeMsg', { prefix: k.prefix }),
    confirmLabel: t('apiConsole.keys.revoke'),
    danger: true,
  })
  if (!ok) return
  revoking.value = k.id
  try {
    await revokeApiKey(k.id)
    toast.success(t('apiConsole.keys.revokedToast', { name: k.name }))
    await load({ silent: true })
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    revoking.value = null
  }
}
const envOptions = computed(() => [{ value: 'live', label: t('apiConsole.keys.envLive') }, { value: 'test', label: t('apiConsole.keys.envTest') }])
</script>

<template>
  <div class="stack">
    <div class="panel">
      <div class="panel-head">
        <div>
          <div class="panel-title">{{ t('apiConsole.keys.title') }}</div>
          <div class="panel-sub">{{ t('apiConsole.keys.desc') }}</div>
        </div>
        <button class="btn btn-primary btn-sm" :disabled="!mayManage" :title="!mayManage ? t('common.noPermission') : ''" @click="openCreate"><Icon name="plus" :size="14" /> {{ t('apiConsole.keys.new') }}</button>
      </div>
      <DataTable :columns="columns" :rows="keys" :loading="loading" :paginate="false" :clickable="false" :highlight-keys="highlight" storage-key="api-keys"
        :empty-title="t('apiConsole.keys.emptyTitle')" :empty-desc="t('apiConsole.keys.emptyDesc')" empty-icon="key" :empty-action-label="mayManage ? t('apiConsole.keys.new') : ''" @empty-action="openCreate"
        :row-class="r => (r.status === 'revoked' ? 'row-revoked' : '')">
        <template #cell-name="{ row }">
          <div class="name">{{ row.name }}</div>
          <div class="sub">{{ row.createdBy || '-' }}</div>
        </template>
        <template #cell-masked="{ row }">
          <div class="keycell">
            <span class="tag" :class="row.env === 'live' ? 'tag-success' : 'tag-warning'">{{ row.env === 'live' ? t('apiConsole.keys.envLive') : t('apiConsole.keys.envTest') }}</span>
            <code class="mono truncate">{{ row.masked }}</code>
          </div>
        </template>
        <template #cell-scopes="{ row }">
          <div class="scopes"><span v-for="s in row.scopes" :key="s" class="tag scope">{{ s }}</span></div>
        </template>
        <template #cell-createdAt="{ row }"><DateTime :value="row.createdAt" mode="date" /></template>
        <template #cell-lastUsedAt="{ row }"><DateTime v-if="row.lastUsedAt" :value="row.lastUsedAt" /><span v-else class="sub">{{ t('apiConsole.keys.never') }}</span></template>
        <template #cell-status="{ row }"><StatusPill :status="row.status" size="sm" /></template>
        <template #cell-actions="{ row }">
          <button v-if="row.status === 'active'" class="btn btn-ghost btn-xs danger-text" :disabled="revoking === row.id || !mayManage" :title="!mayManage ? t('common.noPermission') : ''" @click="revoke(row)">
            <Spinner v-if="revoking === row.id" :size="11" /> {{ t('apiConsole.keys.revoke') }}
          </button>
          <span v-else class="sub"><DateTime :value="row.revokedAt" mode="date" /></span>
        </template>
      </DataTable>
    </div>

    <div class="grid-2">
      <div class="panel panel-pad tip">
        <div class="panel-title"><Icon name="shield" :size="14" /> {{ t('apiConsole.keys.authTitle') }}</div>
        <p class="panel-sub">{{ t('apiConsole.keys.authDesc') }}</p>
        <code class="auth-line">Authorization: Bearer kp_live_••••</code>
      </div>
      <div class="panel panel-pad tip">
        <div class="panel-title"><Icon name="flask" :size="14" /> {{ t('apiConsole.keys.testTitle') }}</div>
        <p class="panel-sub">{{ t('apiConsole.keys.testDesc') }}</p>
        <button class="btn btn-ghost btn-sm" @click="emit('open-console')"><Icon name="terminal" :size="14" /> {{ t('apiConsole.keys.tryConsole') }}</button>
      </div>
    </div>

    <Modal :open="createOpen" :title="created ? t('apiConsole.keys.createdTitle') : t('apiConsole.keys.new')" size="md" @update:open="v => !v && closeCreate()">
      <div v-if="!created" class="stack">
        <FormField ref="nameField" :label="t('apiConsole.keys.name')" :hint="t('apiConsole.keys.nameHint')" :error="nameErr" :value="form.name" required v-slot="{ id, invalid, describedBy }">
          <input :id="id" v-model="form.name" class="input" :class="{ invalid }" maxlength="60" :placeholder="t('apiConsole.keys.namePh')" :aria-invalid="invalid" :aria-describedby="describedBy" @blur="validateName" @keydown.enter.prevent="submitCreate" />
        </FormField>
        <div>
          <div class="label">{{ t('apiConsole.keys.env') }}</div>
          <SegmentedControl v-model="form.env" :options="envOptions" block />
          <div class="field-hint">{{ form.env === 'live' ? t('apiConsole.keys.envLiveHint') : t('apiConsole.keys.envTestHint') }}</div>
        </div>
        <div>
          <div class="label">{{ t('apiConsole.keys.scopes') }} <span class="req">*</span></div>
          <div class="scope-list" :class="{ invalid: scopesErr }">
            <label v-for="s in API_SCOPES" :key="s" class="scope-opt">
              <input type="checkbox" :checked="form.scopes.includes(s)" @change="toggleScope(s)" />
              <span><code>{{ s }}</code><span class="scope-desc">{{ t('apiConsole.scopes.' + s.replace(':', '_')) }}</span></span>
            </label>
          </div>
          <div v-if="scopesErr" class="field-error">{{ scopesErr }}</div>
        </div>
      </div>
      <div v-else class="stack">
        <div class="callout warn"><Icon name="alert" :size="16" /><div><b>{{ t('apiConsole.keys.onceTitle') }}</b> {{ t('apiConsole.keys.onceDesc') }}</div></div>
        <div class="secret">
          <code>{{ created.secret }}</code>
          <CopyButton :text="created.secret" variant="button" size="sm" @copied="savedAck = true" />
        </div>
        <dl class="kv">
          <dt>{{ t('apiConsole.keys.name') }}</dt><dd>{{ created.key.name }}</dd>
          <dt>{{ t('apiConsole.keys.env') }}</dt><dd>{{ created.key.env === 'live' ? t('apiConsole.keys.envLive') : t('apiConsole.keys.envTest') }}</dd>
          <dt>{{ t('apiConsole.keys.scopes') }}</dt><dd><span v-for="s in created.key.scopes" :key="s" class="tag scope">{{ s }}</span></dd>
        </dl>
        <label class="checkbox"><input v-model="savedAck" type="checkbox" /> {{ t('apiConsole.keys.savedAck') }}</label>
      </div>
      <template #footer>
        <template v-if="!created">
          <button class="btn btn-ghost btn-sm" @click="closeCreate">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary btn-sm" :disabled="creating" @click="submitCreate"><Spinner v-if="creating" :size="13" /> {{ t('apiConsole.keys.create') }}</button>
        </template>
        <button v-else class="btn btn-primary btn-sm" :disabled="!savedAck" @click="closeCreate">{{ t('common.finish') }}</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.name { font-weight: 500; }
.sub { color: var(--ink-3); font-size: 12px; }
.keycell { display: flex; align-items: center; gap: 8px; min-width: 0; }
.mono { font-family: var(--font-mono); font-size: 12px; }
.scopes { display: flex; gap: 4px; flex-wrap: wrap; }
.scope { font-family: var(--font-mono); font-size: 11px; height: 20px; }
.danger-text { color: var(--danger); }
:deep(.row-revoked) td { opacity: .6; }
.tip { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.tip .panel-title { display: flex; align-items: center; gap: 6px; }
.tip p { margin: 0; line-height: 1.55; }
.auth-line { font-family: var(--font-mono); font-size: 12px; background: var(--bg-2); border: 1px solid var(--line-1); padding: 6px 10px; border-radius: 8px; }
.label { font-size: 13px; font-weight: 500; margin-bottom: 6px; }
.req { color: var(--danger); }
.scope-list { display: grid; grid-template-columns: 1fr; border: 1px solid var(--line-1); border-radius: 10px; }
.scope-list.invalid { border-color: var(--danger); }
.scope-opt { display: flex; gap: 10px; align-items: flex-start; padding: 9px 12px; border-bottom: 1px solid var(--line-1); cursor: pointer; font-size: 13px; }
.scope-opt:last-child { border-bottom: 0; }
.scope-opt input { margin-top: 3px; accent-color: var(--accent); }
.scope-opt code { font-family: var(--font-mono); font-size: 12px; font-weight: 600; display: block; }
.scope-desc { color: var(--ink-3); font-size: 12px; }
.secret { display: flex; align-items: center; gap: 10px; padding: 12px; background: var(--ink-1); color: #fff; border-radius: 10px; }
.secret code { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: 12.5px; word-break: break-all; }
</style>
