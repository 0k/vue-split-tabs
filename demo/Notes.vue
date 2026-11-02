<script setup lang="ts">
import { ref } from "vue";
const draft = ref([
  "A little room to think.", "", "Drag this tab into another pane. Your words stay right here.", "",
  "Next up", "— Explore a different perspective", "— Make space for the details",
].join("\n"));
</script>

<template>
  <article class="document notes">
    <p class="eyebrow">WORKING DRAFT / 01</p>
    <h2>Room for an idea.</h2>
    <p class="muted">A real textarea. One mounted instance. Move it anywhere.</p>
    <textarea v-model="draft" aria-label="Notes draft" spellcheck="false" />
    <footer class="document-footer"><span class="status-dot" /> Kept mounted across moves <span>{{ draft.length }} characters</span></footer>
  </article>
</template>
