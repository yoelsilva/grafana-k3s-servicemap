/**
 * Genera `envoy.json`: el dashboard del Gateway, al que lleva el doble clic en él desde el
 * mapa. El Gateway es el cuello de botella: todo lo que entra desde Internet pasa por ahí.
 *
 *   node dashboards/make-envoy.js
 *
 * REGLA: aquí solo entra lo que se ha visto con datos en el Prometheus de producción.
 * Comprobado el 2026-09-28:
 * - CPU y RAM (cAdvisor, vía Alloy) de los pods del namespace del Gateway: las réplicas de
 *   Envoy, el controlador (`envoy-gateway`), cert-manager y external-dns.
 * - Las rutas del Gateway, de la métrica `dependencia` del mapper (`relacion="enruta"`).
 * - Los certificados, del mapper (0.9.0, comprobado el 2026-09-29):
 *   `dependencia_certificado_caduca_segundos{certificado, namespace, gateway, dominios}` y
 *   `dependencia_certificado_listo{certificado, namespace, gateway}` (1 listo, 0 no).
 * - NO llegan: métricas de tráfico de Envoy (`envoy_*`) ni de cert-manager
 *   (`certmanager_*`). El tráfico necesitaría que Alloy recoja las estadísticas de Envoy.
 *
 * - Logs: Loki, con `cluster`, `namespace`, `pod` y `container` (comprobado el 2026-09-28).
 *   Se filtran por `pod` con la misma expresión que las métricas; `app` no sirve, porque no
 *   siempre coincide con el nombre del servicio.
 *
 * Nada de nombres de producción aquí: el Gateway se elige arriba, y sus pods se encuentran
 * por cómo los nombra Envoy Gateway, `envoy-<namespace>-<gateway>-<hash>`.
 */
const fs = require('fs');
const path = require('path');

const PROM = { type: 'prometheus', uid: '${datasource}' };
const LOKI = { type: 'loki', uid: '${loki}' };

/**
 * Los pods de un Gateway: `envoy-<ns>-<gateway>-<hash de 8>-<hash del ReplicaSet>-<5>`.
 * Prometheus ancla la regex por los dos extremos.
 */
const PODS = 'envoy-$gw_ns-$gateway-[a-z0-9]{8}-[a-z0-9]{5,10}-[a-z0-9]{5}';
const SEL = `cluster="$cluster", pod=~"${PODS}", container!="", container!="POD"`;
/** Las réplicas de Envoy, para Loki. Solo su contenedor `envoy`: el `shutdown-manager` no dice nada. */
const LOG_SEL = `cluster="$cluster", pod=~"${PODS}", container="envoy"`;

/** Lo que mantiene el Gateway funcionando. Nombres de contenedor de los charts oficiales. */
const HELPERS = 'envoy-gateway|cert-manager-controller|cert-manager-cainjector|cert-manager-webhook|external-dns';
const HELPERS_SEL = `cluster="$cluster", container=~"${HELPERS}"`;

const CPU_BY_POD = `sum by (pod) (rate(container_cpu_usage_seconds_total{${SEL}}[5m]))`;
const RAM_BY_POD = `sum by (pod) (container_memory_working_set_bytes{${SEL}})`;
/** Para dimensionar, la réplica que más usa en cada instante: marca lo que necesita una. */
const CPU_TOP = `max(${CPU_BY_POD})`;
const RAM_TOP = `max(${RAM_BY_POD})`;

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

/** Los certificados que usa este Gateway, según el mapper. */
const CERT = 'cluster="$cluster", gateway="$gateway"';
const CERT_DAYS = `dependencia_certificado_caduca_segundos{${CERT}} / 86400`;
const CERT_READY = `dependencia_certificado_listo{${CERT}}`;
/** Rojo por debajo de 15 días, ámbar por debajo de 30. */
const DAYS_LEFT = {
  mode: 'absolute',
  steps: [
    { color: 'red', value: null },
    { color: 'yellow', value: 15 },
    { color: 'green', value: 30 },
  ],
};
const READY_MAPPING = [
  {
    type: 'value',
    options: {
      0: { text: 'No se pudo renovar', color: 'red', index: 0 },
      1: { text: 'Listo', color: 'green', index: 1 },
    },
  },
];

/**
 * Los certificados van arriba del todo: uno solo puede sostener toda la entrada del
 * clúster, y si caduca se cae todo a la vez.
 */
const certPanels = [
  stat(
    'Certificado caduca en',
    'Días hasta que caduca el certificado del Gateway que antes caduca. Ámbar por debajo de 30, rojo por ' +
      'debajo de 15. cert-manager lo renueva solo antes de que llegue; si baja de 30, no lo está consiguiendo.',
    { h: 4, w: 4, x: 0, y: 0 },
    `min(${CERT_DAYS})`,
    'none',
    0
  ),
  panel(
    'stat',
    'Renovación',
    'Si cert-manager tiene el certificado listo. «No se pudo renovar» con la caducidad todavía lejos es un fallo ' +
      'de renovación: se ve antes de que caduque.',
    { h: 4, w: 4, x: 4, y: 0 },
    [target(`min(${CERT_READY})`, '', { instant: true })],
    {
      fieldConfig: { defaults: { mappings: READY_MAPPING, color: { mode: 'thresholds' }, thresholds: { mode: 'absolute', steps: [{ color: 'red', value: null }, { color: 'green', value: 1 }] } }, overrides: [] },
      options: {
        reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
        colorMode: 'value',
        graphMode: 'none',
        textMode: 'value',
        justifyMode: 'center',
        orientation: 'auto',
      },
    }
  ),
  panel(
    'table',
    'Certificados',
    'Cada certificado del Gateway con sus dominios, los días que le quedan y si está listo. Del mapper.',
    { h: 4, w: 16, x: 8, y: 0 },
    [
      target(CERT_DAYS, '', { instant: true, format: 'table' }),
      target(CERT_READY, '', { instant: true, format: 'table' }),
    ],
    {
      options: { showHeader: true, cellHeight: 'sm' },
      fieldConfig: {
        defaults: {},
        overrides: [
          { matcher: { id: 'byName', options: 'Certificado' }, properties: [{ id: 'custom.width', value: 150 }] },
          // Con muchos dominios la celda no cabe: se ve entera al pasar por encima.
          { matcher: { id: 'byName', options: 'Dominios' }, properties: [{ id: 'custom.inspect', value: true }] },
          {
            matcher: { id: 'byName', options: 'Días' },
            properties: [
              { id: 'decimals', value: 0 },
              { id: 'custom.width', value: 70 },
              { id: 'custom.cellOptions', value: { type: 'color-text' } },
              { id: 'thresholds', value: DAYS_LEFT },
            ],
          },
          {
            matcher: { id: 'byName', options: 'Estado' },
            properties: [
              { id: 'mappings', value: READY_MAPPING },
              { id: 'custom.width', value: 160 },
              { id: 'custom.cellOptions', value: { type: 'color-text' } },
            ],
          },
        ],
      },
      transformations: [
        // Une las dos consultas por certificado; `dominios` solo viene en la primera.
        { id: 'merge', options: {} },
        {
          id: 'organize',
          options: {
            includeByName: { certificado: true, dominios: true, 'Value #A': true, 'Value #B': true },
            indexByName: { certificado: 0, dominios: 1, 'Value #A': 2, 'Value #B': 3 },
            renameByName: { certificado: 'Certificado', dominios: 'Dominios', 'Value #A': 'Días', 'Value #B': 'Estado' },
          },
        },
      ],
    }
  ),
];
// El umbral del stat de días: se aplica aquí porque `stat` los pone fijos.
certPanels[0].fieldConfig.defaults.color = { mode: 'thresholds' };
certPanels[0].fieldConfig.defaults.thresholds = DAYS_LEFT;

/** Todo lo demás, cuatro filas más abajo para dejar sitio a los certificados. */
const shiftDown = (list, rows) => list.map((p) => ({ ...p, gridPos: { ...p.gridPos, y: p.gridPos.y + rows } }));

const panels = [
  ...certPanels,
  ...shiftDown([
  // --- Para dimensionar Envoy ---------------------------------------------------
  stat('Réplicas', 'Réplicas de Envoy con métricas ahora mismo.', { h: 4, w: 3, x: 0, y: 0 }, `count(${RAM_BY_POD})`, 'short', 0),
  stat('CPU media', 'Núcleos de la réplica que más usa, media del rango.', { h: 4, w: 3, x: 3, y: 0 }, overRange('avg_over_time', CPU_TOP), 'none', 3),
  stat(
    'CPU p95',
    'Núcleos. El 95 % del tiempo la réplica que más usa está en esto o menos: la referencia para la request.',
    { h: 4, w: 3, x: 6, y: 0 },
    p95(CPU_TOP),
    'none',
    3
  ),
  stat('CPU máxima', 'Núcleos, el pico más alto del rango (ventanas de 5 minutos).', { h: 4, w: 3, x: 9, y: 0 }, overRange('max_over_time', CPU_TOP), 'none', 3),
  stat('RAM media', 'Working set de la réplica que más usa, media del rango.', { h: 4, w: 4, x: 12, y: 0 }, overRange('avg_over_time', RAM_TOP), 'bytes', 0),
  stat('RAM p95', 'Working set. Referencia para la request de memoria.', { h: 4, w: 4, x: 16, y: 0 }, p95(RAM_TOP), 'bytes', 0),
  stat(
    'RAM máxima',
    'Working set, el pico más alto del rango. Manda para el límite: si Envoy lo pasa, muere por OOM y se cae la entrada.',
    { h: 4, w: 4, x: 20, y: 0 },
    overRange('max_over_time', RAM_TOP),
    'bytes',
    0
  ),

  // --- En el tiempo, por réplica: si el reparto entre réplicas está equilibrado ---
  series(
    'CPU por réplica',
    'Núcleos de cada réplica de Envoy. Si una va muy por encima de la otra, el reparto no está equilibrado.',
    { h: 9, w: 12, x: 0, y: 4 },
    CPU_BY_POD,
    'none',
    '{{pod}}'
  ),
  series('RAM por réplica', 'Working set de cada réplica de Envoy.', { h: 9, w: 12, x: 12, y: 4 }, RAM_BY_POD, 'bytes', '{{pod}}'),

  // --- Las rutas, del mapper -------------------------------------------------------
  panel(
    'table',
    'Rutas',
    'Lo que enruta el Gateway: cada dominio, a qué servicio va y si ese servicio responde. Del mapper.',
    { h: 8, w: 24, x: 0, y: 13 },
    [target('dependencia{cluster="$cluster", src="$gateway", relacion="enruta"}', '', { instant: true, format: 'table' })],
    {
      options: { showHeader: true, cellHeight: 'sm' },
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
                      0: { text: 'no responde', color: 'red', index: 0 },
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
            includeByName: { hosts: true, dst: true, dst_ns: true, dst_port: true, clave: true, Value: true },
            indexByName: { hosts: 0, dst: 1, dst_ns: 2, dst_port: 3, clave: 4, Value: 5 },
            renameByName: {
              hosts: 'Dominios',
              dst: 'Servicio',
              dst_ns: 'Namespace',
              dst_port: 'Puerto',
              clave: 'Declarada en',
              Value: 'Sonda',
            },
          },
        },
      ],
    }
  ),

  // --- Lo que lo mantiene funcionando ----------------------------------------------
  series(
    'CPU de lo que gestiona el Gateway',
    'El controlador de Envoy Gateway, cert-manager (que renueva los certificados) y external-dns.',
    { h: 8, w: 12, x: 0, y: 21 },
    `sum by (container) (rate(container_cpu_usage_seconds_total{${HELPERS_SEL}}[5m]))`,
    'none',
    '{{container}}'
  ),
  series(
    'RAM de lo que gestiona el Gateway',
    'Working set del controlador, cert-manager y external-dns.',
    { h: 8, w: 12, x: 12, y: 21 },
    `sum by (container) (container_memory_working_set_bytes{${HELPERS_SEL}})`,
    'bytes',
    '{{container}}'
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
    gridPos: { h: 14, w: 24, x: 0, y: 29 },
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
  ], 4),
];

const queryVar = (name, label, query, extra = {}) => ({
  name,
  label,
  type: 'query',
  datasource: PROM,
  definition: query,
  query: { query, refId: 'A' },
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
    'El Gateway: consumo de sus réplicas de Envoy para dimensionarlas, sus rutas y lo que lo gestiona. ' +
    'Se llega con doble clic en el Gateway del mapa. Para decidir, mira al menos 7 días.',
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
  tags: ['tecopos', 'servicemap', 'envoy'],
  templating: {
    list: [
      { name: 'datasource', label: 'Prometheus', type: 'datasource', query: 'prometheus', current: {}, hide: 2, refresh: 1 },
      { name: 'loki', label: 'Loki', type: 'datasource', query: 'loki', current: {}, hide: 2, refresh: 1 },
      queryVar('cluster', 'Cluster', 'label_values(dependencia, cluster)', { refresh: 1 }),
      queryVar('gateway', 'Gateway', 'label_values(dependencia{cluster="$cluster", src_tipo="gateway"}, src)'),
      // El namespace del Gateway: en sus filas, `namespace` es el suyo (comprobado con el mapper).
      queryVar('gw_ns', 'Namespace', 'label_values(dependencia{cluster="$cluster", src_tipo="gateway", src="$gateway"}, namespace)', {
        hide: 2,
      }),
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
  title: 'Gateway',
  uid: 'servicemap-envoy',
  version: 1,
};

const out = path.join(__dirname, 'envoy.json');
fs.writeFileSync(out, JSON.stringify(dashboard, null, 2) + '\n');
console.log(`escrito ${out}: ${panels.length} paneles`);
