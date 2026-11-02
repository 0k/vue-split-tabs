<script setup lang="ts">
import { ref } from "vue";
import Notes from "./Notes.vue";
defineProps<{ id: string }>();
defineEmits<{ replace: [] }>();
const done = ref<string[]>([]);
const activities = Array.from({ length: 60 }, (_, i) => ({
  number: String(i + 1).padStart(2, "0"),
  title: ["Collected a small observation", "Made space for a new idea", "Connected two perspectives", "Saved a useful detail"][i % 4],
  category: ["RESEARCH", "WORKSPACE", "STUDY", "NOTE"][i % 4],
}));
</script>

<template>
  <Notes v-if="id === 'notes'" />
  <article v-else-if="id === 'log'" class="document activity" aria-label="Activity log" tabindex="0">
    <p class="eyebrow">THE SMALL THINGS ADD UP</p><h2>A trail of discoveries.</h2>
    <p class="muted">Scroll a little. There is always more to explore.</p>
    <ol class="activity-list"><li v-for="item in activities" :key="item.number">
      <span class="log-number">{{ item.number }}</span><span>{{ item.title }}<small>{{ item.category }}</small></span><span class="log-mark">↗</span>
    </li></ol>
  </article>
  <article v-else-if="id === 'chart'" class="document chart">
    <p class="eyebrow">A DIFFERENT PERSPECTIVE</p><h2>Ideas take shape.</h2>
    <p class="muted">A small, self-contained SVG study. No data service required.</p>
    <svg viewBox="0 0 500 320" role="img" aria-label="Abstract orbital paths around a central idea">
      <defs><radialGradient id="glow">
        <stop stop-color="#a4e9c4" stop-opacity=".2"/><stop offset="1" stop-color="#a4e9c4" stop-opacity="0"/>
      </radialGradient></defs>
      <circle cx="250" cy="160" r="155" fill="url(#glow)"/>
      <g fill="none" stroke="#45605b" stroke-width="1.5">
        <ellipse cx="250" cy="160" rx="200" ry="66" transform="rotate(-25 250 160)"/>
        <ellipse cx="250" cy="160" rx="150" ry="110" transform="rotate(35 250 160)"/>
        <circle cx="250" cy="160" r="66" stroke-dasharray="3 8"/>
      </g>
      <circle cx="250" cy="160" r="24" fill="#b5edcf"/><circle cx="93" cy="212" r="10" fill="#d5ae7f"/>
      <circle cx="367" cy="101" r="13" fill="#8bbac4"/><circle cx="288" cy="272" r="7" fill="#b5edcf"/>
      <g fill="#a9bdb7" font-family="sans-serif" font-size="12"><text x="277" y="153">the idea</text><text x="376" y="80">perspective</text></g>
    </svg>
    <div class="legend"><span><i class="mint"/> Idea</span><span><i class="blue"/> Perspective</span><span><i class="sand"/> Observation</span></div>
  </article>
  <article v-else-if="id === 'guide'" class="document guide">
    <p class="eyebrow">A WORKSPACE THAT MOVES WITH YOU</p><h2>Make yourself some space.</h2>
    <p class="muted">This is a playground for @0k/vue-split-tabs. The library owns the layout. This little app owns everything inside it.</p>
    <ol class="guide-list">
      <li><strong>Pull a tab to an edge.</strong><span>Right or left for columns. Top or bottom for rows. The shade shows where it will land.</span></li>
      <li><strong>Give things a little room.</strong><span>Split any pane again. Drag dividers; use arrows or Home/End. Double-click or Enter equalizes.</span></li>
      <li><strong>Keep your train of thought.</strong><span>Write in Notes, move it, then narrow the window. The split restores when it fits.</span></li>
      <li><strong>Bring something in.</strong><span>Drag an item from the collection. On touch, hold a tab for a moment before moving.</span></li>
      <li><strong>Make it yours.</strong><span>Reorder with a drag or Alt+Shift+arrows. Open extras with +, close with ×. Layout survives reload.</span></li>
    </ol>
  </article>
  <article v-else-if="id === 'checklist'" class="document">
    <p class="eyebrow">OPTIONAL / INTERACTIVE</p><h2>A small checklist.</h2><p class="muted">Local component state stays with this tab, too.</p>
    <label v-for="task in ['Find a fresh perspective', 'Move Notes to another pane', 'Resize, collapse, restore']" :key="task" class="task">
      <input v-model="done" type="checkbox" :value="task"> {{ task }}
    </label>
    <button class="button" type="button" @click="$emit('replace')">Replace with Reference</button>
    <p class="muted">Replacement uses one controller action, not close followed by open.</p>
  </article>
  <article v-else-if="id === 'colors'" class="document">
    <p class="eyebrow">FROM THE COLLECTION</p><h2>A quieter palette.</h2><p class="muted">An external item, handed to the very same drag system.</p>
    <div class="swatches"><div class="mint">Fern<br>#b5edcf</div><div class="blue">Mist<br>#8bbac4</div><div class="sand">Dune<br>#d5ae7f</div></div>
  </article>
  <article v-else-if="id === 'reading'" class="document">
    <p class="eyebrow">FROM THE COLLECTION</p><h2>Leave room for curiosity.</h2>
    <blockquote>“The real voyage of discovery consists not in seeking new landscapes, but in having new eyes.”</blockquote>
    <p class="muted">A reading-list card. Drag it back to a strip, or close it when you are done.</p>
  </article>
  <article v-else class="document">
    <p class="eyebrow">OPTIONAL / REFERENCE</p><h2>Small API. Plenty of room.</h2>
    <dl class="reference"><dt>Controller</dt><dd>Intent, effective panes, ordering and storage.</dd>
      <dt>Components</dt><dd>Strips, dividers, gestures and mounted content.</dd>
      <dt>Host application</dt><dd>Labels, content, themes and external sources.</dd></dl>
    <p class="muted">Open the layout inspector below to see persistent intent alongside the panes that actually fit.</p>
  </article>
</template>
