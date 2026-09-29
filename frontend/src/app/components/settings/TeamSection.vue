<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import Icon from '@/components/Icon.vue'
import Card from '../Card.vue'
import Modal from '../Modal.vue'
import FormField from '../FormField.vue'
import Skeleton from '../Skeleton.vue'
import Spinner from '../Spinner.vue'
import StatusPill from '../StatusPill.vue'
import DateTime from '../DateTime.vue'
import Dropdown from '../Dropdown.vue'
import EmptyState from '../EmptyState.vue'
import { required, email as emailRule, validateAll } from '../validation.js'
import { toast } from '../toast.js'
import { confirm } from '../confirm.js'
import { useI18n } from '../../i18n/index.js'
import { can, hasFeature, session, setRolePreview, ROLES } from '../../store/session.js'
import { listTeam, inviteMember, resendInvite, cancelInvite, changeRole, removeMember, restoreMember, getRoles, setRolePermission } from '../../api/team.js'
import { errorText, fieldErrors } from './util.js'

const { t, tx } = useI18n()
const loading = ref(true)
const team = ref({ members: [], invites: [], seats: { used: 0, limit: null } })
const roles = ref(null)
const locked = computed(() => !can('team.manage'))
const gated = computed(() => !hasFeature('team'))

async function load() {
  try {
    const [tm, r] = await Promise.all([listTeam(), getRoles()])
    team.value = tm
    roles.value = r
  } catch (e) { toast.error(errorText(e)) } finally { loading.value = false }
}
onMounted(load)

// ---- invite
const inviteOpen = ref(false)
const inviting = ref(false)
const inv = reactive({ email: '', name: '', role: 'operations' })
const invErrors = ref({})
const invFields = ref([])
function openInvite() { Object.assign(inv, { email: '', name: '', role: 'operations' }); invErrors.value = {}; inviteOpen.value = true }
async function sendInvite() {
  invErrors.value = {}
  if (!validateAll(invFields.value.filter(Boolean))) return
  inviting.value = true
  try {
    await inviteMember({ ...inv })
    inviteOpen.value = false
    toast.success(t('settings.team.invited', { email: inv.email }))
    await load()
  } catch (e) {
    invErrors.value = fieldErrors(e)
    toast.error(errorText(e))
  } finally { inviting.value = false }
}

async function resend(m) {
  try { await resendInvite(m.id); toast.success(t('settings.team.resent', { email: m.email })); await load() } catch (e) { toast.error(errorText(e)) }
}
async function cancel(m) {
  const ok = await confirm({ title: t('settings.team.cancelTitle'), message: t('settings.team.cancelDesc', { email: m.email }), confirmLabel: t('settings.team.cancelInvite'), danger: true })
  if (!ok) return
  try { await cancelInvite(m.id); toast.info(t('settings.team.cancelled')); await load() } catch (e) { toast.error(errorText(e)) }
}
async function setRole(m, role) {
  if (role === m.role) return
  try {
    const r = await changeRole(m.id, role)
    await load()
    toast.success(t('settings.team.roleChanged', { name: m.name, role: t('roles.' + role) }), { action: { label: t('common.undo'), onClick: async () => { await changeRole(m.id, r.previousRole); await load() } } })
  } catch (e) { toast.error(errorText(e)) }
}
async function remove(m) {
  const ok = await confirm({ title: t('settings.team.removeTitle'), message: t('settings.team.removeDesc', { name: m.name }), confirmLabel: t('settings.team.remove'), danger: true })
  if (!ok) return
  try {
    const { removed, index } = await removeMember(m.id)
    await load()
    toast.info(t('settings.team.removed', { name: m.name }), { action: { label: t('common.undo'), onClick: async () => { await restoreMember(removed, index); await load() } } })
  } catch (e) { toast.error(errorText(e)) }
}

function memberMenu(m) {
  const roleItems = ROLES.filter(r => r !== 'owner').map(r => ({ key: 'r-' + r, label: t('roles.' + r), icon: m.role === r ? 'check' : undefined, disabled: locked.value || m.isOwner, onClick: () => setRole(m, r) }))
  return [
    { key: 'h', header: true, label: t('settings.team.changeRole') },
    ...roleItems,
    { key: 'd', divider: true },
    { key: 'preview', label: t('settings.team.previewAs', { role: t('roles.' + m.role) }), icon: 'eye', disabled: m.role === session.user?.role, onClick: () => preview(m.role) },
    { key: 'd2', divider: true },
    { key: 'rm', label: t('settings.team.remove'), icon: 'trash', danger: true, disabled: locked.value || m.isOwner, onClick: () => remove(m) },
  ]
}

// ---- matrix
const permBusy = ref('')
const hasPerm = (role, perm) => role.permissions.includes(perm)
async function togglePerm(role, perm) {
  const key = role.id + perm
  permBusy.value = key
  const enabled = !hasPerm(role, perm)
  try {
    roles.value = await setRolePermission(role.id, perm, enabled)
    toast.info(t(enabled ? 'settings.team.permGranted' : 'settings.team.permRevoked', { role: tx(role.name), perm: tx(roles.value.permissions.find(p => p.id === perm).label) }), {
      action: { label: t('common.undo'), onClick: async () => { roles.value = await setRolePermission(role.id, perm, !enabled) } },
    })
  } catch (e) { toast.error(errorText(e)) } finally { permBusy.value = '' }
}
const permLocked = (role, perm) => locked.value || role.id === 'owner' || perm === 'admin.platform'
const counts = computed(() => Object.fromEntries(ROLES.map(r => [r, team.value.members.filter(m => m.role === r).length])))

function preview(role) {
  setRolePreview(role)
  toast.info(t('settings.team.previewing', { role: t('roles.' + role) }))
}
</script>

<template>
  <div class="stack-lg">
    <div v-if="gated" class="callout warn">
      <Icon name="lock" :size="14" />
      <span>{{ t('settings.team.gated') }} <RouterLink :to="{ name: 'plan' }" class="link">{{ t('common.upgrade') }}</RouterLink></span>
    </div>

    <Card :title="t('settings.team.title')" :subtitle="t('settings.team.desc')" padding="none">
      <template #actions>
        <span class="seats">{{ team.seats.limit ? t('settings.team.seats', { used: team.seats.used, limit: team.seats.limit }) : t('settings.team.seatsUnlimited', { used: team.seats.used }) }}</span>
        <button class="btn btn-primary btn-sm" :disabled="locked || gated" :title="locked ? t('common.noPermission') : gated ? t('common.upgradeRequired') : undefined" @click="openInvite"><Icon name="mail" :size="13" />{{ t('settings.team.invite') }}</button>
      </template>
      <div v-if="loading" class="pad"><Skeleton :lines="5" /></div>
      <div v-else class="table-wrap">
        <table class="table-simple members">
          <thead>
            <tr>
              <th>{{ t('settings.team.member') }}</th>
              <th>{{ t('settings.team.role') }}</th>
              <th class="hide-lg">{{ t('common.status') }}</th>
              <th class="hide-lg">{{ t('settings.team.lastActive') }}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in team.members" :key="m.id">
              <td>
                <div class="who">
                  <span :class="['av', 'r-' + m.role]">{{ m.initials }}</span>
                  <div class="wm">
                    <div class="wn">{{ m.name }} <span v-if="m.isYou" class="tag">{{ t('settings.team.you') }}</span></div>
                    <div class="we">{{ m.email }}</div>
                  </div>
                </div>
              </td>
              <td>
                <span v-if="m.isOwner" class="role-fixed"><Icon name="lock" :size="11" />{{ t('roles.owner') }}</span>
                <select v-else class="select sm" :value="m.role" :disabled="locked" :aria-label="t('settings.team.roleOf', { name: m.name })" :title="locked ? t('common.noPermission') : undefined" @change="setRole(m, $event.target.value)">
                  <option v-for="r in ROLES.filter(x => x !== 'owner')" :key="r" :value="r">{{ t('roles.' + r) }}</option>
                </select>
              </td>
              <td class="hide-lg"><StatusPill status="active" size="sm" /></td>
              <td class="hide-lg"><DateTime :value="m.lastActiveAt" /></td>
              <td class="r"><Dropdown :items="memberMenu(m)" size="sm" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <template v-if="!loading && team.invites.length">
        <div class="inv-head">{{ t('settings.team.pendingInvites', { n: team.invites.length }) }}</div>
        <div class="table-wrap">
          <table class="table-simple members">
            <tbody>
              <tr v-for="m in team.invites" :key="m.id">
                <td>
                  <div class="who">
                    <span class="av inv"><Icon name="mail" :size="13" /></span>
                    <div class="wm">
                      <div class="wn">{{ m.email }}</div>
                      <div class="we">{{ t('settings.team.invitedBy', { name: m.invitedBy }) }} · <DateTime :value="m.invitedAt" /></div>
                    </div>
                  </div>
                </td>
                <td>{{ t('roles.' + m.role) }}</td>
                <td class="hide-lg"><StatusPill status="invited" size="sm" /></td>
                <td class="hide-lg"><span class="we">{{ t('settings.team.expires') }} <DateTime :value="m.expiresAt" mode="date" /></span></td>
                <td class="r nowrap">
                  <button class="btn btn-ghost btn-xs" :disabled="locked" @click="resend(m)">{{ t('settings.team.resend') }}</button>
                  <button class="btn btn-ghost btn-xs danger-t" :disabled="locked" @click="cancel(m)">{{ t('settings.team.cancelInvite') }}</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </Card>

    <Card :title="t('settings.team.matrixTitle')" :subtitle="t('settings.team.matrixDesc')" padding="none">
      <div v-if="loading || !roles" class="pad"><Skeleton :lines="8" /></div>
      <div v-else class="table-wrap">
        <table class="table-simple matrix">
          <thead>
            <tr>
              <th>{{ t('settings.team.permission') }}</th>
              <th v-for="r in roles.roles" :key="r.id" class="c">
                <div class="rh">
                  <span class="rn">{{ tx(r.name) }}</span>
                  <span class="rc">{{ t('settings.team.memberCount', { n: counts[r.id] ?? 0 }) }}</span>
                  <button v-if="r.id !== session.user?.role" :class="['btn-link', 'pv', { on: session.rolePreview === r.id }]" @click="preview(r.id)">
                    <Icon name="eye" :size="11" />{{ session.rolePreview === r.id ? t('settings.team.previewActive') : t('settings.team.preview') }}
                  </button>
                  <span v-else class="rc">{{ t('settings.team.yourRole') }}</span>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in roles.permissions" :key="p.id">
              <td>
                <div class="pl">{{ tx(p.label) }}</div>
                <div class="pid mono">{{ p.id }}</div>
              </td>
              <td v-for="r in roles.roles" :key="r.id" class="c">
                <button
                  :class="['cell', { on: hasPerm(r, p.id), fixed: permLocked(r, p.id) }]"
                  :disabled="permLocked(r, p.id) || permBusy === r.id + p.id"
                  :aria-pressed="hasPerm(r, p.id)"
                  :aria-label="t('settings.team.cellAria', { role: tx(r.name), perm: tx(p.label) })"
                  :title="locked ? t('common.noPermission') : r.id === 'owner' || p.id === 'admin.platform' ? t('settings.team.ownerFixed') : undefined"
                  @click="togglePerm(r, p.id)"
                >
                  <Spinner v-if="permBusy === r.id + p.id" :size="11" />
                  <Icon v-else-if="hasPerm(r, p.id)" name="check" :size="13" />
                  <span v-else class="dash">-</span>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <template #footer>
        <div class="foot"><Icon name="info" :size="13" />{{ t('settings.team.matrixHint') }}</div>
      </template>
    </Card>

    <Modal v-model:open="inviteOpen" :title="t('settings.team.inviteTitle')" :subtitle="t('settings.team.inviteDesc')" size="sm">
      <form id="invite-form" class="stack" novalidate @submit.prevent="sendInvite">
        <FormField :ref="el => (invFields[0] = el)" :label="t('settings.team.email')" required :rules="[emailRule()]" :value="inv.email" :error="invErrors.email" v-slot="{ id, invalid, describedBy }">
          <input :id="id" v-model="inv.email" type="email" class="input" placeholder="name@company.com" :aria-invalid="invalid" :aria-describedby="describedBy" />
        </FormField>
        <FormField :label="t('settings.team.name')" optional :value="inv.name" v-slot="{ id }">
          <input :id="id" v-model="inv.name" class="input" />
        </FormField>
        <FormField :ref="el => (invFields[1] = el)" :label="t('settings.team.role')" required :rules="[required()]" :value="inv.role" :error="invErrors.role" v-slot="{ id }">
          <select :id="id" v-model="inv.role" class="select">
            <option v-for="r in ROLES.filter(x => x !== 'owner')" :key="r" :value="r">{{ t('roles.' + r) }}</option>
          </select>
        </FormField>
        <div v-if="roles" class="role-perms">
          <div class="hint">{{ t('settings.team.roleIncludes') }}</div>
          <div class="pchips">
            <span v-for="pid in roles.roles.find(r => r.id === inv.role)?.permissions ?? []" :key="pid" class="tag">{{ tx(roles.permissions.find(p => p.id === pid)?.label) }}</span>
          </div>
        </div>
      </form>
      <template #footer>
        <button class="btn btn-ghost" @click="inviteOpen = false">{{ t('common.cancel') }}</button>
        <button type="submit" form="invite-form" class="btn btn-primary" :disabled="inviting"><Spinner v-if="inviting" :size="14" />{{ t('settings.team.sendInvite') }}</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.pad { padding: 18px 20px; }
.seats { font-size: 12.5px; color: var(--ink-3); margin-right: 6px; }
.members td, .members th { padding-left: 20px; }
.who { display: flex; align-items: center; gap: 10px; }
.av { width: 32px; height: 32px; border-radius: 999px; display: grid; place-items: center; font-size: 12px; font-weight: 600; background: var(--bg-3); color: var(--ink-2); flex: none; }
.av.r-owner { background: var(--ink-1); color: var(--bg); }
.av.r-admin { background: var(--accent-soft); color: var(--accent-ink); }
.av.r-finance { background: oklch(0.95 0.05 155); color: oklch(0.4 0.1 155); }
.av.r-operations { background: oklch(0.96 0.06 80); color: oklch(0.45 0.1 70); }
.av.inv { background: var(--bg-2); border: 1px dashed var(--line-2); color: var(--ink-3); }
.wm { min-width: 0; }
.wn { font-weight: 500; display: flex; gap: 6px; align-items: center; }
.we { font-size: 12px; color: var(--ink-3); }
.select.sm { height: 30px; font-size: 13px; padding: 0 28px 0 8px; }
.role-fixed { display: inline-flex; align-items: center; gap: 5px; font-weight: 500; }
.r { text-align: right; }
.nowrap { white-space: nowrap; }
.danger-t { color: var(--danger); }
.inv-head { padding: 10px 20px; font-size: 12px; font-weight: 600; color: var(--ink-3); text-transform: uppercase; letter-spacing: .06em; border-top: 1px solid var(--line-1); background: var(--bg-2); }
.matrix td, .matrix th { padding-left: 16px; }
.c { text-align: center; min-width: 96px; }
.rh { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.rn { font-weight: 600; color: var(--ink-1); font-size: 12.5px; }
.rc { font-size: 11px; color: var(--ink-4); }
.pv { font-size: 11.5px; display: inline-flex; align-items: center; gap: 3px; }
.pv.on { color: var(--success); font-weight: 600; }
.pl { font-weight: 500; }
.pid { font-size: 11px; color: var(--ink-4); }
.cell { width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--line-2); background: var(--surface); display: inline-grid; place-items: center; color: var(--ink-4); }
.cell.on { background: oklch(0.95 0.05 155); border-color: oklch(0.85 0.08 155); color: oklch(0.42 0.12 155); }
.cell:not(:disabled):hover { border-color: var(--accent); }
.cell.fixed { cursor: not-allowed; opacity: .85; }
.cell:disabled { cursor: not-allowed; }
.dash { font-size: 13px; }
.foot { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink-3); }
.hint { color: var(--ink-3); font-size: 12.5px; margin-bottom: 6px; }
.pchips { display: flex; flex-wrap: wrap; gap: 4px; }
</style>
