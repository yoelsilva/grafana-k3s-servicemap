/**
 * DataFrame -> {nodes, edges}. Nucleo puro del panel.
 *
 * REGLA DE ORO (CLAUDE.md §5): este fichero no importa nada de React ni de
 * Grafana UI. Recibe data frames, devuelve nodos y flechas. Aqui no se decide
 * que es una dependencia ni si esta viva: eso ya viene resuelto del mapper.
 */
import type { DataFrame, Field } from '@grafana/data';

import { DependencyRow, Graph, GraphEdge, GraphNode, ProbeState, SERVICE_KINDS, ServiceKind } from '../types';

/** Etiquetas que el mapper tiene que emitir si o si. */
const REQUIRED_LABELS = ['src', 'src_id', 'dst', 'dst_id', 'dst_port'] as const;

const MAPPER_HINT = 'Revisa que `dependencias-mapper` sea >= 0.2.0.';

/**
 * Lee el valor de un campo en una fila. En @grafana/data 13 `field.values` es
 * un array normal; el `Vector` con `.get()` de las versiones viejas ya no
 * existe y no se contempla (el objetivo es Grafana 13).
 */
function valueAt(field: Field, index: number): unknown {
  return field.values[index];
}

function asText(field: Field | undefined, index: number): string {
  if (!field) {
    return '';
  }
  const raw = valueAt(field, index);
  if (raw === null || raw === undefined) {
    return '';
  }
  return String(raw);
}

/** `externo` llega como la cadena "true", pero se aceptan booleanos y 1/0. */
function asBoolean(field: Field | undefined, index: number): boolean {
  if (!field) {
    return false;
  }
  const raw = valueAt(field, index);
  if (typeof raw === 'boolean') {
    return raw;
  }
  if (typeof raw === 'number') {
    return raw === 1;
  }
  return String(raw).trim().toLowerCase() === 'true';
}

/** Cualquier cosa que no sea 0, 1 o 2 se trata como "no sondeado". */
function asProbeState(field: Field | undefined, index: number): ProbeState {
  if (!field) {
    return ProbeState.NotProbed;
  }
  const raw = Number(valueAt(field, index));
  if (raw === ProbeState.Down) {
    return ProbeState.Down;
  }
  if (raw === ProbeState.Up) {
    return ProbeState.Up;
  }
  return ProbeState.NotProbed;
}

/**
 * Localiza el campo del valor. Prometheus en formato tabla lo llama "Value",
 * y "Value #A" cuando hay varias queries en el mismo panel.
 */
function findValueField(frame: DataFrame): Field | undefined {
  return frame.fields.find((f) => f.name === 'Value' || f.name.startsWith('Value #'));
}

function indexFields(frame: DataFrame): Map<string, Field> {
  const byName = new Map<string, Field>();
  for (const field of frame.fields) {
    byName.set(field.name, field);
  }
  return byName;
}

/** Convierte un frame en filas del contrato, o devuelve que etiquetas faltan. */
function readFrame(frame: DataFrame): { rows: DependencyRow[]; missing: string[] } {
  const fields = indexFields(frame);
  const missing = REQUIRED_LABELS.filter((label) => !fields.has(label));
  if (missing.length > 0) {
    return { rows: [], missing };
  }

  const valueField = findValueField(frame);
  const rows: DependencyRow[] = [];

  for (let i = 0; i < frame.length; i++) {
    rows.push({
      cluster: asText(fields.get('cluster'), i),
      namespace: asText(fields.get('namespace'), i),
      src: asText(fields.get('src'), i),
      srcId: asText(fields.get('src_id'), i),
      srcType: asText(fields.get('src_tipo'), i),
      dst: asText(fields.get('dst'), i),
      dstId: asText(fields.get('dst_id'), i),
      dstSvc: asText(fields.get('dst_svc'), i),
      dstAddr: asText(fields.get('dst_addr'), i),
      dstPort: asText(fields.get('dst_port'), i),
      envKey: asText(fields.get('clave'), i),
      external: asBoolean(fields.get('externo'), i),
      kind: asText(fields.get('dst_kind'), i),
      state: asProbeState(valueField, i),
    });
  }

  return { rows, missing: [] };
}

/**
 * Puertos que identifican un servicio sin lugar a dudas. Es la red de seguridad
 * para cuando el mapper no emite `dst_kind`: acierta en la mayoria de casos,
 * y donde no llega cae en `other` en vez de inventarse nada.
 *
 * Deliberadamente corto. Un puerto ambiguo (8080, 3000) no entra aqui: vale
 * mas un icono generico que uno que miente.
 */
const KIND_BY_PORT: Readonly<Record<string, ServiceKind>> = {
  '5432': 'postgres',
  '3306': 'mysql',
  '27017': 'mongo',
  '6379': 'redis',
  '9092': 'kafka',
  '9093': 'kafka',
  '5672': 'amqp',
  '15672': 'amqp',
  '1883': 'mqtt',
  '8883': 'mqtt',
  '9000': 'storage',
  '9200': 'search',
  '9300': 'search',
  '25': 'smtp',
  '465': 'smtp',
  '587': 'smtp',
  '80': 'http',
  '443': 'http',
};

/** Rango convencional de gRPC en el cluster. */
function isGrpcPort(port: string): boolean {
  const n = Number(port);
  return Number.isInteger(n) && n >= 50051 && n <= 50099;
}

/**
 * Que clase de cosa es un destino.
 *
 * El mapper manda: si emite `dst_kind` con un valor conocido, se usa tal cual.
 * Si no lo emite, se deduce del puerto. Ver CLAUDE.md §2.
 */
export function resolveKind(rawKind: string, port: string): ServiceKind {
  const declared = rawKind.trim().toLowerCase();
  if ((SERVICE_KINDS as readonly string[]).includes(declared)) {
    return declared as ServiceKind;
  }
  if (KIND_BY_PORT[port]) {
    return KIND_BY_PORT[port];
  }
  if (isGrpcPort(port)) {
    return 'grpc';
  }
  return 'other';
}

/**
 * Con varios clusteres seleccionados el mismo `dst_id` puede existir en mas de
 * uno, asi que el id de nodo se compone (CLAUDE.md §2). Con uno solo se deja
 * limpio para que los data links sigan siendo legibles.
 */
function nodeIdFor(rawId: string, cluster: string, compose: boolean): string {
  if (compose && cluster !== '') {
    return `${cluster}/${rawId}`;
  }
  return rawId;
}

interface NodeAccumulator extends GraphNode {
  /** Un nodo que aparece como origen es un workload nuestro, nunca externo. */
  seenAsSource: boolean;
  /** La clase vino de `dst_kind`, no del puerto. No se pisa con una deducida. */
  kindFromMapper: boolean;
}

export function buildGraph(series: DataFrame[]): Graph {
  const rows: DependencyRow[] = [];
  const warnings: string[] = [];
  const missingLabels = new Set<string>();
  let rowCount = 0;

  for (const frame of series) {
    rowCount += frame.length;
    const { rows: frameRows, missing } = readFrame(frame);
    missing.forEach((label) => missingLabels.add(label));
    rows.push(...frameRows);
  }

  if (missingLabels.size > 0) {
    warnings.push(`Faltan etiquetas en los datos: ${[...missingLabels].sort().join(', ')}. ${MAPPER_HINT}`);
  }

  const clusters = new Set(rows.map((row) => row.cluster).filter((cluster) => cluster !== ''));
  const composeIds = clusters.size > 1;

  const nodes = new Map<string, NodeAccumulator>();
  const edges: GraphEdge[] = [];
  const usedEdgeIds = new Set<string>();
  let incomplete = 0;

  const touchNode = (id: string, label: string, cluster: string, asSource: boolean): NodeAccumulator => {
    let node = nodes.get(id);
    if (!node) {
      node = {
        id,
        label: label === '' ? id : label,
        cluster,
        external: false,
        incoming: 0,
        outgoing: 0,
        incomingDown: 0,
        kind: 'other',
        kindFromMapper: false,
        seenAsSource: false,
      };
      nodes.set(id, node);
    }
    // El nombre del workload gana al del destino: el destino puede ser un alias
    // o un host, y el mismo servicio aparece de las dos formas.
    if (asSource && label !== '') {
      node.label = label;
      node.seenAsSource = true;
    }
    return node;
  };

  for (const row of rows) {
    if (row.srcId === '' || row.dstId === '') {
      incomplete++;
      continue;
    }

    const sourceId = nodeIdFor(row.srcId, row.cluster, composeIds);
    const targetId = nodeIdFor(row.dstId, row.cluster, composeIds);

    const source = touchNode(sourceId, row.src, row.cluster, true);
    const target = touchNode(targetId, row.dst, row.cluster, false);

    source.outgoing++;
    target.incoming++;
    if (row.state === ProbeState.Down) {
      target.incomingDown++;
    }
    if (row.external) {
      target.external = true;
    }

    // La clase que declara el mapper gana siempre y no se pisa. La deducida del
    // puerto solo rellena el hueco: un nodo con dos puertos (9092 y 9000) se
    // queda con el primero que lo identifique.
    const declaredByMapper = (SERVICE_KINDS as readonly string[]).includes(row.kind.trim().toLowerCase());
    if (declaredByMapper) {
      target.kind = resolveKind(row.kind, row.dstPort);
      target.kindFromMapper = true;
    } else if (!target.kindFromMapper && target.kind === 'other') {
      target.kind = resolveKind('', row.dstPort);
    }

    // Una flecha por fila: dos puertos distintos entre los mismos nodos son dos
    // flechas. El sufijo solo aparece si el mapper repitiese una fila identica.
    let edgeId = `${sourceId}->${targetId}:${row.dstPort}`;
    if (usedEdgeIds.has(edgeId)) {
      edgeId = `${edgeId}#${edges.length}`;
    }
    usedEdgeIds.add(edgeId);

    edges.push({
      id: edgeId,
      source: sourceId,
      target: targetId,
      port: row.dstPort,
      envKey: row.envKey,
      dstSvc: row.dstSvc,
      dstAddr: row.dstAddr,
      state: row.state,
    });
  }

  if (incomplete > 0) {
    warnings.push(`${incomplete} fila(s) sin src_id o dst_id, descartadas. ${MAPPER_HINT}`);
  }

  const graphNodes: GraphNode[] = [...nodes.values()].map(({ seenAsSource, kindFromMapper, ...node }) => ({
    ...node,
    external: node.external && !seenAsSource,
  }));

  return { nodes: graphNodes, edges, warnings, rowCount };
}
