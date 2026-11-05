<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps<{ title: string | null; label?: string | undefined }>();
const emit = defineEmits<{ commit: [title: string]; cancel: [] }>();
const input = ref<HTMLInputElement | null>(null);
const value = ref(props.title ?? "");
let finished = false;
function finish(commit: boolean): void {
  if (finished) return;
  finished = true;
  if (commit) emit("commit", value.value); else emit("cancel");
}
function keydown(event: KeyboardEvent): void {
  if (event.isComposing || (event.key !== "Enter" && event.key !== "Escape")) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  finish(event.key === "Enter");
}
onMounted(() => { input.value?.focus({ preventScroll: true }); input.value?.select(); });
onBeforeUnmount(() => finish(true));
</script>

<template>
  <input ref="input" v-model="value" class="split-tab-strip-rename" :aria-label="label"
    @keydown="keydown" @pointerdown.stop @click.stop @dblclick.stop @blur="finish(true)">
</template>
