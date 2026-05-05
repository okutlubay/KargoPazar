<script setup>
import { computed } from 'vue'
import { useI18n } from '../i18n.js'
import SectionHeader from './SectionHeader.vue'

const { t, lang } = useI18n()

const team = computed(() => [
  { name: 'Fatmanur Ceyhan', role: lang.value === 'tr' ? 'Kurucu & CEO' : 'Founder & CEO', initials: 'FC' },
  { name: lang.value === 'tr' ? 'Ar-Ge Ekibi' : 'R&D Team', role: lang.value === 'tr' ? '12 mühendis · Yapay Zeka' : '12 engineers · AI', initials: 'AR' },
  { name: lang.value === 'tr' ? 'Operasyon' : 'Operations', role: lang.value === 'tr' ? 'Lojistik & Müşteri Başarısı' : 'Logistics & Customer Success', initials: 'OP' },
  { name: lang.value === 'tr' ? 'Ürün' : 'Product', role: lang.value === 'tr' ? 'Tasarım & Mühendislik' : 'Design & Engineering', initials: 'PR' },
])

const milestones = computed(() => [
  { y: '2024 Q3', l: lang.value === 'tr' ? 'Proje başlangıcı' : 'Project kickoff', d: lang.value === 'tr' ? 'Teknopark Ar-Ge başvurusu kabul edildi.' : 'Teknopark R&D application approved.' },
  { y: '2025 Q1', l: lang.value === 'tr' ? 'İlk entegrasyonlar' : 'First integrations', d: lang.value === 'tr' ? 'Etsy ve Shopify API mimarisi tamamlandı.' : 'Etsy and Shopify API architecture completed.' },
  { y: '2025 Q3', l: lang.value === 'tr' ? 'AI motoru v1' : 'AI engine v1', d: lang.value === 'tr' ? 'Adres + kategori modelleri canlıya alındı.' : 'Address + category models shipped.' },
  { y: '2026 Q1', l: lang.value === 'tr' ? 'Beta açılış' : 'Beta launch', d: lang.value === 'tr' ? 'İlk 100 satıcıyla saha testleri.' : 'Field trials with first 100 sellers.' },
  { y: '2026 Q3', l: lang.value === 'tr' ? 'Genel açılış' : 'General availability', d: lang.value === 'tr' ? 'TR + 5 Avrupa ülkesi.' : 'TR + 5 European countries.', upcoming: true },
])
</script>

<template>
  <section id="about" class="section about">
    <div class="container">
      <div class="layout">
        <div>
          <SectionHeader :eyebrow="t.about.eyebrow" :title="t.about.title" />
          <p class="para">{{ t.about.p1 }}</p>
          <p class="para">{{ t.about.p2 }}</p>

          <div class="facts">
            <div class="card fact"><div class="num">7</div><div class="mono lbl">{{ lang === 'tr' ? 'AI modülü' : 'AI modules' }}</div></div>
            <div class="card fact"><div class="num">30+</div><div class="mono lbl">{{ lang === 'tr' ? 'Taşıyıcı' : 'Carriers' }}</div></div>
            <div class="card fact"><div class="num">180+</div><div class="mono lbl">{{ lang === 'tr' ? 'Ülke' : 'Countries' }}</div></div>
          </div>
        </div>

        <div class="col" style="gap: 24px">
          <div>
            <div class="eyebrow" style="margin-bottom: 14px">{{ lang === 'tr' ? 'Yol haritası' : 'Roadmap' }}</div>
            <div class="timeline">
              <div class="rail" />
              <div v-for="(m, i) in milestones" :key="i" class="step">
                <span :class="['marker', { upcoming: m.upcoming }]" />
                <div class="row" style="gap: 10px; margin-bottom: 4px">
                  <span class="mono year">{{ m.y }}</span>
                  <span v-if="m.upcoming" class="mono planned">{{ lang === 'tr' ? 'Planlandı' : 'Planned' }}</span>
                </div>
                <div class="step-title">{{ m.l }}</div>
                <div class="step-desc">{{ m.d }}</div>
              </div>
            </div>
          </div>

          <div>
            <div class="eyebrow" style="margin-bottom: 14px">{{ lang === 'tr' ? 'Ekip' : 'Team' }}</div>
            <div class="team-grid">
              <div v-for="(p, i) in team" :key="i" class="card team-card">
                <span :class="['avatar', { primary: i === 0 }]">{{ p.initials }}</span>
                <div class="col" style="gap: 1px">
                  <span class="t-name">{{ p.name }}</span>
                  <span class="t-role">{{ p.role }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.about { background: var(--bg-2); border-top: 1px solid var(--line-1); }
.layout { display: grid; grid-template-columns: 1fr 1fr; gap: 64px; align-items: start; }
.para { font-size: 15px; color: var(--ink-2); line-height: 1.65; }
.para:first-of-type { margin-top: 20px; }
.facts { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-top: 28px; }
.fact { padding: 18px; }
.fact .num { font-family: var(--font-display); font-size: 32px; font-weight: 600; letter-spacing: -0.02em; }
.fact .lbl { font-size: 11px; color: var(--ink-3); text-transform: uppercase; letter-spacing: 0.06em; margin-top: 4px; }

.timeline { position: relative; padding-left: 24px; display: flex; flex-direction: column; }
.rail { position: absolute; left: 5px; top: 6px; bottom: 6px; width: 1px; background: var(--line-2); }
.step { position: relative; padding-bottom: 20px; }
.marker {
  position: absolute; left: -24px; top: 4px;
  width: 11px; height: 11px; border-radius: 999px;
  background: var(--accent);
  border: 2px solid var(--bg-2);
  box-shadow: 0 0 0 2px var(--accent);
}
.marker.upcoming {
  background: var(--bg-2);
  border: 2px dashed var(--accent);
  box-shadow: none;
}
.year { font-size: 11px; font-weight: 600; color: var(--accent-ink); letter-spacing: 0.05em; }
.planned {
  font-size: 9.5px; padding: 1px 6px; border-radius: 3px;
  background: var(--bg-3); color: var(--ink-3);
  letter-spacing: 0.04em; text-transform: uppercase;
}
.step-title { font-size: 14.5px; font-weight: 600; margin-bottom: 2px; }
.step-desc { font-size: 13px; color: var(--ink-3); }

.team-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.team-card {
  padding: 14px;
  display: flex; align-items: center; gap: 12px;
}
.avatar {
  width: 40px; height: 40px; border-radius: 999px;
  background: var(--ink-1); color: white;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-display); font-weight: 600; font-size: 14px;
}
.avatar.primary { background: var(--accent); }
.t-name { font-size: 14px; font-weight: 600; }
.t-role { font-size: 12px; color: var(--ink-3); }

@media (max-width: 860px) {
  .layout { grid-template-columns: 1fr; gap: 32px; }
  .facts { grid-template-columns: 1fr 1fr 1fr; }
  .team-grid { grid-template-columns: 1fr; }
}
</style>
