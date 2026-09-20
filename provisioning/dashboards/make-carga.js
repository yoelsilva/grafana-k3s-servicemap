/**
 * Genera `dashboard-carga.json`: un grafo del tamano de un cluster real
 * (~45 nodos, ~85 flechas) para ver como aguanta el layout.
 *
 * El dashboard de 30 filas sirve para comprobar que los colores y los estados
 * salen bien; este sirve para lo otro, que es si el mapa se puede leer cuando
 * hay de verdad. Son problemas distintos y por eso son dos dashboards.
 *
 * Todo inventado: nombres genericos y direcciones de documentacion (el repo es
 * publico). Ver CLAUDE.md §10.
 */
const fs = require('fs');
const path = require('path');

const CLUSTER = 'production';
const NS = 'platform';

/** `n_` + no alfanumerico a `_`, igual que hace el mapper. */
const idOf = (name) => 'n_' + name.replace(/[^A-Za-z0-9_]/g, '_');

const rows = [];
function edge(src, dst, port, key, { external = false, value = 1, svc = null, addr = null, type = 'deployment' } = {}) {
  rows.push({
    cluster: CLUSTER,
    namespace: NS,
    src,
    src_id: idOf(src),
    src_tipo: type,
    dst,
    dst_id: idOf(dst),
    dst_svc: external ? '' : (svc ?? dst),
    dst_addr: addr ?? (external ? '10.0.0.50' : (svc ?? dst)),
    dst_port: String(port),
    clave: key,
    externo: external ? 'true' : 'false',
    Value: value,
  });
}

// --- Capa 1: entradas ---------------------------------------------------
const FRONTS = ['web-portal', 'admin-web', 'mobile-bff', 'partner-api'];
FRONTS.forEach((f) => edge(f, 'api-gateway', 8080, 'GATEWAY_URL', { svc: 'api-gateway-svc' }));

// --- Capa 2: el gateway reparte -----------------------------------------
const SERVICES = [
  'auth-service',
  'core-service',
  'media-service',
  'notify-service',
  'billing-service',
  'tickets-service',
  'maps-service',
  'search-service',
  'reports-service',
  'inventory-service',
  'orders-service',
  'audit-service',
];
SERVICES.forEach((s, i) =>
  edge('api-gateway', s, 50051 + i, s.replace(/-/g, '_').toUpperCase() + '_URL', { svc: `${s}-svc-grpc` })
);

// --- Capa 3: los servicios hablan entre ellos ---------------------------
const CALLS = [
  ['core-service', 'auth-service'],
  ['core-service', 'billing-service'],
  ['core-service', 'audit-service'],
  ['orders-service', 'core-service'],
  ['orders-service', 'inventory-service'],
  ['orders-service', 'billing-service'],
  ['tickets-service', 'core-service'],
  ['tickets-service', 'media-service'],
  ['notify-service', 'core-service'],
  ['reports-service', 'core-service'],
  ['reports-service', 'search-service'],
  ['billing-service', 'audit-service'],
  ['inventory-service', 'search-service'],
  ['maps-service', 'core-service'],
];
CALLS.forEach(([a, b]) => edge(a, b, 50053, b.replace(/-/g, '_').toUpperCase() + '_URL', { svc: `${b}-svc-grpc` }));

// --- Capa 4: cada servicio con su Redis ---------------------------------
['core-service', 'auth-service', 'notify-service', 'maps-service', 'search-service', 'orders-service'].forEach((s) =>
  edge(s, `redis-${s.replace('-service', '')}`, 6379, 'REDIS_URL')
);

// --- Capa 5: almacenes compartidos, externos ----------------------------
const DB = 'postgres-main';
['core-service', 'auth-service', 'billing-service', 'orders-service', 'inventory-service', 'reports-service'].forEach(
  (s) => edge(s, DB, 5432, s.replace(/-/g, '_').toUpperCase() + '_DATABASE_URL', { external: true, addr: '10.0.0.9' })
);
['core-service', 'notify-service', 'audit-service', 'orders-service'].forEach((s) =>
  edge(s, 'kafka-broker', 9092, 'KAFKA_BROKERS', { external: true, addr: '10.0.0.14', value: 0 })
);
['media-service', 'reports-service'].forEach((s) =>
  edge(s, 'object-storage', 9000, 'S3_ENDPOINT', { external: true, addr: '10.0.0.15' })
);
edge('search-service', 'opensearch', 9200, 'SEARCH_URL', { external: true, addr: '10.0.0.16' });
edge('maps-service', 'mqtt-broker', 1883, 'POSITIONS_MQTT_URL', { external: true, addr: '10.0.0.17', value: 0 });
edge('maps-service', 'routing-svc', 5000, 'ROUTING_BASE_URL');
edge('notify-service', 'mail.example.com', 587, 'SMTP_HOST', { external: true, addr: 'mail.example.com' });
edge('billing-service', 'payments-provider', 443, 'PAYMENTS_API', { external: true, addr: '203.0.113.13', value: 0 });
edge('tickets-service', 'community.example.com', 8004, 'COMMUNITY_URL', {
  external: true,
  addr: 'community.example.com',
  value: 2,
});
edge('audit-service', 'siem-collector', 514, 'SIEM_URL', { external: true, addr: '203.0.113.20', value: 2 });

// --- Capa 6: workers ----------------------------------------------------
['worker-exports', 'worker-imports', 'cron-runner'].forEach((w) => {
  edge(w, 'core-service', 50053, 'CORE_SERVICE_URL', { type: 'statefulset', svc: 'core-service-svc-grpc' });
  edge(w, DB, 5432, 'DATABASE_URL', { external: true, addr: '10.0.0.9', type: 'statefulset' });
});

const COLS = [
  'cluster',
  'namespace',
  'src',
  'src_id',
  'src_tipo',
  'dst',
  'dst_id',
  'dst_svc',
  'dst_addr',
  'dst_port',
  'clave',
  'externo',
  'Value',
];
const CSV = [COLS.join(',')].concat(rows.map((r) => COLS.map((c) => r[c]).join(','))).join('\n');

const DATASOURCE = { type: 'grafana-testdata-datasource', uid: 'trlxrdZVk' };
const target = { refId: 'A', datasource: DATASOURCE, scenarioId: 'csv_content', csvContent: CSV };

const dashboard = {
  annotations: { list: [] },
  editable: true,
  graphTooltip: 0,
  links: [],
  panels: [
    {
      id: 1,
      type: 'k3s-servicemap-panel',
      title: '',
      description: 'Grafo del tamano de un cluster real. Datos inventados.',
      datasource: DATASOURCE,
      gridPos: { h: 24, w: 24, x: 0, y: 0 },
      options: { direction: 'LR' },
      targets: [target],
    },
  ],
  refresh: '',
  schemaVersion: 39,
  tags: ['servicemap', 'desarrollo', 'carga'],
  templating: { list: [] },
  time: { from: 'now-6h', to: 'now' },
  timezone: '',
  title: 'Mapa de servicio — carga',
  uid: 'servicemap-carga',
  version: 1,
};

const out = path.join(__dirname, 'dashboard-carga.json');
fs.writeFileSync(out, JSON.stringify(dashboard, null, 2) + '\n');

const nodes = new Set();
rows.forEach((r) => {
  nodes.add(r.src_id);
  nodes.add(r.dst_id);
});
console.log(`escrito ${out}: ${rows.length} flechas, ${nodes.size} nodos`);
