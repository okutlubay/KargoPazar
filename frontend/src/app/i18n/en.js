import { mergeModules } from './merge.js'

const modules = import.meta.glob('./modules/*.js', { eager: true, import: 'default' })

export default mergeModules(modules, 'en')
