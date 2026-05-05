<script setup>
import { provideI18n } from './i18n.js'
import Nav from './components/Nav.vue'
import Hero from './components/Hero.vue'
import Features from './components/Features.vue'
import Calculator from './components/Calculator.vue'
import Integrations from './components/Integrations.vue'
import AISection from './components/AISection.vue'
import Dashboard from './components/Dashboard.vue'
import About from './components/About.vue'
import Contact from './components/Contact.vue'
import CTABand from './components/CTABand.vue'
import Footer from './components/Footer.vue'

provideI18n()
</script>

<template>
  <Nav />
  <main>
    <Hero />
    <Features />
    <Calculator />
    <Integrations />
    <AISection />
    <Dashboard />
    <About />
    <Contact />
    <CTABand />
  </main>
  <Footer />
</template>
