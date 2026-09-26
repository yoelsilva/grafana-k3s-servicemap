/**
 * La vista central del mapa: el árbol desde las entradas del clúster hasta el segundo
 * nivel. Puro: no sabe de React ni de cytoscape.
 *
 * El mapa completo sirve para entender la arquitectura, pero no para ver qué falla: con
 * ochenta flechas, una roja se pierde. La vista central enseña solo lo que importa de un
 * vistazo, y el resto queda plegado dentro de su dueño:
 *
 *   Internet ─┬─ Gateway ──enruta──▶ nivel 1 ──llama──▶ nivel 2
 *             └──────────expone───▶ nivel 1
 *
 * - Nivel 1: lo que el Gateway enruta (`enruta`, mapper 0.6.0) o lo que se expone
 *   directamente por NodePort o LoadBalancer (`expone`, mapper 0.7.0).
 * - Nivel 2: los servicios a los que llama el nivel 1.
 * - La infraestructura (bases de datos, Redis, brokers, lo de fuera del clúster) no
 *   forma parte del árbol: se pliega en quien la usa. Si falla, el dueño se marca.
 * - Lo que falla fuera del árbol se enseña igualmente: un servicio con una conexión
 *   caída, y la infraestructura compartida que no responde, con sus flechas caídas.
 *   Si no, el mapa central escondería justo lo que hay que ver.
 *
 * Con un servicio filtrado no se usa esta vista: ahí se ve su ramal completo.
 *
 * Deducir la forma del árbol es cosa del panel, igual que las franjas: no se deduce
 * ningún dato de negocio, solo qué se dibuja (CLAUDE.md §1).
 */
import { EdgeRelation, Graph, GraphEdge, GraphNode, ProbeState } from '../types';
import { hostsLabel } from './build';
import { SHARED_KINDS } from './lanes';

/** Conexiones de un nodo que la vista central no dibuja. */
export interface Folded {
  total: number;
  down: number;
}

export interface CentralGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Por nodo visible: lo que sale de él y queda plegado. Solo nodos con algo plegado. */
  folded: Map<string, Folded>;
  /**
   * Si los datos traen entradas del clúster. Sin ellas (mapper anterior a la 0.6.0) no
   * hay raíz desde la que construir el árbol, y el panel enseña el mapa completo.
   */
  hasEntries: boolean;
  /**
   * Nivel de cada nodo del árbol: Internet 0, Gateway 1, nivel 1 = 2, nivel 2 = 3. Lo
   * que se enseña por fallar no tiene nivel. Sirve para que cada nivel sea una columna.
   */
  levels: Map<string, number>;
}

/** Columna de cada nivel del árbol. El Gateway va entre Internet y lo que enruta. */
export const LEVEL = { internet: 0, gateway: 1, first: 2, second: 3 } as const;

/**
 * Separación mínima de capas por flecha para que cada nivel del árbol caiga en su
 * columna. Sin esto, dagre pone un NodePort (Internet → servicio) una columna antes que
 * lo que entra por el Gateway (Internet → Gateway → servicio), aunque los dos sean nivel 1.
 */
export function levelMinLen(edges: GraphEdge[], levels: ReadonlyMap<string, number>): Map<string, number> {
  const minLen = new Map<string, number>();
  for (const edge of edges) {
    const from = levels.get(edge.source);
    const to = levels.get(edge.target);
    minLen.set(edge.id, from !== undefined && to !== undefined ? Math.max(1, to - from) : 1);
  }
  return minLen;
}

/** Cuántos puertos se escriben en una flecha agrupada antes de resumir con «+N». */
const MAX_PORTS_IN_LABEL = 3;

const isEntry = (node: GraphNode) => node.role !== 'service';

/** Infraestructura: no es un servicio del árbol, se pliega en quien la usa. */
const isInfra = (node: GraphNode) => !isEntry(node) && (SHARED_KINDS.has(node.kind) || node.external);

/** El peor estado manda: una caída entre varias flechas agrupadas no se puede esconder. */
function worstState(edges: GraphEdge[]): ProbeState {
  if (edges.some((edge) => edge.state === ProbeState.Down)) {
    return ProbeState.Down;
  }
  if (edges.some((edge) => edge.state === ProbeState.Up)) {
    return ProbeState.Up;
  }
  return ProbeState.NotProbed;
}

const unique = (values: string[]) => [...new Set(values.filter((value) => value !== ''))];

function portsLabel(ports: string[]): string {
  if (ports.length <= MAX_PORTS_IN_LABEL) {
    return ports.join(', ');
  }
  return `${ports.slice(0, MAX_PORTS_IN_LABEL).join(', ')} +${ports.length - MAX_PORTS_IN_LABEL}`;
}

/**
 * Junta las flechas paralelas (mismo origen, destino y relación) en una. En el mapa
 * central interesa que dos nodos están unidos, no por cuántos puertos: un servicio
 * expuesto por HTTP y por gRPC es una sola entrada.
 */
export function mergeParallel(edges: GraphEdge[]): GraphEdge[] {
  const groups = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const key = `${edge.source}->${edge.target}~${edge.relation}`;
    const group = groups.get(key);
    if (group) {
      group.push(edge);
    } else {
      groups.set(key, [edge]);
    }
  }

  return [...groups.entries()].map(([key, group]) => {
    if (group.length === 1) {
      return group[0];
    }
    const first = group[0];
    const ports = unique(group.map((edge) => edge.port));
    const hosts = unique(group.flatMap((edge) => edge.hosts));
    const keys = unique(group.map((edge) => edge.envKey));
    return {
      ...first,
      id: key,
      port: ports.join(', '),
      envKey: keys.length === 1 ? keys[0] : `${keys.length} declaraciones`,
      dstSvc: unique(group.map((edge) => edge.dstSvc)).join(', '),
      dstAddr: unique(group.map((edge) => edge.dstAddr)).join(', '),
      state: worstState(group),
      hosts,
      label: hosts.length > 0 ? hostsLabel(hosts) : portsLabel(ports),
    };
  });
}

const ENTRY_RELATIONS: ReadonlySet<EdgeRelation> = new Set<EdgeRelation>(['enruta', 'expone']);

export function centralView(graph: Graph): CentralGraph {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const hasEntries = graph.nodes.some(isEntry);

  // Quién llama a cada nodo, para distinguir la infraestructura compartida (la usan
  // varios) de la privada (la usa uno, y se pliega en él siempre).
  const callers = new Map<string, Set<string>>();
  const downOut = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.source !== edge.target) {
      const set = callers.get(edge.target) ?? new Set<string>();
      set.add(edge.source);
      callers.set(edge.target, set);
    }
    if (edge.state === ProbeState.Down) {
      downOut.add(edge.source);
    }
  }

  const visible = new Set<string>();
  const levels = new Map<string, number>();
  const place = (id: string, level: number) => {
    visible.add(id);
    if (!levels.has(id)) {
      levels.set(id, level);
    }
  };

  // Entradas y nivel 1.
  graph.nodes.filter(isEntry).forEach((node) => place(node.id, node.role === 'internet' ? LEVEL.internet : LEVEL.gateway));
  for (const edge of graph.edges) {
    const target = byId.get(edge.target);
    if (ENTRY_RELATIONS.has(edge.relation) && target && !isEntry(target)) {
      place(target.id, LEVEL.first);
    }
  }

  // Nivel 2: los servicios a los que llama el nivel 1. La infraestructura no entra.
  for (const edge of graph.edges) {
    const target = byId.get(edge.target);
    if (edge.relation === 'llama' && levels.get(edge.source) === LEVEL.first && target && !isInfra(target) && !isEntry(target)) {
      place(target.id, LEVEL.second);
    }
  }

  // Lo que falla fuera del árbol: servicios con una conexión caída (en cualquier
  // sentido) e infraestructura compartida que no responde. La privada no: se ve en
  // su dueño, que es quien tiene el problema.
  for (const node of graph.nodes) {
    if (visible.has(node.id)) {
      continue;
    }
    const inTrouble = node.incomingDown > 0 || downOut.has(node.id);
    const shared = (callers.get(node.id)?.size ?? 0) >= 2;
    if (inTrouble && (!isInfra(node) || (shared && node.incomingDown > 0))) {
      visible.add(node.id);
    }
  }

  // Qué flechas se dibujan. Las de entrada, siempre: un broker al que enruta el Gateway
  // es infraestructura, pero su entrada es parte del árbol. De las llamadas hacia la
  // infraestructura, solo las caídas: si se dibujaran todas las que llegan a una base
  // de datos que falla, volvería el ovillo.
  const shown: GraphEdge[] = [];
  const folded = new Map<string, Folded>();
  for (const edge of graph.edges) {
    const target = byId.get(edge.target);
    const bothVisible = visible.has(edge.source) && visible.has(edge.target);
    const draw =
      bothVisible &&
      target !== undefined &&
      (edge.relation !== 'llama' || !isInfra(target) || edge.state === ProbeState.Down);
    if (draw) {
      shown.push(edge);
    } else if (visible.has(edge.source)) {
      const entry = folded.get(edge.source) ?? { total: 0, down: 0 };
      entry.total++;
      if (edge.state === ProbeState.Down) {
        entry.down++;
      }
      folded.set(edge.source, entry);
    }
  }

  return {
    nodes: graph.nodes.filter((node) => visible.has(node.id)),
    edges: mergeParallel(shown),
    folded,
    hasEntries,
    levels,
  };
}
