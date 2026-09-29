function deepMerge(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      target[k] = deepMerge(target[k] && typeof target[k] === 'object' ? target[k] : {}, v)
    } else {
      target[k] = v
    }
  }
  return target
}

export function mergeModules(modules, lang) {
  const out = {}
  for (const mod of Object.values(modules)) {
    if (mod && mod[lang]) deepMerge(out, mod[lang])
  }
  return out
}
