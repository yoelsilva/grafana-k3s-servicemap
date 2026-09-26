/**
 * Genera `servicio.json`: el dashboard de detalle al que lleva el doble clic en un
 * nodo del mapa. Uno para todos los servicios del clúster, elegido por selector.
 *
 *   node dashboards/make-servicio.js
 *
 * Sirve para dimensionar: cuánta CPU y RAM usa de verdad cada pod del servicio.
 *
 * REGLA: aquí solo entra lo que se ha visto con datos en el Prometheus de producción.
 * Un panel vacío no ayuda a decidir y resta confianza al resto. Comprobado el 2026-09-26:
 * - `container_cpu_usage_seconds_total` y `container_memory_working_set_bytes` (cAdvisor,
 *   vía Alloy) llegan con `cluster`, `namespace`, `pod` y `container`.
 * - NO llegan: kube-state-metrics con `cluster` (réplicas, reinicios, requests, límites),
 *   `container_spec_*` (límites vistos por cAdvisor) ni el estrangulamiento de CPU.
 *   Por eso no hay límites en las gráficas: no existen en el Prometheus.
 * - `kubelet_volume_stats_used_bytes` y `_capacity_bytes` llegan con `namespace` y
 *   `persistentvolumeclaim`, pero sin el pod que monta el volumen. Se asocia por nombre:
 *   `<servicio>-pvc` o `<servicio>-data`. Un volumen con otro nombre no sale.
 *
 * Se agrupa por POD, nunca por contenedor: dos Deployments distintos pueden tener un
 * contenedor con el mismo nombre (pasa en producción), y agrupar por contenedor los
 * sumaría como si fueran uno.
 */
const fs = require('fs');
const path = require('path');

const PROM = { type: 'prometheus', uid: '${datasource}' };

/**
 * Los pods de un Deployment se llaman `<nombre>-<hash del ReplicaSet>-<5 caracteres>`
 * y los de un StatefulSet `<nombre>-<ordinal>`. Prometheus ancla las regex por los dos
 * extremos, así que `web` no casa con los pods de `web-pro`: el hash no admite guiones.
 */
const POD_SUFFIX = '-[a-z0-9]{5,10}-[a-z0-9]{5}';
const PODS = `$servicio${POD_SUFFIX}|$servicio-[0-9]+`;
/**
 * cAdvisor emite cada métrica dos veces por pod: una por contenedor y otra por el cgroup
 * del pod entero (`container=""`). Sin este filtro todo saldría el doble.
 */
const SEL = `cluster="$cluster", namespace="$namespace", pod=~"${PODS}", container!="", container!="POD"`;

const CPU_BY_POD = `sum by (pod) (rate(container_cpu_usage_seconds_total{${SEL}}[5m]))`;
const RAM_BY_POD = `sum by (pod) (container_memory_working_set_bytes{${SEL}})`;

/**
 * Una cifra del rango elegido, calculada por pod y quedándose con el pod que más usa:
 * se dimensiona por pod, y el que más pide es el que marca el mínimo.
 * La subconsulta muestrea cada 5 minutos, que con 7 días son ~2 000 puntos por pod.
 */
const overRange = (fn, inner) => `max(${fn}((${inner})[$__range:5m]))`;
const p95 = (inner) => `max(quantile_over_time(0.95, (${inner})[$__range:5m]))`;

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
    fieldConfig: {
      defaults: {
        unit,
        decimals,
        color: { mode: 'fixed', fixedColor: 'text' },
      },
      overrides: [],
    },
    options: {
      reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
      colorMode: 'value',
      graphMode: 'none',
      textMode: 'value',
      justifyMode: 'center',
      orientation: 'auto',
    },
  });

const series = (title, description, gridPos, expr, unit) =>
  panel('timeseries', title, description, gridPos, [target(expr, '{{pod}}')], {
    fieldConfig: {
      defaults: {
        unit,
        min: 0,
        custom: { drawStyle: 'line', lineWidth: 1, fillOpacity: 10, showPoints: 'never', spanNulls: true },
      },
      overrides: [],
    },
    options: {
      legend: { displayMode: 'table', placement: 'bottom', showLegend: true, calcs: ['mean', 'max'] },
      tooltip: { mode: 'multi', sort: 'desc' },
    },
  });

/** Volúmenes de un servicio, por convención de nombre (ver cabecera). */
const VOLUMES = '$servicio-pvc|$servicio-data';
const VOL = `cluster="$cluster", namespace="$namespace", persistentvolumeclaim=~"${VOLUMES}"`;
// Un volumen puede aparecer en varias series (una por nodo que lo reporta): `max`, no `sum`.
const USED = `max by (persistentvolumeclaim) (kubelet_volume_stats_used_bytes{${VOL}})`;
const CAPACITY = `max by (persistentvolumeclaim) (kubelet_volume_stats_capacity_bytes{${VOL}})`;

const CPU_UNIT = 'none';
const RAM_UNIT = 'bytes';

const panels = [
  // --- Para dimensionar: seis cifras del rango elegido ------------------------
  stat(
    'CPU media',
    'Núcleos, media del rango. Lo que gasta de forma sostenida.',
    { h: 4, w: 4, x: 0, y: 0 },
    overRange('avg_over_time', CPU_BY_POD),
    CPU_UNIT,
    3
  ),
  stat(
    'CPU p95',
    'Núcleos. El 95 % del tiempo usa esto o menos. Es la referencia para la request de CPU: ' +
      'la CPU se reparte, así que un pico por encima solo va más lento, no rompe.',
    { h: 4, w: 4, x: 4, y: 0 },
    p95(CPU_BY_POD),
    CPU_UNIT,
    3
  ),
  stat(
    'CPU máxima',
    'Núcleos, el pico más alto del rango (medido en ventanas de 5 minutos).',
    { h: 4, w: 4, x: 8, y: 0 },
    overRange('max_over_time', CPU_BY_POD),
    CPU_UNIT,
    3
  ),
  stat(
    'RAM media',
    'Working set, media del rango.',
    { h: 4, w: 4, x: 12, y: 0 },
    overRange('avg_over_time', RAM_BY_POD),
    RAM_UNIT,
    0
  ),
  stat(
    'RAM p95',
    'Working set. El 95 % del tiempo usa esto o menos. Referencia para la request de memoria.',
    { h: 4, w: 4, x: 16, y: 0 },
    p95(RAM_BY_POD),
    RAM_UNIT,
    0
  ),
  stat(
    'RAM máxima',
    'Working set, el pico más alto del rango. Es la que manda para el límite: la memoria no se ' +
      'reparte como la CPU, y si el pod pasa de su límite muere por OOM. Deja margen por encima.',
    { h: 4, w: 4, x: 20, y: 0 },
    overRange('max_over_time', RAM_BY_POD),
    RAM_UNIT,
    0
  ),

  // --- En el tiempo ------------------------------------------------------------
  series(
    'CPU por pod',
    'Núcleos en uso, por pod. La leyenda da la media y el máximo de cada uno.',
    { h: 9, w: 12, x: 0, y: 4 },
    CPU_BY_POD,
    CPU_UNIT
  ),
  series(
    'RAM por pod',
    'Working set, por pod. Una línea que sube y no baja nunca apunta a una fuga de memoria.',
    { h: 9, w: 12, x: 12, y: 4 },
    RAM_BY_POD,
    RAM_UNIT
  ),

  // --- Disco: una tabla, una fila por volumen del servicio ----------------------
  // Una tabla y no una fila repetida de paneles: probado en 13.1.1, una fila repetida
  // por una variable sin valores no desaparece, se pinta una vez con los paneles vacios.
  // La tabla, en un servicio sin volumen, dice que no tiene, que es un dato cierto.
  panel(
    'table',
    'Disco',
    'Volúmenes del servicio, asociados por nombre (<servicio>-pvc o <servicio>-data). Días hasta ' +
      'llenarse: al ritmo al que ha crecido en el rango elegido; «No crece» si no ha crecido.',
    { h: 5, w: 24, x: 0, y: 13 },
    [
      target(USED, '', { instant: true, format: 'table' }),
      target(CAPACITY, '', { instant: true, format: 'table' }),
      target(`${USED} / ${CAPACITY}`, '', { instant: true, format: 'table' }),
      target(
        // Crecimiento por dia segun la pendiente del rango; solo si es positivo.
        `(${CAPACITY} - ${USED}) / ((deriv(${USED}[$__range:5m]) * 86400) > 0)`,
        '',
        { instant: true, format: 'table' }
      ),
    ],
    {
      fieldConfig: {
        defaults: { noValue: 'Sin volumen persistente', custom: { align: 'auto' } },
        overrides: [
          { matcher: { id: 'byName', options: 'Usado' }, properties: [{ id: 'unit', value: 'bytes' }, { id: 'decimals', value: 1 }] },
          { matcher: { id: 'byName', options: 'Capacidad' }, properties: [{ id: 'unit', value: 'bytes' }, { id: 'decimals', value: 1 }] },
          {
            matcher: { id: 'byName', options: 'Ocupado' },
            properties: [
              { id: 'unit', value: 'percentunit' },
              { id: 'decimals', value: 1 },
              { id: 'min', value: 0 },
              { id: 'max', value: 1 },
              { id: 'custom.cellOptions', value: { type: 'gauge', mode: 'basic' } },
              {
                id: 'thresholds',
                value: {
                  mode: 'absolute',
                  steps: [
                    { color: 'green', value: null },
                    { color: 'yellow', value: 0.8 },
                    { color: 'red', value: 0.9 },
                  ],
                },
              },
            ],
          },
          {
            matcher: { id: 'byName', options: 'Días hasta llenarse' },
            properties: [
              { id: 'decimals', value: 0 },
              { id: 'mappings', value: [{ type: 'special', options: { match: 'null', result: { text: 'No crece' } } }] },
            ],
          },
        ],
      },
      options: { showHeader: true, cellHeight: 'sm' },
      transformations: [
        { id: 'merge', options: {} },
        {
          id: 'organize',
          options: {
            excludeByName: { Time: true },
            indexByName: { persistentvolumeclaim: 0, 'Value #A': 1, 'Value #B': 2, 'Value #C': 3, 'Value #D': 4 },
            renameByName: {
              persistentvolumeclaim: 'Volumen',
              'Value #A': 'Usado',
              'Value #B': 'Capacidad',
              'Value #C': 'Ocupado',
              'Value #D': 'Días hasta llenarse',
            },
          },
        },
      ],
    }
  ),
];

/** Los que tienen pods con métricas: el selector no ofrece nada que vaya a salir vacío. */
const PODS_QUERY = 'label_values(container_memory_working_set_bytes{cluster="$cluster", namespace="$namespace", container!=""}, pod)';

const dashboard = {
  annotations: { list: [] },
  description:
    'Uso real de CPU y RAM de un servicio, para dimensionarlo. Se llega con doble clic en un ' +
    'nodo del mapa, o eligiendo el servicio arriba. Para decidir, mira al menos 7 días.',
  editable: true,
  graphTooltip: 1,
  links: [
    {
      title: 'Mapa de servicio',
      type: 'link',
      icon: 'apps',
      tooltip: 'El mapa filtrado por este servicio',
      url: '/d/servicemap?var-cluster=${cluster}&var-servicio=${servicio}',
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
  tags: ['tecopos', 'servicemap', 'servicio'],
  templating: {
    list: [
      { name: 'datasource', label: 'Prometheus', type: 'datasource', query: 'prometheus', current: {}, hide: 0, refresh: 1 },
      {
        name: 'cluster',
        label: 'Cluster',
        type: 'query',
        datasource: PROM,
        definition: 'label_values(container_memory_working_set_bytes, cluster)',
        query: { query: 'label_values(container_memory_working_set_bytes, cluster)', refId: 'A' },
        refresh: 1,
        sort: 1,
        includeAll: false,
        multi: false,
        current: {},
      },
      {
        name: 'namespace',
        label: 'Namespace',
        type: 'query',
        datasource: PROM,
        definition: 'label_values(container_memory_working_set_bytes{cluster="$cluster", container!=""}, namespace)',
        query: {
          query: 'label_values(container_memory_working_set_bytes{cluster="$cluster", container!=""}, namespace)',
          refId: 'A',
        },
        refresh: 2,
        sort: 1,
        includeAll: false,
        multi: false,
        current: {},
      },
      {
        // Del nombre del pod al del Deployment o StatefulSet, que es el nombre del nodo
        // en el mapa. La regex quita el sufijo que añade Kubernetes.
        name: 'servicio',
        label: 'Servicio',
        type: 'query',
        datasource: PROM,
        definition: PODS_QUERY,
        query: { query: PODS_QUERY, refId: 'A' },
        regex: `/^(.+?)(?:${POD_SUFFIX}|-[0-9]+)$/`,
        refresh: 2,
        sort: 1,
        includeAll: false,
        multi: false,
        current: {},
      },
    ],
  },
  time: { from: 'now-7d', to: 'now' },
  timezone: '',
  title: 'Servicio',
  uid: 'servicemap-servicio',
  version: 1,
};

const out = path.join(__dirname, 'servicio.json');
fs.writeFileSync(out, JSON.stringify(dashboard, null, 2) + '\n');
console.log(`escrito ${out}: ${panels.length} paneles`);
