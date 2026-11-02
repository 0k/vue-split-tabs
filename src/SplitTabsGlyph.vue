<script setup lang="ts">
import type { Orientation, SplitSide } from "./controller.js";

defineProps<{ kind: "split" | "move" | "close"; orientation?: Orientation; side?: SplitSide }>();
</script>

<template>
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"
    :data-direction="kind === 'split' && side === undefined ? orientation : undefined"
    :data-orientation="kind === 'split' && side !== undefined ? orientation : undefined"
    :data-side="kind === 'split' ? side : undefined">
    <path v-if="kind === 'close'" d="m6 6 12 12M6 18 18 6" stroke-linecap="round" />
    <template v-else-if="kind === 'move'">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M8 12h8m-3-3 3 3-3 3" stroke-linecap="round" stroke-linejoin="round" />
    </template>
    <template v-else-if="orientation === 'rows'">
      <rect x="3" y="3" width="18" height="7" :fill="side === 'start' ? 'currentColor' : undefined" />
      <rect x="3" y="14" width="18" height="7" :fill="side === 'end' ? 'currentColor' : undefined" />
      <path v-if="side === undefined" d="M3 12h18" />
    </template>
    <template v-else>
      <rect x="3" y="3" width="7" height="18" :fill="side === 'start' ? 'currentColor' : undefined" />
      <rect x="14" y="3" width="7" height="18" :fill="side === 'end' ? 'currentColor' : undefined" />
      <path v-if="side === undefined" d="M12 3v18" />
    </template>
  </svg>
</template>
