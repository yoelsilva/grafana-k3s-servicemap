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
 *   `persistentvolumeclaim`, pero sin el pod que monta el volumen. Qué workload monta cada
 *   volumen lo dice el mapper desde la 0.8.0 (`dependencia_volumen`), leyendo el spec: se
 *   cruzan por `(namespace, persistentvolumeclaim)`. Antes se adivinaba por el nombre, y
 *   fallaba con los volúmenes que no se llaman como su servicio.
 *
 * - Logs: Loki, con `cluster`, `namespace`, `pod` y `container` (comprobado el 2026-09-28).
 *   Se filtran por `pod` con la misma expresión que las métricas; `app` no sirve, porque no
 *   siempre coincide con el nombre del servicio.
 *
 * Se agrupa por POD, nunca por contenedor: dos Deployments distintos pueden tener un
 * contenedor con el mismo nombre (pasa en producción), y agrupar por contenedor los
 * sumaría como si fueran uno.
 */
const fs = require('fs');
const path = require('path');

const PROM = { type: 'prometheus', uid: '${datasource}' };
const LOKI = { type: 'loki', uid: '${loki}' };

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

/**
 * En cada instante, lo que usa el pod que más usa. Una sola serie por servicio, no una
 * por pod: cada redespliegue crea pods con otro nombre, y por pod una semana con un
 * despliegue salía partida en dos. Y se dimensiona por pod: el que más pide marca el mínimo.
 */
/** Los mismos pods, para Loki: allí no hay cAdvisor ni sus contenedores vacíos. */
const LOG_SEL = `cluster="$cluster", namespace="$namespace", pod=~"${PODS}"`;

const CPU = `max(sum by (pod) (rate(container_cpu_usage_seconds_total{${SEL}}[5m])))`;
const RAM = `max(sum by (pod) (container_memory_working_set_bytes{${SEL}}))`;

/** Una cifra del rango elegido. La subconsulta muestrea cada 5 minutos: ~2 000 puntos en 7 días. */
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

const series = (title, description, gridPos, expr, unit, legend) =>
  panel('timeseries', title, description, gridPos, [target(expr, legend)], {
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

/**
 * Los volúmenes que monta el servicio, según su spec (mapper >= 0.8.0). `and on` se queda
 * con los del kubelet que el mapper atribuye a este workload, sin multiplicar nada: un
 * volumen compartido por dos servicios sale en el detalle de los dos, pero una sola vez en
 * cada uno.
 */
const OWNED = 'dependencia_volumen{cluster="$cluster", namespace="$namespace", workload="$servicio"}';
const VOL = 'cluster="$cluster", namespace="$namespace"';
// Un volumen puede aparecer en varias series (una por nodo que lo reporta): `max`, no `sum`.
// Entre paréntesis siempre: en PromQL `/` y `-` van antes que `and`, así que sin ellos
// `usado / capacidad` dividiría la métrica del mapper, y un `[rango]` detrás se aplicaría
// solo a su última parte.
const volumeStat = (metric) =>
  `(max by (persistentvolumeclaim) (${metric}{${VOL}}) and on (persistentvolumeclaim) ${OWNED})`;
const USED = volumeStat('kubelet_volume_stats_used_bytes');
const CAPACITY = volumeStat('kubelet_volume_stats_capacity_bytes');

const CPU_UNIT = 'none';
const RAM_UNIT = 'bytes';

const panels = [
  // --- Para dimensionar: seis cifras del rango elegido ------------------------
  stat(
    'CPU media',
    'Núcleos, media del rango. Lo que gasta de forma sostenida.',
    { h: 4, w: 4, x: 0, y: 0 },
    overRange('avg_over_time', CPU),
    CPU_UNIT,
    3
  ),
  stat(
    'CPU p95',
    'Núcleos. El 95 % del tiempo usa esto o menos. Es la referencia para la request de CPU: ' +
      'la CPU se reparte, así que un pico por encima solo va más lento, no rompe.',
    { h: 4, w: 4, x: 4, y: 0 },
    p95(CPU),
    CPU_UNIT,
    3
  ),
  stat(
    'CPU máxima',
    'Núcleos, el pico más alto del rango (medido en ventanas de 5 minutos).',
    { h: 4, w: 4, x: 8, y: 0 },
    overRange('max_over_time', CPU),
    CPU_UNIT,
    3
  ),
  stat(
    'RAM media',
    'Working set, media del rango.',
    { h: 4, w: 4, x: 12, y: 0 },
    overRange('avg_over_time', RAM),
    RAM_UNIT,
    0
  ),
  stat(
    'RAM p95',
    'Working set. El 95 % del tiempo usa esto o menos. Referencia para la request de memoria.',
    { h: 4, w: 4, x: 16, y: 0 },
    p95(RAM),
    RAM_UNIT,
    0
  ),
  stat(
    'RAM máxima',
    'Working set, el pico más alto del rango. Es la que manda para el límite: la memoria no se ' +
      'reparte como la CPU, y si el pod pasa de su límite muere por OOM. Deja margen por encima.',
    { h: 4, w: 4, x: 20, y: 0 },
    overRange('max_over_time', RAM),
    RAM_UNIT,
    0
  ),

  // --- En el tiempo ------------------------------------------------------------
  series(
    'CPU',
    'Núcleos en uso por el pod que más usa en cada momento. Una sola línea aunque el servicio se ' +
      'haya redesplegado. La leyenda da la media y el máximo.',
    { h: 9, w: 12, x: 0, y: 4 },
    CPU,
    CPU_UNIT,
    'CPU'
  ),
  series(
    'RAM',
    'Working set del pod que más usa en cada momento. Una línea que sube y no baja nunca apunta a ' +
      'una fuga de memoria.',
    { h: 9, w: 12, x: 12, y: 4 },
    RAM,
    RAM_UNIT,
    'RAM'
  ),

  // --- Disco: una tabla, una fila por volumen del servicio ----------------------
  // Una tabla y no una fila repetida de paneles: probado en 13.1.1, una fila repetida
  // por una variable sin valores no desaparece, se pinta una vez con los paneles vacios.
  // La tabla, en un servicio sin volumen, dice que no tiene, que es un dato cierto.
  panel(
    'table',
    'Disco',
    'Volúmenes que monta el servicio, según su spec (lo dice el mapper). Días hasta ' +
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

  // --- Logs --------------------------------------------------------------------------
  {
    id: nextId++,
    type: 'logs',
    title: 'Logs',
    description:
      'Los logs de sus pods, los más nuevos arriba. El cuadro «Buscar en logs» de arriba filtra por texto o ' +
      'expresión regular, sin distinguir mayúsculas.',
    datasource: LOKI,
    gridPos: { h: 14, w: 24, x: 0, y: 18 },
    targets: [{ refId: 'A', datasource: LOKI, expr: `{${LOG_SEL}} |~ "(?i)$buscar"` }],
    options: {
      showTime: true,
      wrapLogMessage: true,
      prettifyLogMessage: false,
      enableLogDetails: true,
      sortOrder: 'Descending',
      dedupStrategy: 'none',
    },
  },
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
      { name: 'loki', label: 'Loki', type: 'datasource', query: 'loki', current: {}, hide: 0, refresh: 1 },
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
      {
        name: 'buscar',
        label: 'Buscar en logs',
        type: 'textbox',
        query: '',
        current: { text: '', value: '' },
        hide: 0,
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
