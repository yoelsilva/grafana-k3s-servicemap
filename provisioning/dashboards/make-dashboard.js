/**
 * Genera `dashboard.json` con el CSV de desarrollo embebido.
 *
 * El CSV vive aqui y en ningun otro sitio: si estuviera tambien suelto en disco
 * las dos copias acabarian divergiendo. Para cambiar los datos de prueba, se
 * edita CSV y se ejecuta `node provisioning/dashboards/make-dashboard.js`.
 *
 * Reproduce el contrato de CLAUDE.md §2 con los tres valores de sonda.
 *
 * DATOS INVENTADOS A PROPOSITO. Este repo es publico, asi que el ejemplo usa
 * nombres de servicio genericos y direcciones de documentacion (10.0.0.x,
 * 203.0.113.x, .example.com). El mapa real de que servicio vive en que IP no
 * entra aqui: se ve en Grafana contra el Prometheus central.
 */
const fs = require('fs');
const path = require('path');

const CSV = `cluster,namespace,src,src_id,src_tipo,dst,dst_id,dst_svc,dst_addr,dst_port,clave,externo,Value
production,platform,api-gateway,n_api_gateway,deployment,media-service,n_media_service,media-svc-grpc,media-svc-grpc,50072,MEDIA_SERVICE_URL,false,1
production,platform,api-gateway,n_api_gateway,deployment,core-service,n_core_service,core-svc-grpc,core-svc-grpc,50053,CORE_SERVICE_URL,false,1
production,platform,api-gateway,n_api_gateway,deployment,notify-service,n_notify_service,notify-svc-grpc,notify-svc-grpc,50052,NOTIFY_SERVICE_URL,false,1
production,platform,api-gateway,n_api_gateway,deployment,auth-service,n_auth_service,auth-svc-grpc,auth-svc-grpc,50051,SSO_SERVICE_URL,false,1
production,platform,api-gateway,n_api_gateway,deployment,tickets-service,n_tickets_service,tickets-svc-grpc,tickets-svc-grpc,50057,TICKETS_SERVICE_URL,false,1
production,platform,api-gateway,n_api_gateway,deployment,agents-host,n_agents_host,,10.0.0.24,32033,AGENTS_SERVICE_URL,true,1
production,platform,api-gateway,n_api_gateway,deployment,legacy-instance-1,n_legacy_instance_1,,10.0.0.22,50056,LEGACY_AUTH_ROUTING,true,1
production,platform,core-service,n_core_service,deployment,auth-service,n_auth_service,auth-svc-grpc,auth-svc-grpc,50051,IDENTITY_SERVICE_URL,false,1
production,platform,core-service,n_core_service,deployment,billing-service,n_billing_service,billing-svc-grpc,billing-svc-grpc,50052,BILLING_SERVICE_URL,false,1
production,platform,core-service,n_core_service,deployment,redis-core-svc,n_redis_core_svc,redis-core-svc,redis-core-svc,6379,REDIS_HOST,false,1
production,platform,core-service,n_core_service,deployment,events-storage,n_events_storage,,10.0.0.14,9092,KAFKA_BROKERS,true,0
production,platform,core-service,n_core_service,deployment,postgres-main,n_postgres_main,,10.0.0.9,5432,CORE_DATABASE_URL,true,1
production,platform,notify-service,n_notify_service,deployment,core-service,n_core_service,core-svc-grpc,core-svc-grpc,50053,CORE_SERVICE_URL,false,1
production,platform,notify-service,n_notify_service,deployment,redis-notify-svc,n_redis_notify_svc,redis-notify-svc,redis-notify-svc,6379,REDIS_URL,false,1
production,platform,notify-service,n_notify_service,deployment,postgres-main,n_postgres_main,,10.0.0.9,5432,NOTIFY_DATABASE_URL,true,1
production,platform,notify-service,n_notify_service,deployment,events-storage,n_events_storage,,10.0.0.14,9092,NOTIFY_KAFKA_BROKER_URL,true,0
production,platform,notify-service,n_notify_service,deployment,mail.example.com,n_mail_example_com,,mail.example.com,587,NOTIFY_EMAIL_HOST,true,1
production,platform,media-service,n_media_service,deployment,postgres-main,n_postgres_main,,10.0.0.9,5432,DATABASE_URL,true,1
production,platform,media-service,n_media_service,deployment,events-storage,n_events_storage,,10.0.0.14,9000,MINIO_ENDPOINT,true,0
production,platform,billing-service,n_billing_service,deployment,media-service,n_media_service,media-svc,media-svc,50072,MEDIA_GRPC_URL,false,1
production,platform,billing-service,n_billing_service,deployment,payments-provider,n_payments_provider,,203.0.113.13,15000,PAYMENTS_API,true,0
production,platform,maps-service,n_maps_service,deployment,routing-svc,n_routing_svc,routing-svc,routing-svc,5000,ROUTING_BASE_URL,false,1
production,platform,maps-service,n_maps_service,deployment,mqtt-broker (brokers),n_mqtt_broker__brokers_,,mqtt-svc.brokers,1883,POSITIONS_MQTT_URL,true,0
production,platform,maps-service,n_maps_service,deployment,redis-maps-svc,n_redis_maps_svc,redis-maps-svc,redis-maps-svc,6379,REDIS_URL,false,1
production,platform,tickets-service,n_tickets_service,deployment,media-service,n_media_service,media-svc,media-svc,50072,MEDIA_GRPC_URL,false,1
production,platform,tickets-service,n_tickets_service,deployment,core-service,n_core_service,core-svc-grpc,core-svc-grpc,50053,CORE_SERVICE_URL,false,1
production,platform,tickets-service,n_tickets_service,deployment,community.example.com,n_community_example_com,,community.example.com,8004,COMMUNITY_BASE_URL,true,0
production,platform,fuel-web,n_fuel_web,deployment,pdf-svc,n_pdf_svc,pdf-svc,pdf-svc,3100,VITE_PDF_SERVICE_URL,false,1
production,platform,logistics-service,n_logistics_service,statefulset,core-service,n_core_service,core-svc-grpc,core-svc-grpc,50053,LOGISTICS_GRPC_URL,false,1
production,platform,legacy-api,n_legacy_api,deployment,core-service (NodePort),n_core_service__NodePort_,,10.0.0.9,31878,CORE_SERVICE_URL,true,2`;

const DATASOURCE = { type: 'grafana-testdata-datasource', uid: 'trlxrdZVk' };

// Todos los nodos del CSV, origenes y destinos, para que el clic tenga por que
// filtrar. Los datos de TestData no reaccionan al filtro (el CSV es fijo); lo que se
// prueba aqui es que el clic mueve la variable y que el nodo filtrado se marca.
const [header, ...lines] = CSV.trim().split('\n');
const cols = header.split(',');
const NAMES = [
  ...new Set(
    lines.flatMap((line) => {
      const cells = line.split(',');
      return [cells[cols.indexOf('src')], cells[cols.indexOf('dst')]];
    })
  ),
].sort();

const target = {
  refId: 'A',
  datasource: DATASOURCE,
  scenarioId: 'csv_content',
  csvContent: CSV,
};

const dashboard = {
  annotations: { list: [] },
  editable: true,
  fiscalYearStartMonth: 0,
  graphTooltip: 0,
  links: [],
  panels: [
    {
      id: 1,
      type: 'k3s-servicemap-panel',
      title: 'Mapa de dependencias',
      description: 'Datos de desarrollo inventados, no un Prometheus real.',
      datasource: DATASOURCE,
      gridPos: { h: 18, w: 24, x: 0, y: 0 },
      // Clic filtra por `$servicio`; doble clic lleva al dashboard de carga, que
      // existe siempre en desarrollo. En produccion lleva al de detalle del servicio.
      options: {
        direction: 'LR',
        filterVariable: 'servicio',
        nodeLink: '/d/servicemap-carga?var-desde=${nodo.servicio}&from=${__from}&to=${__to}',
      },
      targets: [target],
    },
    {
      id: 2,
      type: 'table',
      title: 'Filas en crudo (contrato §2)',
      datasource: DATASOURCE,
      gridPos: { h: 10, w: 24, x: 0, y: 18 },
      options: {},
      targets: [target],
    },
    {
      // Sirve de dos cosas: enseña el estado vacio de un vistazo, y le da al
      // e2e algo determinista que comprobar sin tocar el selector de datasource.
      id: 3,
      type: 'k3s-servicemap-panel',
      title: 'Estado vacio (sin filas)',
      datasource: DATASOURCE,
      gridPos: { h: 6, w: 24, x: 0, y: 28 },
      options: { direction: 'LR' },
      targets: [{ refId: 'A', datasource: DATASOURCE, scenarioId: 'no_data_points' }],
    },
  ],
  refresh: '',
  schemaVersion: 39,
  tags: ['servicemap', 'desarrollo'],
  templating: {
    list: [
      {
        name: 'cluster',
        label: 'Cluster',
        type: 'custom',
        query: 'production',
        current: { selected: true, text: 'production', value: 'production' },
        options: [{ selected: true, text: 'production', value: 'production' }],
      },
      {
        name: 'servicio',
        label: 'Servicio',
        type: 'custom',
        query: NAMES.join(','),
        includeAll: true,
        allValue: '.*',
        multi: true,
        current: { selected: true, text: ['All'], value: ['$__all'] },
        options: [],
      },
    ],
  },
  time: { from: 'now-6h', to: 'now' },
  timezone: '',
  title: 'Mapa de dependencias',
  uid: 'servicemap-dev',
  version: 1,
};

const out = path.join(__dirname, 'dashboard.json');
fs.writeFileSync(out, JSON.stringify(dashboard, null, 2) + '\n');
console.log(`escrito ${out} (${CSV.split('\n').length - 1} filas)`);
