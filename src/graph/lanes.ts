/**
 * Franjas del mapa: aplicaciones, servicios compartidos y lo que esta fuera del cluster.
 * Puro: no sabe de React ni de cytoscape.
 *
 * Dagre ordena por capas pero no sabe de "que es que": un Postgres que usan seis
 * servicios acaba en la misma columna que el Redis privado de uno solo y que un
 * proveedor de pagos en internet. Las franjas separan esas tres cosas, que son las
 * que importan al leer el mapa: lo tuyo, lo comun a todos, y lo que no controlas.
 *
 * Clasificar por estructura del grafo (cuantos lo usan) es asunto del panel, igual
 * que ya lo es ordenar por capas: no choca con la regla de §1, porque no se deduce
 * ningun dato de negocio, solo como se dibuja.
 */
import { GraphEdge, GraphNode, LayoutDirection, ServiceKind } from '../types';

export type Lane = 'aplicacion' | 'compartido' | 'externo';

/** De izquierda a derecha (o de arriba abajo en vertical), como fluye el trafico. */
export const LANE_ORDER: readonly Lane[] = ['aplicacion', 'compartido', 'externo'];

export const LANE_LABELS: Readonly<Record<Lane, string>> = {
  aplicacion: 'Aplicaciones',
  compartido: 'Servicios compartidos',
  externo: 'Fuera del clúster',
};

/**
 * Clases que son infraestructura por naturaleza: bases de datos, colas, brokers,
 * almacenamiento, busqueda, correo. `grpc`, `http` y `other` son aplicaciones.
 */
export const SHARED_KINDS: ReadonlySet<ServiceKind> = new Set<ServiceKind>([
  'postgres',
  'mysql',
  'mongo',
  'redis',
  'kafka',
  'amqp',
  'mqtt',
  'storage',
  'search',
  'smtp',
]);

/**
 * Cuantos servicios distintos tienen que usar algo para que sea "compartido".
 *
 * Con 1, el Redis privado de un servicio acabaria en compartidos, y no es comun a
 * nadie: tiene que quedarse al lado de quien lo usa.
 */
export const MIN_SHARED_CALLERS = 2;

/**
 * A que franja va cada nodo.
 *
 * El orden de las reglas importa:
 * 1. Infraestructura usada por varios → compartido, **aunque este fuera del cluster**.
 *    Un Postgres en una maquina suelta que usan seis servicios es, sobre todo, la base
 *    de datos comun; lo de "fuera" ya lo dice su borde discontinuo.
 * 2. Lo demas que esta fuera del cluster → externo.
 * 3. El resto → aplicacion.
 */
export function classifyLanes(nodes: GraphNode[], edges: GraphEdge[]): Map<string, Lane> {
  const callers = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.source === edge.target) {
      continue;
    }
    const set = callers.get(edge.target);
    if (set) {
      set.add(edge.source);
    } else {
      callers.set(edge.target, new Set([edge.source]));
    }
  }

  const lanes = new Map<string, Lane>();
  for (const node of nodes) {
    const distinctCallers = callers.get(node.id)?.size ?? 0;
    if (SHARED_KINDS.has(node.kind) && distinctCallers >= MIN_SHARED_CALLERS) {
      lanes.set(node.id, 'compartido');
    } else if (node.external) {
      lanes.set(node.id, 'externo');
    } else {
      lanes.set(node.id, 'aplicacion');
    }
  }
  return lanes;
}

/** Un nodo ya colocado por dagre. */
export interface Placed {
  id: string;
  x: number;
  y: number;
  lane: Lane;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * Separa las franjas moviendo cada una en bloque a lo largo del eje del layout.
 *
 * Dagre ya ha resuelto el orden y los cruces; aqui no se recoloca nada dentro de una
 * franja, solo se desplaza la franja entera para que no se mezcle con la siguiente.
 * Asi se conserva todo lo que dagre hizo bien. El otro eje no se toca.
 *
 * La primera franja con nodos se queda donde dagre la puso; las siguientes van a
 * continuacion, separadas por `gap`.
 */
export function bandPositions(
  nodes: Placed[],
  direction: LayoutDirection,
  size: Size,
  gap: number
): Map<string, { x: number; y: number }> {
  const alongX = direction === 'LR';
  const half = (alongX ? size.width : size.height) / 2;
  const result = new Map<string, { x: number; y: number }>();
  let cursor: number | null = null;

  for (const lane of LANE_ORDER) {
    const members = nodes.filter((node) => node.lane === lane);
    if (members.length === 0) {
      continue;
    }
    const coords = members.map((node) => (alongX ? node.x : node.y));
    const min = Math.min(...coords) - half;
    const max = Math.max(...coords) + half;
    const shift: number = cursor === null ? 0 : cursor - min;

    for (const node of members) {
      result.set(node.id, alongX ? { x: node.x + shift, y: node.y } : { x: node.x, y: node.y + shift });
    }
    cursor = max + shift + gap;
  }
  return result;
}

export interface LaneBox {
  lane: Lane;
  label: string;
  /** Centro de la caja, que es como cytoscape posiciona los nodos. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Las cajas de fondo de cada franja, a partir de los nodos ya separados.
 *
 * A lo largo del eje, cada caja abarca solo sus nodos. En el eje cruzado, **todas
 * abarcan el mapa entero**: asi se leen como columnas (o filas) de verdad, y no como
 * recuadros sueltos de alturas distintas.
 *
 * `header` es el espacio extra arriba para el titulo de la franja.
 */
export function laneBoxes(
  nodes: Placed[],
  direction: LayoutDirection,
  size: Size,
  padding: number,
  header: number
): LaneBox[] {
  if (nodes.length === 0) {
    return [];
  }
  const alongX = direction === 'LR';
  const hw = size.width / 2;
  const hh = size.height / 2;

  // Extension del mapa entero en el eje cruzado.
  const crossMin = Math.min(...nodes.map((n) => (alongX ? n.y - hh : n.x - hw))) - padding;
  const crossMax = Math.max(...nodes.map((n) => (alongX ? n.y + hh : n.x + hw))) + padding;

  const boxes: LaneBox[] = [];
  for (const lane of LANE_ORDER) {
    const members = nodes.filter((node) => node.lane === lane);
    if (members.length === 0) {
      continue;
    }
    const alongMin = Math.min(...members.map((n) => (alongX ? n.x - hw : n.y - hh))) - padding;
    const alongMax = Math.max(...members.map((n) => (alongX ? n.x + hw : n.y + hh))) + padding;

    // El titulo siempre va arriba: en horizontal agranda la caja hacia arriba; en
    // vertical, cada franja es una fila y el titulo tambien necesita su hueco.
    const top = (alongX ? crossMin : alongMin) - header;
    const bottom = alongX ? crossMax : alongMax;
    const left = alongX ? alongMin : crossMin;
    const right = alongX ? alongMax : crossMax;

    boxes.push({
      lane,
      label: LANE_LABELS[lane],
      x: (left + right) / 2,
      y: (top + bottom) / 2,
      width: right - left,
      height: bottom - top,
    });
  }
  return boxes;
}
