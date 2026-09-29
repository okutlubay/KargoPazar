<script setup>
// "Additional documents requested" upload dialog (spec 9.3 customs status).
import { ref, watch, computed } from 'vue'
import Icon from '@/components/Icon.vue'
import Modal from '@/app/components/Modal.vue'
import Spinner from '@/app/components/Spinner.vue'
import { toast } from '@/app/components/toast.js'
import { useI18n } from '@/app/i18n/index.js'
import { uploadCustomsDocs } from '@/app/api/intl.js'
import { readFileAsDataUrl, fileSize, errorText } from './stage.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  record: { type: Object, default: null },
})
const emit = defineEmits(['update:open', 'uploaded'])
const { t, tx, fmt } = useI18n()
const files = ref([])
const missing = ref([])
const busy = ref(false)
const ACCEPT = '.pdf,.png,.jpg,.jpeg'
const MAX = 5 * 1024 * 1024

const docs = computed(() => props.record?.customsRequest?.docs || [])
watch(() => props.open, v => { if (v) { files.value = docs.value.map(() => null); missing.value = [] } })

async function pick(i, ev) {
  const f = ev.target.files?.[0]
  ev.target.value = ''
  if (!f) return
  const ext = f.name.split('.').pop().toLowerCase()
  if (!['pdf', 'png', 'jpg', 'jpeg'].includes(ext)) { toast.error(t('intl.upload.badType')); return }
  if (f.size > MAX) { toast.error(t('intl.upload.tooLarge', { mb: 5 })); return }
  let dataUrl = null
  try { if (f.size < 330000) dataUrl = await readFileAsDataUrl(f) } catch { dataUrl = null }
  const copy = [...files.value]
  copy[i] = { docIndex: i, name: f.name, size: f.size, type: f.type, dataUrl }
  files.value = copy
  missing.value = missing.value.filter(x => x !== i)
}
function clear(i) { const c = [...files.value]; c[i] = null; files.value = c }

async function submit() {
  missing.value = docs.value.map((_, i) => i).filter(i => !files.value[i])
  if (missing.value.length) return
  busy.value = true
  try {
    const r = await uploadCustomsDocs(props.record.id, files.value.filter(Boolean))
    toast.success(t('intl.upload.done', { n: files.value.length, id: props.record.id }))
    emit('uploaded', r)
    emit('update:open', false)
  } catch (e) { toast.error(errorText(t, e)) } finally { busy.value = false }
}
</script>

<template>
  <Modal :open="open" :title="t('intl.upload.title', { id: record?.id || '' })" :subtitle="record?.customsRequest ? tx(record.customsRequest.note) : ''" @update:open="v => emit('update:open', v)">
    <ul class="docs">
      <li v-for="(d, i) in docs" :key="i" :class="{ miss: missing.includes(i) }">
        <div class="dn">
          <Icon name="file" :size="15" />
          <span><strong>{{ tx(d) }}</strong>
            <span v-if="files[i]" class="muted">{{ files[i].name }} · {{ fileSize(files[i].size, fmt.number) }}</span>
            <span v-else-if="missing.includes(i)" class="field-error">{{ t('intl.upload.required') }}</span>
            <span v-else class="muted">{{ t('intl.upload.hint') }}</span>
          </span>
        </div>
        <div class="acts">
          <button v-if="files[i]" type="button" class="btn-icon" :aria-label="t('common.delete')" @click="clear(i)"><Icon name="x" :size="14" /></button>
          <label class="btn btn-ghost btn-sm">
            <Icon name="upload" :size="13" />{{ files[i] ? t('intl.upload.change') : t('intl.upload.choose') }}
            <input type="file" class="sr" :accept="ACCEPT" @change="pick(i, $event)" />
          </label>
        </div>
      </li>
    </ul>
    <p class="muted note">{{ t('intl.upload.note') }}</p>
    <template #footer>
      <button type="button" class="btn btn-ghost" :disabled="busy" @click="emit('update:open', false)">{{ t('common.cancel') }}</button>
      <button type="button" class="btn btn-primary" :disabled="busy" @click="submit"><Spinner v-if="busy" :size="14" /><Icon v-else name="upload" :size="14" />{{ t('intl.upload.submit') }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.docs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.docs li { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--line-1); border-radius: var(--r-md); }
.docs li.miss { border-color: var(--danger); }
.dn { display: flex; gap: 10px; align-items: flex-start; min-width: 0; }
.dn > span { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.acts { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }
.muted { color: var(--ink-3); font-size: 12.5px; }
.note { margin: 12px 0 0; }
.sr { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
label.btn { position: relative; cursor: pointer; }
</style>
