<script setup lang="ts">
import type { TrafficDay } from '~/types/api'
import { formatCount, monthTitle, niceTicks } from '~/utils/traffic-format'

/**
 * Visits per day of the month: this month (stops at today) over last month
 * (recessive, dashed). A crosshair finds the day; one tooltip shows both.
 */
const props = defineProps<{
  current: { month: string, days: TrafficDay[] }
  previous: { month: string, days: TrafficDay[] }
}>()

const plotRef = ref<HTMLElement | null>(null)
const W = useElementWidth(plotRef)
const H = 240
const PAD = { top: 12, right: 12, bottom: 26, left: 44 }
const plotW = computed(() => Math.max(120, W.value - PAD.left - PAD.right))
const plotH = H - PAD.top - PAD.bottom
const DAYS = 31

const ticks = computed(() =>
  niceTicks(Math.max(0, ...[...props.current.days, ...props.previous.days].map(d => d.visits ?? 0))),
)
const top = computed(() => ticks.value[ticks.value.length - 1] || 1)
const x = (day: number) => PAD.left + ((day - 1) / (DAYS - 1)) * plotW.value
const y = (v: number) => PAD.top + plotH - (v / top.value) * plotH

function linePath(days: TrafficDay[]) {
  let d = ''
  let pen = false
  for (const point of days) {
    if (point.visits === null) {
      pen = false
      continue
    }
    d += `${pen ? 'L' : 'M'}${x(point.day).toFixed(1)},${y(point.visits).toFixed(1)}`
    pen = true
  }
  return d
}

const currentPath = computed(() => linePath(props.current.days))
const previousPath = computed(() => linePath(props.previous.days))
const lastCurrent = computed(() => [...props.current.days].reverse().find(d => d.visits !== null) ?? null)
const xTicks = computed(() => (plotW.value < 360 ? [1, 10, 20, 31] : [1, 5, 10, 15, 20, 25, 31]))

const hoverDay = ref<number | null>(null)
/** On a narrow screen the tooltip sits under the chart instead of over it. */
const docked = computed(() => W.value < 520)
const svgRef = ref<SVGSVGElement | null>(null)

function onMove(event: PointerEvent) {
  const svg = svgRef.value
  if (!svg) return
  const box = svg.getBoundingClientRect()
  const px = event.clientX - box.left
  const day = Math.round(((px - PAD.left) / plotW.value) * (DAYS - 1)) + 1
  hoverDay.value = Math.min(DAYS, Math.max(1, day))
}

function onKey(event: KeyboardEvent) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  const step = event.key === 'ArrowLeft' ? -1 : 1
  hoverDay.value = Math.min(DAYS, Math.max(1, (hoverDay.value ?? 1) + step))
}

const readout = computed(() => {
  if (hoverDay.value === null) return null
  const day = hoverDay.value
  return {
    day,
    current: props.current.days.find(d => d.day === day),
    previous: props.previous.days.find(d => d.day === day),
  }
})
</script>

<template>
  <div class="days-chart">
    <ul class="legend">
      <li><span class="line-key current" />{{ monthTitle(current.month) }}</li>
      <li><span class="line-key previous" />{{ monthTitle(previous.month) }}</li>
    </ul>
    <div ref="plotRef" class="plot">
      <svg
        ref="svgRef"
        :viewBox="`0 0 ${W} ${H}`"
        :width="W"
        :height="H"
        role="img"
        :aria-label="`Визиты по дням: ${monthTitle(current.month)} и ${monthTitle(previous.month)}`"
        tabindex="0"
        @pointermove="onMove"
        @pointerleave="hoverDay = null"
        @keydown="onKey"
        @blur="hoverDay = null"
      >
        <g class="grid">
          <g v-for="t in ticks" :key="t">
            <line :x1="PAD.left" :x2="W - PAD.right" :y1="y(t)" :y2="y(t)" />
            <text :x="PAD.left - 8" :y="y(t)" dy="0.32em" text-anchor="end">{{ formatCount(t) }}</text>
          </g>
          <text v-for="d in xTicks" :key="d" class="axis" :x="x(d)" :y="H - 8" text-anchor="middle">{{ d }}</text>
        </g>
        <path class="line previous" :d="previousPath" />
        <path class="line current" :d="currentPath" />
        <circle
          v-if="lastCurrent && lastCurrent.visits !== null"
          class="end-dot"
          :cx="x(lastCurrent.day)"
          :cy="y(lastCurrent.visits)"
          r="4"
        />
        <g v-if="readout">
          <line class="crosshair" :x1="x(readout.day)" :x2="x(readout.day)" :y1="PAD.top" :y2="PAD.top + plotH" />
          <circle
            v-if="readout.previous"
            class="dot previous"
            :cx="x(readout.day)"
            :cy="y(readout.previous.visits ?? 0)"
            r="4"
          />
          <circle
            v-if="readout.current && readout.current.visits !== null"
            class="dot current"
            :cx="x(readout.day)"
            :cy="y(readout.current.visits)"
            r="4"
          />
        </g>
      </svg>
      <div
        v-if="readout"
        class="tooltip"
        :style="docked ? {} : { left: `${x(readout.day)}px` }"
        :class="{ flip: !docked && readout.day > 16, docked }"
      >
        <div class="tooltip-title">{{ readout.day }}-е число</div>
        <div class="tooltip-row">
          <span class="line-key current" />
          <strong>{{ readout.current?.visits === null || !readout.current ? '—' : formatCount(readout.current.visits) }}</strong>
          <span>{{ monthTitle(current.month) }}</span>
        </div>
        <div class="tooltip-row">
          <span class="line-key previous" />
          <strong>{{ readout.previous ? formatCount(readout.previous.visits ?? 0) : '—' }}</strong>
          <span>{{ monthTitle(previous.month) }}</span>
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

.line-key {
  display: inline-block;
  width: 14px;
  height: 2px;
  border-radius: 1px;
}

.line-key.current {
  background: var(--chart-1);
}

.line-key.previous {
  background: repeating-linear-gradient(90deg, var(--chart-muted) 0 4px, transparent 4px 7px);
}

.plot {
  position: relative;
}

svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
  outline: none;
  touch-action: pan-y;
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

.line {
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.line.current {
  stroke: var(--chart-1);
}

.line.previous {
  stroke: var(--chart-muted);
  stroke-dasharray: 5 4;
}

.end-dot,
.dot.current {
  fill: var(--chart-1);
  stroke: var(--surface-card);
  stroke-width: 2;
}

.dot.previous {
  fill: var(--chart-muted);
  stroke: var(--surface-card);
  stroke-width: 2;
}

.crosshair {
  stroke: var(--text-muted);
  stroke-width: 1;
  stroke-dasharray: 2 3;
}

.tooltip {
  position: absolute;
  top: 0;
  z-index: 2;
  min-width: 170px;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  box-shadow: var(--shadow-sm);
  font-size: var(--text-sm);
  pointer-events: none;
  transform: translateX(12px);
}

.tooltip.flip {
  transform: translateX(calc(-100% - 12px));
}

.tooltip.docked {
  position: static;
  margin-top: var(--space-2);
  box-shadow: none;
  transform: none;
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
</style>
