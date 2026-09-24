/**
 * Genera `servicio.json`: el dashboard de detalle al que lleva el doble clic en un
 * nodo del mapa. Uno para todos los servicios del clúster, elegido por selector.
 *
 *   node dashboards/make-servicio.js
 *
 * Por que un generador y no el JSON a mano: la expresion que casa los pods de un
 * workload se repite en una docena de consultas, y tiene que ser la misma en todas.
 *
 * De donde sale cada cosa (ninguna la calcula el plugin, ver CLAUDE.md §1):
 * - Recursos (CPU, memoria, red, throttling): cAdvisor, que Alloy manda al
 *   Prometheus central con `cluster`, `namespace`, `pod` y `container`.
 * - Replicas, reinicios y motivos de terminacion: kube-state-metrics. Si en el
 *   Prometheus central no llega con la etiqueta `cluster` del clúster de trabajo,
 *   esos paneles salen vacios; los de cAdvisor no dependen de el.
 * - Logs: Loki, con las mismas etiquetas que pone Alloy.
 * - Conexiones: la propia metrica `dependencia` del mapper.
 */
const fs = require('fs');
const path = require('path');

const PROM = { type: 'prometheus', uid: '${datasource}' };
const LOKI = { type: 'loki', uid: '${loki}' };

/**
 * Los pods de un Deployment se llaman `<nombre>-<hash del ReplicaSet>-<5 caracteres>`
 * y los de un StatefulSet `<nombre>-<ordinal>`. Prometheus y Loki anclan las regex
 * por los dos extremos, asi que `core` no casa con los pods de `core-service`.
 *
 * Supone que el nombre del nodo del mapa es el del workload, que es lo que hace el
 * mapper salvo que alguien le haya puesto un alias en su ConfigMap.
 */
const PODS = '$servicio-[a-z0-9]{5,10}-[a-z0-9]{5}|$servicio-[0-9]+';
const SEL = `cluster="$cluster", namespace="$namespace", pod=~"${PODS}"`;
/** cAdvisor repite cada serie para el cgroup del pod entero (sin container) y el "POD". */
const CONTAINERS = `${SEL}, container!="", container!="POD"`;

let nextId = 1;
/** Una consulta a Prometheus. El refId lo pone `panel`, por orden. */
const prom = (expr, legendFormat = '', extra = {}) => ({
  datasource: PROM,
  expr,
  legendFormat,
  ...extra,
});

function panel(type, title, description, gridPos, targets, extra = {}) {
  return {
    id: nextId++,
    type,
    title,
    description,
    datasource: targets[0]?.datasource ?? PROM,
    gridPos,
    targets: targets.map((t, i) => ({ ...t, refId: String.fromCharCode(65 + i) })),
    ...extra,
  };
}

const stat = (title, description, gridPos, targets, { unit = 'short', thresholds, decimals } = {}) =>
  panel('stat', title, description, gridPos, targets, {
    fieldConfig: {
      defaults: {
        unit,
        ...(decimals !== undefined ? { decimals } : {}),
        color: { mode: 'thresholds' },
        thresholds: {
          mode: 'absolute',
          steps: thresholds ?? [{ color: 'text', value: null }],
        },
      },
      overrides: [],
    },
    options: {
      reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
      colorMode: 'value',
      graphMode: 'none',
      textMode: 'auto',
      justifyMode: 'auto',
      orientation: 'auto',
    },
  });

const series = (title, description, gridPos, targets, { unit = 'short', overrides = [] } = {}) =>
  panel('timeseries', title, description, gridPos, targets, {
    fieldConfig: {
      defaults: {
        unit,
        custom: { drawStyle: 'line', lineWidth: 1, fillOpacity: 10, showPoints: 'never', spanNulls: true },
      },
      overrides,
    },
    options: {
      legend: { displayMode: 'list', placement: 'bottom', showLegend: true },
      tooltip: { mode: 'multi', sort: 'desc' },
    },
  });

/** Una serie `limite` en rojo discontinuo, para leer el uso contra el techo. */
const limitOverride = {
  matcher: { id: 'byName', options: 'límite' },
  properties: [
    { id: 'color', value: { mode: 'fixed', fixedColor: 'red' } },
    { id: 'custom.lineStyle', value: { fill: 'dash', dash: [10, 10] } },
    { id: 'custom.fillOpacity', value: 0 },
  ],
};

const RED_ABOVE_ZERO = [
  { color: 'green', value: null },
  { color: 'red', value: 1 },
];

const panels = [
  // --- Estado de un vistazo --------------------------------------------------
  stat(
    'Pods',
    'Pods del servicio con métricas de cAdvisor ahora mismo.',
    { h: 4, w: 3, x: 0, y: 0 },
    [prom(`count(count by (pod) (container_memory_working_set_bytes{${CONTAINERS}}))`)],
    { thresholds: [{ color: 'red', value: null }, { color: 'green', value: 1 }] }
  ),
  stat(
    'Réplicas listas',
    'Listas y deseadas, de kube-state-metrics. Vale para Deployments y StatefulSets.',
    { h: 4, w: 4, x: 3, y: 0 },
    [
      prom(
        `sum(kube_deployment_status_replicas_available{cluster="$cluster", namespace="$namespace", deployment="$servicio"}) or sum(kube_statefulset_status_replicas_ready{cluster="$cluster", namespace="$namespace", statefulset="$servicio"})`,
        'listas',
        { instant: true }
      ),
      prom(
        `sum(kube_deployment_spec_replicas{cluster="$cluster", namespace="$namespace", deployment="$servicio"}) or sum(kube_statefulset_replicas{cluster="$cluster", namespace="$namespace", statefulset="$servicio"})`,
        'deseadas',
        { instant: true }
      ),
    ]
  ),
  stat(
    'Reinicios',
    'Reinicios de contenedores en el rango de tiempo elegido.',
    { h: 4, w: 3, x: 7, y: 0 },
    [prom(`sum(increase(kube_pod_container_status_restarts_total{${SEL}}[$__range])) or vector(0)`, '', { instant: true })],
    { thresholds: RED_ABOVE_ZERO, decimals: 0 }
  ),
  stat(
    'CPU',
    'Núcleos en uso, sumando todos los pods.',
    { h: 4, w: 3, x: 10, y: 0 },
    [prom(`sum(rate(container_cpu_usage_seconds_total{${CONTAINERS}}[$__rate_interval]))`)],
    { unit: 'none', decimals: 3 }
  ),
  stat(
    'Memoria',
    'Working set, sumando todos los pods. Es la que cuenta para el OOM killer.',
    { h: 4, w: 3, x: 13, y: 0 },
    [prom(`sum(container_memory_working_set_bytes{${CONTAINERS}})`)],
    { unit: 'bytes' }
  ),
  stat(
    'Dependencias caídas',
    'Flechas declaradas que salen de este servicio y cuya sonda falla. Del mapper.',
    { h: 4, w: 4, x: 16, y: 0 },
    [prom(`count(dependencia{cluster="$cluster", src="$servicio"} == 0) or vector(0)`, '', { instant: true })],
    { thresholds: RED_ABOVE_ZERO, decimals: 0 }
  ),
  stat(
    'Llamadores sin llegar',
    'Flechas declaradas que apuntan a este servicio y cuya sonda falla. Del mapper.',
    { h: 4, w: 4, x: 20, y: 0 },
    [prom(`count(dependencia{cluster="$cluster", dst="$servicio"} == 0) or vector(0)`, '', { instant: true })],
    { thresholds: RED_ABOVE_ZERO, decimals: 0 }
  ),

  // --- Recursos --------------------------------------------------------------
  series(
    'CPU por pod',
    'Núcleos. La línea roja es el límite total, si lo hay.',
    { h: 8, w: 8, x: 0, y: 4 },
    [
      prom(`sum by (pod) (rate(container_cpu_usage_seconds_total{${CONTAINERS}}[$__rate_interval]))`, '{{pod}}'),
      prom(`max(sum by (pod) (kube_pod_container_resource_limits{${SEL}, resource="cpu"}))`, 'límite'),
    ],
    { unit: 'none', overrides: [limitOverride] }
  ),
  series(
    'Memoria por pod',
    'Working set. La línea roja es el límite de un pod: si una serie la toca, el pod muere por OOM.',
    { h: 8, w: 8, x: 8, y: 4 },
    [
      prom(`sum by (pod) (container_memory_working_set_bytes{${CONTAINERS}})`, '{{pod}}'),
      prom(`max(sum by (pod) (kube_pod_container_resource_limits{${SEL}, resource="memory"}))`, 'límite'),
    ],
    { unit: 'bytes', overrides: [limitOverride] }
  ),
  series(
    'Red',
    'Bytes por segundo recibidos y enviados, sumando todos los pods.',
    { h: 8, w: 8, x: 16, y: 4 },
    [
      prom(`sum(rate(container_network_receive_bytes_total{${SEL}}[$__rate_interval]))`, 'recibido'),
      prom(`sum(rate(container_network_transmit_bytes_total{${SEL}}[$__rate_interval]))`, 'enviado'),
    ],
    { unit: 'Bps' }
  ),
  series(
    'CPU estrangulada',
    'Fracción de periodos en que el contenedor quiso más CPU de la que su límite le deja. ' +
      'Por encima del 25 % el servicio va lento aunque la CPU no parezca alta.',
    { h: 8, w: 8, x: 0, y: 12 },
    [
      prom(
        `sum by (pod) (rate(container_cpu_cfs_throttled_periods_total{${CONTAINERS}}[$__rate_interval])) / sum by (pod) (rate(container_cpu_cfs_periods_total{${CONTAINERS}}[$__rate_interval]))`,
        '{{pod}}'
      ),
    ],
    { unit: 'percentunit' }
  ),
  panel(
    'table',
    'Última terminación',
    'Por qué terminó la última vez cada contenedor: OOMKilled, Error, Completed... De kube-state-metrics.',
    { h: 8, w: 8, x: 8, y: 12 },
    [prom(`kube_pod_container_status_last_terminated_reason{${SEL}} == 1`, '', { instant: true, format: 'table' })],
    {
      options: { showHeader: true },
      transformations: [
        {
          id: 'organize',
          options: {
            excludeByName: {},
            includeByName: { pod: true, container: true, reason: true },
            renameByName: { pod: 'Pod', container: 'Contenedor', reason: 'Motivo' },
          },
        },
      ],
    }
  ),
  series(
    'Volumen de logs',
    'Líneas por intervalo, y cuántas parecen errores (error, exception, fatal, panic).',
    { h: 8, w: 8, x: 16, y: 12 },
    [
      { datasource: LOKI, expr: `sum(count_over_time({${SEL}} [$__auto]))`, legendFormat: 'líneas' },
      {
        datasource: LOKI,
        expr: `sum(count_over_time({${SEL}} |~ "(?i)(error|exception|fatal|panic)" [$__auto]))`,
        legendFormat: 'errores',
      },
    ],
    {
      overrides: [
        {
          matcher: { id: 'byName', options: 'errores' },
          properties: [{ id: 'color', value: { mode: 'fixed', fixedColor: 'red' } }],
        },
      ],
    }
  ),

  // --- Logs ------------------------------------------------------------------
  panel(
    'logs',
    'Logs',
    'Todos los pods del servicio. El cuadro «Buscar» de arriba filtra por texto o regex, sin distinguir mayúsculas.',
    { h: 14, w: 24, x: 0, y: 20 },
    [{ datasource: LOKI, expr: `{${SEL}} |~ "(?i)$buscar"` }],
    {
      options: {
        showTime: true,
        wrapLogMessage: true,
        prettifyLogMessage: false,
        enableLogDetails: true,
        sortOrder: 'Descending',
        dedupStrategy: 'none',
      },
    }
  ),

  // --- Lo que dice el mapa ---------------------------------------------------
  panel(
    'table',
    'Conexiones declaradas',
    'Las flechas del mapa que salen de este servicio o llegan a él, con el estado de su sonda.',
    { h: 8, w: 24, x: 0, y: 34 },
    [
      prom(`dependencia{cluster="$cluster", src="$servicio"} or dependencia{cluster="$cluster", dst="$servicio"}`, '', {
        instant: true,
        format: 'table',
      }),
    ],
    {
      options: { showHeader: true },
      fieldConfig: {
        defaults: {},
        overrides: [
          {
            matcher: { id: 'byName', options: 'Sonda' },
            properties: [
              {
                id: 'mappings',
                value: [
                  {
                    type: 'value',
                    options: {
                      0: { text: 'caída', color: 'red', index: 0 },
                      1: { text: 'responde', color: 'green', index: 1 },
                      2: { text: 'sin sondear', color: 'blue', index: 2 },
                    },
                  },
                ],
              },
              { id: 'custom.cellOptions', value: { type: 'color-text' } },
            ],
          },
        ],
      },
      transformations: [
        {
          id: 'organize',
          options: {
            includeByName: { src: true, dst: true, dst_port: true, dst_kind: true, clave: true, externo: true, Value: true },
            indexByName: { src: 0, dst: 1, dst_port: 2, dst_kind: 3, clave: 4, externo: 5, Value: 6 },
            renameByName: {
              src: 'Origen',
              dst: 'Destino',
              dst_port: 'Puerto',
              dst_kind: 'Tipo',
              clave: 'Clave',
              externo: 'Fuera del clúster',
              Value: 'Sonda',
            },
          },
        },
      ],
    }
  ),
];

/** Junta los nombres de dos etiquetas en una sola variable; ver README, «El filtro Servicio». */
const union = (a, b) => `query_result(count by (nombre) (${a} or ${b}))`;
const relabel = (selector, label) => `label_replace(dependencia{${selector}}, "nombre", "$1", "${label}", "(.+)")`;

const queryVar = (name, label, query, extra = {}) => ({
  name,
  label,
  type: 'query',
  datasource: PROM,
  definition: query,
  query: { query, refId: 'A' },
  regex: '/nombre="([^"]+)"/',
  refresh: 2,
  sort: 1,
  includeAll: false,
  multi: false,
  current: {},
  ...extra,
});

const dashboard = {
  annotations: { list: [] },
  description:
    'Detalle de un servicio del mapa: recursos, estado de sus pods, logs y sus conexiones declaradas. ' +
    'Se llega con doble clic en un nodo del mapa, o eligiendo el servicio arriba.',
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
  refresh: '1m',
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
        definition: 'label_values(dependencia, cluster)',
        query: { query: 'label_values(dependencia, cluster)', refId: 'A' },
        refresh: 1,
        sort: 1,
        includeAll: false,
        multi: false,
        current: {},
      },
      // Namespaces con algun nodo del mapa: el de los origenes (`namespace`) y el de los
      // destinos internos (`dst_ns`, mapper >= 0.5.0), que puede ser otro.
      queryVar(
        'namespace',
        'Namespace',
        union(relabel('cluster="$cluster"', 'namespace'), relabel('cluster="$cluster"', 'dst_ns'))
      ),
      // Los nodos del mapa que viven en ese namespace, llamen o solo reciban.
      queryVar(
        'servicio',
        'Servicio',
        union(
          relabel('cluster="$cluster", namespace="$namespace"', 'src'),
          relabel('cluster="$cluster", dst_ns="$namespace"', 'dst')
        )
      ),
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
  time: { from: 'now-1h', to: 'now' },
  timezone: '',
  title: 'Servicio',
  uid: 'servicemap-servicio',
  version: 1,
};

const out = path.join(__dirname, 'servicio.json');
fs.writeFileSync(out, JSON.stringify(dashboard, null, 2) + '\n');
console.log(`escrito ${out}: ${panels.length} paneles`);
