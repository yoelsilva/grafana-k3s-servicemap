/**
 * Genera `nodos.json`: el dashboard de los nodos, para dimensionar el clúster entero.
 *
 *   node dashboards/make-nodos.js
 *
 * REGLA: aquí solo entra lo que se ha visto con datos en el Prometheus de producción.
 * Comprobado el 2026-09-28 (node-exporter vía Alloy, con `cluster` e `instance` = el nodo):
 * - `node_cpu_seconds_total`, `node_memory_MemTotal_bytes`, `node_memory_MemAvailable_bytes`,
 *   `node_load1`, `node_filesystem_size_bytes` y `node_filesystem_avail_bytes`.
 * - Cada nodo tiene `/` (ext4) y `/boot/efi` (vfat); solo cuenta `/`.
 * - NO llegan `machine_*` ni kube-state-metrics con `cluster`: no hay «reservado por
 *   requests» ni «allocatable». Se dimensiona por lo que se usa frente a lo que hay.
 */
const fs = require('fs');
const path = require('path');

const PROM = { type: 'prometheus', uid: '${datasource}' };
const C = 'cluster="$cluster"';

const IDLE = `node_cpu_seconds_total{${C}, mode="idle"}`;
/** Núcleos de cada nodo: una serie `idle` por núcleo. */
const CORES = `count by (instance) (${IDLE})`;
/** Núcleos en uso por nodo: lo que no está ocioso. */
const CPU_USED = `sum by (instance) (1 - rate(${IDLE}[5m]))`;
const CPU_PCT = `(${CPU_USED} / ${CORES})`;
// `max by (instance)`: las dos métricas de memoria llevan las mismas etiquetas, pero así la
// resta y la división no dependen de que siempre sea así.
const MEM_TOTAL = `max by (instance) (node_memory_MemTotal_bytes{${C}})`;
const MEM_USED = `(${MEM_TOTAL} - max by (instance) (node_memory_MemAvailable_bytes{${C}}))`;
const MEM_PCT = `(${MEM_USED} / ${MEM_TOTAL})`;
const ROOT = `${C}, mountpoint="/"`;
const DISK_SIZE = `max by (instance) (node_filesystem_size_bytes{${ROOT}})`;
const DISK_USED = `(${DISK_SIZE} - max by (instance) (node_filesystem_avail_bytes{${ROOT}}))`;
const DISK_PCT = `(${DISK_USED} / ${DISK_SIZE})`;
/** Carga por núcleo: por encima de 1, hay más trabajo esperando del que el nodo despacha. */
const LOAD_PER_CORE = `(max by (instance) (node_load1{${C}}) / ${CORES})`;

const overRange = (fn, inner) => `${fn}((${inner})[$__range:5m])`;
const p95 = (inner) => `quantile_over_time(0.95, (${inner})[$__range:5m])`;

let nextId = 1;
const target = (expr, legendFormat = '', extra = {}) => ({ datasource: PROM, expr, legendFormat, ...extra });

function panel(type, title, description, gridPos, targets, extra = {}) {
  return {
    id: nextId++,
    type,
    title,
    description,
    datasource: PROM,
    gridPos,
    targets: targets.map((t, i) => ({ ...t, refId: String.fromCharCode(65 + i) })),
    ...extra,
  };
}

const stat = (title, description, gridPos, expr, unit, decimals) =>
  panel('stat', title, description, gridPos, [target(expr, '', { instant: true })], {
    fieldConfig: { defaults: { unit, decimals, color: { mode: 'fixed', fixedColor: 'text' } }, overrides: [] },
    options: {
      reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
      colorMode: 'value',
      graphMode: 'none',
      textMode: 'value',
      justifyMode: 'center',
      orientation: 'auto',
    },
  });

const series = (title, description, gridPos, expr, unit, max) =>
  panel('timeseries', title, description, gridPos, [target(expr, '{{instance}}')], {
    fieldConfig: {
      defaults: {
        unit,
        min: 0,
        ...(max !== undefined ? { max } : {}),
        custom: { drawStyle: 'line', lineWidth: 1, fillOpacity: 10, showPoints: 'never', spanNulls: true },
      },
      overrides: [],
    },
    options: {
      legend: { displayMode: 'table', placement: 'bottom', showLegend: true, calcs: ['mean', 'max'] },
      tooltip: { mode: 'multi', sort: 'desc' },
    },
  });

/** Umbrales de ocupación: amarillo al 70 %, rojo al 85 %. */
const BUSY = {
  mode: 'absolute',
  steps: [
    { color: 'green', value: null },
    { color: 'yellow', value: 0.7 },
    { color: 'red', value: 0.85 },
  ],
};
const gaugeCell = [
  { id: 'unit', value: 'percentunit' },
  { id: 'decimals', value: 0 },
  { id: 'min', value: 0 },
  { id: 'max', value: 1 },
  { id: 'custom.cellOptions', value: { type: 'color-text' } },
  { id: 'thresholds', value: BUSY },
];

/** Columnas de la tabla por nodo: [título, expresión, propiedades de la columna]. */
const COLUMNS = [
  ['Núcleos', CORES, [{ id: 'decimals', value: 0 }]],
  ['CPU media', overRange('avg_over_time', CPU_PCT), gaugeCell],
  ['CPU p95', p95(CPU_PCT), gaugeCell],
  ['RAM', MEM_TOTAL, [{ id: 'unit', value: 'bytes' }, { id: 'decimals', value: 1 }]],
  ['RAM media', overRange('avg_over_time', MEM_PCT), gaugeCell],
  ['RAM máxima', overRange('max_over_time', MEM_PCT), gaugeCell],
  ['Disco /', DISK_SIZE, [{ id: 'unit', value: 'bytes' }, { id: 'decimals', value: 0 }]],
  ['Disco ocupado', DISK_PCT, gaugeCell],
  [
    'Días hasta llenarse',
    // Al ritmo al que ha crecido en el rango; solo si ha crecido.
    `(${DISK_SIZE} - ${DISK_USED}) / ((deriv(${DISK_USED}[$__range:5m]) * 86400) > 0)`,
    [
      { id: 'decimals', value: 0 },
      { id: 'mappings', value: [{ type: 'special', options: { match: 'null', result: { text: 'No crece' } } }] },
    ],
  ],
  [
    'Carga p95 / núcleo',
    p95(LOAD_PER_CORE),
    [
      { id: 'decimals', value: 2 },
      { id: 'custom.cellOptions', value: { type: 'color-text' } },
      {
        id: 'thresholds',
        value: { mode: 'absolute', steps: [{ color: 'green', value: null }, { color: 'yellow', value: 0.7 }, { color: 'red', value: 1 }] },
      },
    ],
  ],
];

const panels = [
  // --- El clúster entero: lo que hay frente a lo que se usa -------------------------
  stat('Nodos', 'Nodos con métricas ahora mismo.', { h: 4, w: 3, x: 0, y: 0 }, `count(${MEM_TOTAL})`, 'short', 0),
  stat('Núcleos', 'Núcleos de CPU sumando todos los nodos.', { h: 4, w: 3, x: 3, y: 0 }, `sum(${CORES})`, 'short', 0),
  stat(
    'CPU usada p95',
    'Núcleos en uso en todo el clúster: el 95 % del tiempo se usa esto o menos. Frente a «Núcleos», cuánto margen queda.',
    { h: 4, w: 4, x: 6, y: 0 },
    p95(`sum(${CPU_USED})`),
    'none',
    2
  ),
  stat(
    'CPU usada máxima',
    'Núcleos en uso en todo el clúster, el pico más alto del rango (ventanas de 5 minutos).',
    { h: 4, w: 4, x: 10, y: 0 },
    overRange('max_over_time', `sum(${CPU_USED})`),
    'none',
    2
  ),
  stat('RAM', 'Memoria sumando todos los nodos.', { h: 4, w: 3, x: 14, y: 0 }, `sum(${MEM_TOTAL})`, 'bytes', 1),
  stat(
    'RAM usada máxima',
    'Memoria en uso en todo el clúster, el pico del rango. En memoria manda el pico: no se puede estrangular como la CPU.',
    { h: 4, w: 4, x: 17, y: 0 },
    overRange('max_over_time', `sum(${MEM_USED})`),
    'bytes',
    1
  ),
  stat(
    'Disco más lleno',
    'El `/` más ocupado de todos los nodos, ahora.',
    { h: 4, w: 3, x: 21, y: 0 },
    `max(${DISK_PCT})`,
    'percentunit',
    0
  ),

  // --- Por nodo: dónde está el cuello de botella ---------------------------------
  panel(
    'table',
    'Por nodo',
    'CPU y RAM en porcentaje de lo que tiene cada nodo, en el rango elegido. Amarillo desde el 70 %, rojo ' +
      'desde el 85 %. Carga por núcleo por encima de 1: hay más trabajo esperando del que el nodo despacha.',
    { h: 8, w: 24, x: 0, y: 4 },
    COLUMNS.map(([, expr]) => target(expr, '', { instant: true, format: 'table' })),
    {
      options: { showHeader: true, cellHeight: 'sm', sortBy: [{ displayName: 'Nodo', desc: false }] },
      fieldConfig: {
        defaults: {},
        overrides: COLUMNS.map(([name, , properties]) => ({ matcher: { id: 'byName', options: name }, properties })),
      },
      transformations: [
        { id: 'merge', options: {} },
        {
          id: 'organize',
          options: {
            excludeByName: { Time: true },
            indexByName: Object.fromEntries([['instance', 0], ...COLUMNS.map(([, ,], i) => [`Value #${String.fromCharCode(65 + i)}`, i + 1])]),
            renameByName: Object.fromEntries([
              ['instance', 'Nodo'],
              ...COLUMNS.map(([name], i) => [`Value #${String.fromCharCode(65 + i)}`, name]),
            ]),
          },
        },
      ],
    }
  ),

  // --- En el tiempo --------------------------------------------------------------
  series('CPU por nodo', 'Porcentaje de sus núcleos en uso.', { h: 9, w: 12, x: 0, y: 12 }, CPU_PCT, 'percentunit', 1),
  series('RAM por nodo', 'Porcentaje de su memoria en uso.', { h: 9, w: 12, x: 12, y: 12 }, MEM_PCT, 'percentunit', 1),
  series(
    'Carga por núcleo',
    'Carga del último minuto dividida entre sus núcleos. Por encima de 1, el nodo no da abasto.',
    { h: 8, w: 12, x: 0, y: 21 },
    LOAD_PER_CORE,
    'none'
  ),
  series('Disco / por nodo', 'Porcentaje ocupado del disco raíz de cada nodo.', { h: 8, w: 12, x: 12, y: 21 }, DISK_PCT, 'percentunit', 1),
];

const dashboard = {
  annotations: { list: [] },
  description:
    'Los nodos del clúster: cuánto hay y cuánto se usa de CPU, RAM y disco, para dimensionar. ' +
    'Para decidir, mira al menos 7 días.',
  editable: true,
  graphTooltip: 1,
  links: [
    {
      title: 'Mapa de servicio',
      type: 'link',
      icon: 'apps',
      tooltip: 'Volver al mapa',
      url: '/d/servicemap?var-cluster=${cluster}',
      keepTime: true,
      includeVars: false,
      targetBlank: false,
      asDropdown: false,
      tags: [],
    },
  ],
  panels,
  refresh: '',
  schemaVersion: 39,
  tags: ['tecopos', 'servicemap', 'nodos'],
  templating: {
    list: [
      { name: 'datasource', label: 'Prometheus', type: 'datasource', query: 'prometheus', current: {}, hide: 2, refresh: 1 },
      {
        name: 'cluster',
        label: 'Cluster',
        type: 'query',
        datasource: PROM,
        definition: 'label_values(node_memory_MemTotal_bytes, cluster)',
        query: { query: 'label_values(node_memory_MemTotal_bytes, cluster)', refId: 'A' },
        refresh: 1,
        sort: 1,
        includeAll: false,
        multi: false,
        current: {},
      },
    ],
  },
  time: { from: 'now-7d', to: 'now' },
  timezone: '',
  title: 'Nodos',
  uid: 'servicemap-nodos',
  version: 1,
};

const out = path.join(__dirname, 'nodos.json');
fs.writeFileSync(out, JSON.stringify(dashboard, null, 2) + '\n');
console.log(`escrito ${out}: ${panels.length} paneles`);
