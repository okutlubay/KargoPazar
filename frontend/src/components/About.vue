<script setup>
import { computed } from 'vue'
import { useI18n } from '../i18n.js'
import SectionHeader from './SectionHeader.vue'
import roadmap from '../app/data/seed/roadmap.json'

const { t, lang, f } = useI18n()

// The 4 work packages (IP1..IP4) with their month ranges and names from roadmap.json.
const workPackages = (() => {
  const map = new Map()
  for (const r of roadmap) {
    if (!map.has(r.wp)) map.set(r.wp, { wp: r.wp, label: r.wpLabel, name: r.wpName, months: r.wpMonths, items: 0, done: 0 })
    const w = map.get(r.wp)
    w.items++
    if (r.state === 'done') w.done++
  }
  return [...map.values()].sort((a, b) => a.wp.localeCompare(b.wp))
})()

const milestones = computed(() => workPackages.map((w) => ({
  code: lang.value === 'tr' ? w.label : w.wp.replace('IP', 'WP'),
  months: f(t.value.about.months, { from: w.months[0], to: w.months[1] }),
  name: w.name[lang.value] || w.name.en,
  done: w.done === w.items,
})))

const team = computed(() => {
  const m = t.value.about.teamMembers
  return [
    { name: 'Fatmanur Ceyhan', role: m[0].role, initials: 'FC' },
    { name: m[1].name, role: m[1].role, initials: 'AR' },
    { name: m[2].name, role: m[2].role, initials: 'OP' },
    { name: m[3].name, role: m[3].role, initials: 'PR' },
  ]
})
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
            <div v-for="(fc, i) in t.about.facts" :key="i" class="card fact">
              <div class="num">{{ fc.num }}</div>
              <div class="mono lbl">{{ fc.lbl }}</div>
            </div>
          </div>
        </div>

        <div class="col" style="gap: 24px">
          <div>
            <div class="eyebrow" style="margin-bottom: 14px">{{ t.about.roadmap }}</div>
            <div class="timeline">
              <div class="rail" />
              <div v-for="m in milestones" :key="m.code" class="step">
                <span class="marker" />
                <div class="row" style="gap: 10px; margin-bottom: 4px; flex-wrap: wrap">
                  <span class="mono year">{{ m.code }} · {{ m.months }}</span>
                  <span v-if="m.done" class="mono done">{{ t.about.done }}</span>
                </div>
                <div class="step-title">{{ m.name }}</div>
              </div>
            </div>
          </div>

          <div>
            <div class="eyebrow" style="margin-bottom: 14px">{{ t.about.team }}</div>
            <div class="team-grid">
              <div v-for="(p, i) in team" :key="i" class="card team-card">
                <span :class="['avatar', { primary: i === 0 }]">{{ p.initials }}</span>
                <div class="col" style="gap: 1px; min-width: 0">
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
.rail { position: absolute; left: 5px; top: 6px; bottom: 20px; width: 1px; background: var(--line-2); }
.step { position: relative; padding-bottom: 20px; }
.marker {
  position: absolute; left: -24px; top: 4px;
  width: 11px; height: 11px; border-radius: 999px;
  background: var(--success);
  border: 2px solid var(--bg-2);
  box-shadow: 0 0 0 2px var(--success);
}
.year { font-size: 11px; font-weight: 600; color: var(--accent-ink); letter-spacing: 0.05em; }
.done {
  font-size: 9.5px; padding: 1px 6px; border-radius: 3px;
  background: oklch(0.95 0.05 155); color: oklch(0.45 0.12 155);
  letter-spacing: 0.04em; text-transform: uppercase; font-weight: 600;
}
.step-title { font-size: 14.5px; font-weight: 600; }

.team-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.team-card { padding: 14px; display: flex; align-items: center; gap: 12px; }
.avatar {
  width: 40px; height: 40px; border-radius: 999px; flex: 0 0 auto;
  background: var(--ink-1); color: white;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-display); font-weight: 600; font-size: 14px;
}
.avatar.primary { background: var(--accent); }
.t-name { font-size: 14px; font-weight: 600; }
.t-role { font-size: 12px; color: var(--ink-3); }

@media (max-width: 860px) {
  .layout { grid-template-columns: 1fr; gap: 32px; }
  .team-grid { grid-template-columns: 1fr; }
}
@media (max-width: 420px) {
  .fact { padding: 14px 10px; }
  .fact .num { font-size: 26px; }
}
</style>
