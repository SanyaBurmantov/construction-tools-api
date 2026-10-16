<script lang="ts">
/**
 * The storefront's line icons, one path each on a 24×24 grid. They used to be
 * pasted inline wherever they were drawn — the heart alone lived in five
 * files, and the copy in the mobile nav had lost the cart's wheels. Add a new
 * glyph here rather than another inline <svg>.
 */
const PATHS = {
  alert: 'M12 8v5m0 3h.01M10.3 3.9L2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  box: 'M4 8l8-4 8 4v8l-8 4-8-4V8zm0 0l8 4m0 0l8-4m-8 4v8',
  cart: 'M3 4h2l2.4 10.4A2 2 0 0 0 9.35 16H17a2 2 0 0 0 1.95-1.55L20.5 8H6M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  'chevron-down': 'M7 10l5 5 5-5',
  'chevron-left': 'M15 5l-7 7 7 7',
  'chevron-right': 'M9 5l7 7-7 7',
  check: 'M20 6L9 17l-5-5',
  close: 'M6 6l12 12M18 6L6 18',
  compare: 'M6 20V9m6 11V4m6 16v-7',
  expand: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
  grid: 'M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v4H4zM14 15h6v4h-6z',
  heart: 'M12 20s-7-4.5-7-9.5A3.5 3.5 0 0 1 12 8a3.5 3.5 0 0 1 7 2.5C19 15.5 12 20 12 20z',
  home: 'M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm7.5 14.5L16 16',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.8l-5.25 2.8 1-5.8L3.5 9.7l5.9-.9z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 8a7 7 0 0 1 14 0',
} as const

export type IconName = keyof typeof PATHS
</script>

<script setup lang="ts">
withDefaults(
  defineProps<{
    name: IconName
    /** Pixel size; omit it to size the icon from CSS. */
    size?: number
    strokeWidth?: number
    /** Fills the shape too — the "on" state of the heart. */
    filled?: boolean
  }>(),
  { size: undefined, strokeWidth: 1.6, filled: false }
)
</script>

<template>
  <svg viewBox="0 0 24 24" :width="size" :height="size" aria-hidden="true">
    <path
      :d="PATHS[name]"
      :fill="filled ? 'currentColor' : 'none'"
      stroke="currentColor"
      :stroke-width="strokeWidth"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>
