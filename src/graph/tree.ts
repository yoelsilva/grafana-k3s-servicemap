/**
 * Las dos vistas que no son el mapa completo. Puro: no sabe de React ni de cytoscape.
 *
 * El mapa completo sirve para entender la arquitectura, pero no para ver qué falla: con
 * ochenta flechas, una roja se pierde. Así que el panel abre en la vista central y
 * enseña el detalle de un servicio solo cuando se pide.
 *
 * **Vista central**: lo que entra desde Internet, con el Gateway en medio, y nada más.
 * Internet no se dibuja: todo lo de esta vista viene de ahí.
 *
 *        Gateway              NodePort · N        (la entrada directa, resumida)
 *        ├──▶ servicio A      (rojo si falla algo en su ramal)
 *        └──▶ servicio B
 *
 * - Un servicio del primer nivel se pinta en rojo si falla cualquier conexión de su ramal,
 *   por abajo que esté: una base de datos que no responde a un servicio que él llama es
 *   un problema de su entrada.
 * - Lo expuesto directamente por NodePort (lo que queda por migrar al Gateway) va en un solo
 *   nodo, que también se pinta en rojo si algo de su ramal falla.
 * - Lo que no entra desde Internet (workers, servicios internos) no sale en esta vista: un
 *   fallo suyo se ve en el ramal del servicio que lo usa.
 *
 * **Vista de un servicio**: quién lo llama, y todo su ramal hacia abajo, con cada conexión.
 *
 * Deducir qué se dibuja es cosa del panel, igual que las franjas: no se deduce ningún dato
 * de negocio (CLAUDE.md §1).
 */
import { Graph, GraphEdge, GraphNode, ProbeState } from '../types';
import { hostsLabel } from './build';

/** Id del nodo que resume la entrada directa (NodePort). No choca con los del mapper (`n_…`). */
export const DIRECT_ID = '__nodeport';

/** Problemas en el ramal de un nodo de la vista central. */
export interface Branch {
  /** Conexiones de su ramal, contando las de todos los que cuelgan de él. */
  total: number;
  /** Las que tienen la sonda caída, como `origen → destino:puerto`. */
  failing: string[];
}

export interface CentralGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Por nodo del primer nivel (y el de NodePort): su ramal. */
  branches: Map<string, Branch>;
  /**
   * Si hay un Gateway en los datos. Sin él (mapper anterior a la 0.6.0) no hay entrada
   * desde la que construir la vista, y el panel enseña el mapa completo.
   */
  hasEntries: boolean;
  /** Fila de cada nodo: las entradas (Gateway y NodePort) 0, lo que enruta el Gateway 1. */
  levels: Map<string, number>;
}

/** Fila de cada nivel. */
export const LEVEL = { entry: 0, first: 1 } as const;

const MAX_PORTS_IN_LABEL = 3;

const describe = (edge: GraphEdge, byId: ReadonlyMap<string, GraphNode>) =>
  `${byId.get(edge.source)?.label ?? edge.source} → ${byId.get(edge.target)?.label ?? edge.target}:${edge.port}`;

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
 * Junta las flechas paralelas (mismo origen, destino y relación) en una. Interesa que dos
 * nodos están unidos, no por cuántos puertos: Internet → Gateway por 80 y 443 es una entrada.
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

/** Las flechas que salen de cada nodo, para recorrer ramales. */
function outgoingIndex(edges: GraphEdge[]): Map<string, GraphEdge[]> {
  const out = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const list = out.get(edge.source) ?? [];
    list.push(edge);
    out.set(edge.source, list);
  }
  return out;
}

/**
 * Todo lo que cuelga de `start` siguiendo las llamadas hacia abajo: los nodos (sin contar
 * `start`) y las flechas recorridas. Las flechas de entrada (`enruta`, `expone`) no se
 * siguen: el ramal de un servicio es lo que él llama, no lo que entra por su Gateway.
 * Si se da `blocked`, el recorrido no pasa por ese nodo.
 */
function downstream(start: string, out: ReadonlyMap<string, GraphEdge[]>, blocked?: string) {
  const nodes = new Set<string>();
  const edges: GraphEdge[] = [];
  const queue = [start];
  const seen = new Set([start]);
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of out.get(current) ?? []) {
      if (edge.relation !== 'llama' || edge.target === blocked) {
        continue;
      }
      edges.push(edge);
      if (!seen.has(edge.target)) {
        seen.add(edge.target);
        nodes.add(edge.target);
        queue.push(edge.target);
      }
    }
  }
  return { nodes, edges };
}

function branchOf(edges: GraphEdge[], byId: ReadonlyMap<string, GraphNode>): Branch {
  return {
    total: edges.length,
    failing: edges.filter((edge) => edge.state === ProbeState.Down).map((edge) => describe(edge, byId)),
  };
}

export function centralView(graph: Graph): CentralGraph {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const gateways = graph.nodes.filter((node) => node.role === 'gateway');
  const hasEntries = gateways.length > 0;
  const out = outgoingIndex(graph.edges);

  const levels = new Map<string, number>();
  gateways.forEach((node) => levels.set(node.id, LEVEL.entry));

  // Primer nivel: lo que enruta un Gateway.
  const first = new Set<string>();
  for (const edge of graph.edges) {
    const target = byId.get(edge.target);
    if (edge.relation === 'enruta' && levels.get(edge.source) === LEVEL.entry && target?.role === 'service') {
      first.add(target.id);
      levels.set(target.id, LEVEL.first);
    }
  }

  const branches = new Map<string, Branch>();
  for (const id of first) {
    const branch = branchOf(downstream(id, out).edges, byId);
    // Si al propio servicio no le llega alguien, también es un problema suyo.
    graph.edges
      .filter((edge) => edge.target === id && edge.state === ProbeState.Down && edge.relation === 'llama')
      .forEach((edge) => branch.failing.push(describe(edge, byId)));
    branches.set(id, branch);
  }

  const nodes: GraphNode[] = [...gateways, ...graph.nodes.filter((node) => first.has(node.id))];
  // Solo Gateway → primer nivel. Internet no se dibuja: todo lo de la vista viene de ahí.
  const edges: GraphEdge[] = graph.edges.filter(
    (edge) => edge.relation === 'enruta' && levels.get(edge.source) === LEVEL.entry && first.has(edge.target)
  );

  // La otra entrada: lo que se expone directamente por NodePort o LoadBalancer, resumido
  // en un nodo al lado del Gateway. Lo que ya entra por el Gateway no cuenta dos veces.
  const exposed = [
    ...new Set(
      graph.edges
        .filter((edge) => edge.relation === 'expone' && byId.get(edge.target)?.role === 'service' && !first.has(edge.target))
        .map((edge) => edge.target)
    ),
  ];
  if (hasEntries && exposed.length > 0) {
    const exposedEdges = exposed.flatMap((id) => downstream(id, out).edges);
    const ports = graph.edges.filter((edge) => edge.relation === 'expone' && exposed.includes(edge.target)).length;
    nodes.push({
      id: DIRECT_ID,
      label: `NodePort · ${exposed.length}`,
      cluster: gateways[0].cluster,
      namespace: '',
      external: false,
      incoming: ports,
      outgoing: exposed.length,
      incomingDown: 0,
      kind: 'other',
      role: 'group',
    });
    levels.set(DIRECT_ID, LEVEL.entry);
    branches.set(DIRECT_ID, branchOf(exposedEdges, byId));
  }

  return {
    nodes: hasEntries ? nodes : [],
    edges: hasEntries ? mergeParallel(edges) : [],
    branches,
    hasEntries,
    levels,
  };
}

/**
 * Lo que entra directamente por NodePort o LoadBalancer, sin pasar por el Gateway: el nodo
 * «NodePort» arriba y cada servicio expuesto debajo, en rojo si falla algo de su ramal. Es
 * lo que queda por migrar al Gateway. Se abre al pulsar el nodo «NodePort» de la vista central.
 */
export function directView(graph: Graph): CentralGraph {
  const central = centralView(graph);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const out = outgoingIndex(graph.edges);
  const group = central.nodes.find((node) => node.id === DIRECT_ID);
  const exposedEdges = graph.edges.filter(
    (edge) => edge.relation === 'expone' && byId.get(edge.target)?.role === 'service' && !central.levels.has(edge.target)
  );
  const targets = [...new Set(exposedEdges.map((edge) => edge.target))];

  const branches = new Map<string, Branch>();
  const levels = new Map<string, number>();
  if (group) {
    branches.set(DIRECT_ID, central.branches.get(DIRECT_ID) as Branch);
    levels.set(DIRECT_ID, LEVEL.entry);
  }
  for (const id of targets) {
    const branch = branchOf(downstream(id, out).edges, byId);
    graph.edges
      .filter((edge) => edge.target === id && edge.state === ProbeState.Down && edge.relation === 'llama')
      .forEach((edge) => branch.failing.push(describe(edge, byId)));
    branches.set(id, branch);
    levels.set(id, LEVEL.first);
  }

  // Las flechas salen del nodo «NodePort», que es la entrada; con todos sus puertos juntos.
  const edges = mergeParallel(exposedEdges.map((edge) => ({ ...edge, source: DIRECT_ID, id: `${DIRECT_ID}->${edge.id}` })));

  return {
    nodes: group ? [group, ...graph.nodes.filter((node) => targets.includes(node.id))] : [],
    edges: group ? edges : [],
    branches,
    hasEntries: central.hasEntries,
    levels,
  };
}

/**
 * Separación mínima de capas por flecha para que cada nivel caiga en su fila.
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

/**
 * La vista de un servicio: solo sus conexiones directas, las que llegan y las que salen.
 * Para ver las de un vecino, se pulsa el vecino. Cada nodo de la vista lleva su ramal, así
 * que un vecino se pinta en rojo si falla algo de lo que cuelga de él: dice por dónde seguir.
 */
export function focusView(graph: Graph, focusId: string): CentralGraph {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const out = outgoingIndex(graph.edges);
  // Con un ciclo (A llama a B y B a A) la misma flecha sale de los dos lados; cytoscape
  // no admite dos elementos con el mismo id.
  const edges = new Map<string, GraphEdge>();
  graph.edges
    .filter((edge) => edge.source === focusId || edge.target === focusId)
    .forEach((edge) => edges.set(edge.id, edge));
  const keep = new Set<string>([focusId]);
  edges.forEach((edge) => {
    keep.add(edge.source);
    keep.add(edge.target);
  });

  const branches = new Map<string, Branch>();
  for (const id of keep) {
    // El ramal de un vecino es lo que cuelga de él, sin pasar por el servicio seleccionado:
    // lo que falla por debajo de este ya está a la vista, y pintaría en rojo a todos los que
    // lo llaman. Las entradas no tienen ramal propio: lo suyo son sus rutas, que ya se ven.
    if (byId.get(id)?.role === 'service') {
      const branch = branchOf(downstream(id, out, id === focusId ? undefined : focusId).edges, byId);
      if (branch.total > 0) {
        branches.set(id, branch);
      }
    }
  }

  return {
    nodes: graph.nodes.filter((node) => keep.has(node.id)),
    edges: [...edges.values()],
    branches,
    hasEntries: graph.nodes.some((node) => node.role === 'gateway'),
    levels: new Map(),
  };
}
