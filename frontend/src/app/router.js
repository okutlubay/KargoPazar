import { createRouter, createWebHashHistory } from 'vue-router'
import { isAuthenticated, isPlatformAdmin, homeRoute } from './store/session.js'

// meta.layout: 'app' (AppShell, default) | 'auth' (AuthLayout) | 'bare' (full page, no chrome)
// meta.public: reachable without a session
// meta.title: i18n key for the document title / breadcrumb
// meta.group: sidebar group key used for breadcrumbs
const views = import.meta.glob('./views/**/*.vue')
const v = p => {
  const loader = views[`./views/${p}.vue`]
  if (!loader) throw new Error(`[router] missing view ${p}`)
  return loader
}

export const routes = [
  // Auth
  { path: '/login', name: 'login', component: v('auth/LoginView'), meta: { layout: 'auth', public: true, guestOnly: true, title: 'nav.login' } },
  { path: '/forgot', name: 'forgot', component: v('auth/ForgotView'), meta: { layout: 'auth', public: true, guestOnly: true, title: 'nav.forgot' } },
  { path: '/signup', name: 'signup', component: v('auth/SignupView'), meta: { layout: 'auth', public: true, title: 'nav.signup' } },
  { path: '/onboarding', name: 'onboarding', component: v('auth/OnboardingView'), meta: { layout: 'bare', title: 'nav.onboarding' } },

  // Public tracking
  { path: '/track/:trackingNo?', name: 'track', component: v('track/TrackView'), meta: { layout: 'bare', public: true, title: 'nav.track' } },

  // Operations
  { path: '/', name: 'overview', component: v('overview/OverviewView'), meta: { title: 'nav.overview', group: 'operations' } },
  { path: '/orders', name: 'orders', component: v('orders/OrdersView'), meta: { title: 'nav.orders', group: 'operations' } },
  { path: '/orders/new', name: 'order-new', component: v('orders/OrderNewView'), meta: { title: 'nav.orderNew', group: 'operations', parent: 'orders' } },
  { path: '/orders/:id', name: 'order-detail', component: v('orders/OrderDetailView'), meta: { title: 'nav.orderDetail', group: 'operations', parent: 'orders' } },
  { path: '/shipments/new', name: 'shipment-new', component: v('shipments/ShipmentNewView'), meta: { title: 'nav.shipmentNew', group: 'operations', parent: 'shipments' } },
  { path: '/shipments', name: 'shipments', component: v('shipments/ShipmentsView'), meta: { title: 'nav.shipments', group: 'operations' } },
  { path: '/shipments/:id', name: 'shipment-detail', component: v('shipments/ShipmentDetailView'), meta: { title: 'nav.shipmentDetail', group: 'operations', parent: 'shipments' } },
  { path: '/batch', name: 'batch', component: v('batch/BatchView'), meta: { title: 'nav.batch', group: 'operations', feature: 'batch' } },
  { path: '/manifests', name: 'manifests', component: v('manifests/ManifestsView'), meta: { title: 'nav.manifests', group: 'operations' } },
  { path: '/manifests/:id', name: 'manifest-detail', component: v('manifests/ManifestDetailView'), meta: { title: 'nav.manifestDetail', group: 'operations', parent: 'manifests' } },
  { path: '/ops', name: 'ops', component: v('ops/OpsView'), meta: { title: 'nav.ops', group: 'operations' } },
  { path: '/notifications', name: 'notifications', component: v('notifications/NotificationsView'), meta: { title: 'nav.notifications' } },

  // International
  { path: '/intl', name: 'intl', component: v('intl/IntlView'), meta: { title: 'nav.intl', group: 'international', feature: 'intl' } },
  { path: '/intl/new', name: 'intl-new', component: v('intl/IntlNewView'), meta: { title: 'nav.intlNew', group: 'international', parent: 'intl', feature: 'intl' } },
  { path: '/intl/tests', name: 'intl-tests', component: v('intl/TestsView'), meta: { title: 'nav.intlTests', group: 'international' } },
  { path: '/intl/:id', name: 'intl-detail', component: v('intl/IntlDetailView'), meta: { title: 'nav.intlDetail', group: 'international', parent: 'intl', feature: 'intl' } },
  { path: '/customs', name: 'customs', component: v('customs/CustomsView'), meta: { title: 'nav.customs', group: 'international', feature: 'customs' } },

  // AI
  { path: '/ai', name: 'ai', component: v('ai/AiHubView'), meta: { title: 'nav.ai', group: 'ai' } },
  { path: '/ai/address', name: 'ai-address', component: v('ai/AddressView'), meta: { title: 'nav.aiAddress', group: 'ai', parent: 'ai' } },
  { path: '/ai/forecast', name: 'ai-forecast', component: v('ai/ForecastView'), meta: { title: 'nav.aiForecast', group: 'ai', parent: 'ai' } },
  { path: '/ai/pricing', name: 'ai-pricing', component: v('ai/PricingView'), meta: { title: 'nav.aiPricing', group: 'ai', parent: 'ai' } },
  { path: '/ai/optimizer', name: 'ai-optimizer', component: v('ai/OptimizerView'), meta: { title: 'nav.aiOptimizer', group: 'ai', parent: 'ai' } },
  { path: '/ai/hs', name: 'ai-hs', component: v('ai/HsView'), meta: { title: 'nav.aiHs', group: 'ai', parent: 'ai' } },
  { path: '/ai/customs-docs', name: 'ai-customs-docs', component: v('ai/CustomsDocsView'), meta: { title: 'nav.aiCustomsDocs', group: 'ai', parent: 'ai' } },

  // Integrations
  { path: '/integrations/stores', name: 'stores', component: v('integrations/StoresView'), meta: { title: 'nav.stores', group: 'integrations' } },
  { path: '/integrations/sync-logs', name: 'sync-logs', component: v('integrations/SyncLogsView'), meta: { title: 'nav.syncLogs', group: 'integrations', parent: 'stores' } },
  { path: '/integrations/carrier-accounts', name: 'carrier-accounts', component: v('integrations/CarrierAccountsView'), meta: { title: 'nav.carrierAccounts', group: 'integrations' } },
  { path: '/integrations/api', name: 'api', component: v('integrations/ApiView'), meta: { title: 'nav.api', group: 'integrations', feature: 'api' } },

  // Account
  { path: '/billing', name: 'billing', component: v('billing/BillingView'), meta: { title: 'nav.billing', group: 'account' } },
  { path: '/plan', name: 'plan', component: v('plan/PlanView'), meta: { title: 'nav.plan', group: 'account' } },
  { path: '/settings/:section?', name: 'settings', component: v('settings/SettingsView'), meta: { title: 'nav.settings', group: 'account' } },

  // Admin (platform)
  { path: '/admin/carriers', name: 'admin-carriers', component: v('admin/CarriersView'), meta: { title: 'nav.adminCarriers', group: 'admin' } },
  { path: '/admin/carriers/:code', name: 'admin-carrier-detail', component: v('admin/CarrierDetailView'), meta: { title: 'nav.adminCarrierDetail', group: 'admin', parent: 'admin-carriers' } },
  { path: '/admin/rate-cards', name: 'admin-rate-cards', component: v('admin/RateCardsView'), meta: { title: 'nav.adminRateCards', group: 'admin' } },
  { path: '/admin/countries', name: 'admin-countries', component: v('admin/CountriesView'), meta: { title: 'nav.adminCountries', group: 'admin' } },
  { path: '/admin/customers', name: 'admin-customers', component: v('admin/CustomersView'), meta: { title: 'nav.adminCustomers', group: 'admin' } },
  { path: '/admin/system', name: 'admin-system', component: v('admin/SystemView'), meta: { title: 'nav.adminSystem', group: 'admin' } },
  { path: '/admin/rnd', name: 'admin-rnd', component: v('admin/RndView'), meta: { title: 'nav.adminRnd', group: 'admin' } },

  { path: '/:pathMatch(.*)*', name: 'not-found', component: v('NotFoundView'), meta: { title: 'nav.notFound' } },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

router.beforeEach(to => {
  const authed = isAuthenticated()
  if (!to.meta.public && !authed) return { name: 'login', query: { redirect: to.fullPath } }
  if (to.meta.guestOnly && authed) return homeRoute()
  // The admin module belongs to the platform administrator only, and that account sees nothing else.
  if (authed && !to.meta.public) {
    const adminRoute = to.meta.group === 'admin'
    if (adminRoute !== isPlatformAdmin()) return homeRoute()
  }
  return true
})
