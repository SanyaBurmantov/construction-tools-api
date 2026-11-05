<script setup lang="ts">
import type { TrafficDevice, TrafficMonth } from '~/types/api'
import { DEVICE_LABELS, formatCount, monthLabel, monthTitle, niceTicks } from '~/utils/traffic-format'

/**
 * Visits per month for the last twelve, stacked by device. One axis, one
 * measure; the total sits above each bar, the split is in the tooltip and in
 * the table under the chart (slot 3 is under 3:1 on white).
 */
const props = defineProps<{ months: TrafficMonth[] }>()

/** Fixed order = fixed colour: a device keeps its hue whatever the data. */
const SERIES: Array<{ key: TrafficDevice, color: string }> = [
  { key: 'mobile', color: 'var(--chart-1)' },
  { key: 'desktop', color: 'var(--chart-2)' },
  { key: 'tablet', color: 'var(--chart-3)' },
]

const plotRef = ref<HTMLElement | null>(null)
const W = useElementWidth(plotRef)
const H = 260
const PAD = { top: 22, right: 8, bottom: 26, left: 44 }
const plotW = computed(() => Math.max(120, W.value - PAD.left - PAD.right))
const plotH = H - PAD.top - PAD.bottom

const ticks = computed(() => niceTicks(Math.max(0, ...props.months.map(m => m.visits))))
const top = computed(() => ticks.value[ticks.value.length - 1] || 1)
const slot = computed(() => plotW.value / Math.max(1, props.months.length))
/** Totals above the bars only where they fit; otherwise tooltip and table. */
const showTotals = computed(() => slot.value >= 40)
/** Every month labelled where there is room, every second or third on a phone. */
const labelEvery = computed(() => (slot.value >= 32 ? 1 : slot.value >= 20 ? 2 : 3))
const showLabel = (i: number) => (props.months.length - 1 - i) % labelEvery.value === 0
/** On a narrow screen the tooltip sits under the chart instead of over it. */
const docked = computed(() => W.value < 520)
const barW = computed(() => Math.min(36, slot.value * 0.56))
const y = (v: number) => PAD.top + plotH - (v / top.value) * plotH

/** Segment geometry; only the top segment of a bar gets the 4px rounded end. */
const bars = computed(() =>
  props.months.map((m, i) => {
    const x = PAD.left + slot.value * i + (slot.value - barW.value) / 2
    let base = 0
    const present = SERIES.filter(s => m.devices[s.key] > 0)
    const segments = present.map((s, j) => {
      const value = m.devices[s.key]
      const y0 = y(base)
      const y1 = y(base + value)
      base += value
      // 2px surface gap between stacked fills.
      const gap = j > 0 ? 2 : 0
      return { key: s.key, color: s.color, y: y1, h: Math.max(0, y0 - y1 - gap), isTop: j === present.length - 1 }
    })
    return { month: m, x, segments }
  }),
)

function segmentPath(x: number, yTop: number, w: number, h: number, rounded: boolean) {
  if (!rounded || h < 4) return `M${x},${yTop}h${w}v${h}h${-w}z`
  const r = Math.min(4, w / 2, h)
  return `M${x},${yTop + h}V${yTop + r}q0,${-r} ${r},${-r}h${w - 2 * r}q${r},0 ${r},${r}V${yTop + h}z`
}

const hovered = ref<number | null>(null)
const tooltip = computed(() => (hovered.value === null ? null : props.months[hovered.value] ?? null))
/** Beside the column, never over it: right of it, or left near the edge. */
const tooltipStyle = computed(() => {
  if (hovered.value === null || docked.value) return {}
  const flip = hovered.value >= props.months.length / 2
  const x = flip ? PAD.left + slot.value * hovered.value : PAD.left + slot.value * (hovered.value + 1)
  return { left: `${x}px`, transform: flip ? 'translateX(calc(-100% - 4px))' : 'translateX(4px)' }
})
</script>

<template>
  <div class="months-chart">
    <ul class="legend">
      <li v-for="s in SERIES" :key="s.key">
        <span class="key" :style="{ background: s.color }" />{{ DEVICE_LABELS[s.key] }}
      </li>
    </ul>
    <div ref="plotRef" class="plot" @pointerleave="hovered = null">
      <svg :viewBox="`0 0 ${W} ${H}`" :width="W" :height="H" role="img" aria-label="Визиты по месяцам за год, по устройствам">
        <g class="grid">
          <g v-for="t in ticks" :key="t">
            <line :x1="PAD.left" :x2="W - PAD.right" :y1="y(t)" :y2="y(t)" />
            <text :x="PAD.left - 8" :y="y(t)" dy="0.32em" text-anchor="end">{{ formatCount(t) }}</text>
          </g>
        </g>
        <g v-for="(bar, i) in bars" :key="bar.month.month" :class="{ dim: hovered !== null && hovered !== i }">
          <path
            v-for="seg in bar.segments"
            :key="seg.key"
            :d="segmentPath(bar.x, seg.y, barW, seg.h, seg.isTop)"
            :fill="seg.color"
          />
          <text
            v-if="bar.month.visits && showTotals"
            class="total"
            :x="bar.x + barW / 2"
            :y="y(bar.month.visits) - 6"
            text-anchor="middle"
          >{{ formatCount(bar.month.visits) }}</text>
          <text v-if="showLabel(i)" class="axis" :x="bar.x + barW / 2" :y="H - 8" text-anchor="middle">
            {{ monthLabel(bar.month.month) }}
          </text>
          <!-- Hit target: the whole column, bigger than the mark. -->
          <rect
            class="hit"
            :x="PAD.left + slot * i"
            :y="PAD.top"
            :width="slot"
            :height="plotH"
            tabindex="0"
            :aria-label="`${monthTitle(bar.month.month)}: ${bar.month.visits} визитов`"
            @pointerenter="hovered = i"
            @focus="hovered = i"
            @blur="hovered = null"
          />
        </g>
      </svg>
      <div v-if="tooltip" class="tooltip" :class="{ docked }" :style="tooltipStyle">
        <div class="tooltip-title">{{ monthTitle(tooltip.month) }}</div>
        <div class="tooltip-row">
          <strong>{{ formatCount(tooltip.visits) }}</strong><span>визитов</span>
        </div>
        <div v-for="s in SERIES" :key="s.key" class="tooltip-row">
          <span class="line-key" :style="{ background: s.color }" />
          <strong>{{ formatCount(tooltip.devices[s.key]) }}</strong><span>{{ DEVICE_LABELS[s.key] }}</span>
        </div>
        <div class="tooltip-row muted">
          {{ formatCount(tooltip.visitors) }} посетителей · {{ formatCount(tooltip.views) }} просмотров
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  margin: 0 0 var(--space-2);
  padding: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
  list-style: none;
}

.legend li {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.key {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.plot {
  position: relative;
}

svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}

.grid line {
  stroke: var(--chart-grid);
  stroke-width: 1;
}

.grid text,
.axis {
  fill: var(--text-muted);
  font-size: 11px;
}

.total {
  fill: var(--text-strong);
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.dim path {
  opacity: 0.45;
}

.hit {
  fill: transparent;
  outline: none;
  cursor: default;
}

.tooltip {
  position: absolute;
  top: 0;
  z-index: 2;
  min-width: 180px;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  box-shadow: var(--shadow-sm);
  font-size: var(--text-sm);
  pointer-events: none;
}

.tooltip.docked {
  position: static;
  margin-top: var(--space-2);
  box-shadow: none;
}

.tooltip-title {
  margin-bottom: var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.tooltip-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  white-space: nowrap;
}

.tooltip-row strong {
  color: var(--text-strong);
  font-variant-numeric: tabular-nums;
}

.tooltip-row span:not(.line-key) {
  color: var(--text-muted);
}

.tooltip-row.muted {
  margin-top: var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.line-key {
  width: 12px;
  height: 2px;
  border-radius: 1px;
}
</style>
