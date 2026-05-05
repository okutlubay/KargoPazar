<script setup lang="ts">
import Header from './components/Header.vue';
import Hero from './components/Hero.vue';
import FeaturesSection from './components/FeaturesSection.vue';
import CalculatorSection from './components/CalculatorSection.vue';
import IntegrationsSection from './components/IntegrationsSection.vue';
import AISection from './components/AISection.vue';
import DashboardSection from './components/DashboardSection.vue';
import AboutSection from './components/AboutSection.vue';
import ContactSection from './components/ContactSection.vue';
import CTABand from './components/CTABand.vue';
import Footer from './components/Footer.vue';
</script>

<template>
  <Header />
  <main>
    <Hero />
    <FeaturesSection />
    <CalculatorSection />
    <IntegrationsSection />
    <AISection />
    <DashboardSection />
    <AboutSection />
    <ContactSection />
    <CTABand />
  </main>
  <Footer />
</template>

<style scoped>
</style>
