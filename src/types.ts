/**
 * Tipos del contrato de datos (CLAUDE.md §2) y opciones del panel.
 *
 * El contrato lo fija el repo `dependencias-mapper`. Cualquier cambio empieza
 * alli y este repo lo adopta despues.
 */

/** Direccion del layout por capas. */
export type LayoutDirection = 'LR' | 'TB';

/** Opciones del panel. */
export interface ServiceMapOptions {
  direction: LayoutDirection;
  /**
   * Variable del dashboard que filtra un clic en un nodo (`servicio` en el dashboard
   * de referencia). Si el dashboard no la tiene, el clic no hace nada. Ver
   * `graph/filter.ts`.
   */
  filterVariable: string;
  /**
   * Plantilla de URL al hacer doble clic en un nodo. Vacia por defecto: un enlace a un
   * dashboard que no existe haria que el primer clic de cualquiera acabara en un
   * 404 y pareciera que el panel esta roto. Ver `graph/link.ts`.
   */
  nodeLink: string;
  /**
   * Separar el mapa en franjas: aplicaciones, servicios compartidos y lo que esta
   * fuera del cluster. Ver `graph/lanes.ts`.
   */
  groupLanes: boolean;
}

export const defaultOptions: ServiceMapOptions = {
  direction: 'LR',
  filterVariable: 'servicio',
  nodeLink: '',
  groupLanes: true,
};

/**
 * Estado de la sonda, tal como lo emite el mapper en `Value`.
 * 0 la sonda falla · 1 alcanzable · 2 no sondeado.
 */
export enum ProbeState {
  Down = 0,
  Up = 1,
  NotProbed = 2,
}

/**
 * Que clase de cosa es un destino. Decide el icono que se dibuja.
 *
 * Lo emite el mapper en la etiqueta `dst_kind` (opcional). Si no viene, el
 * panel lo deduce del puerto, que acierta en la mayoria de casos y en los
 * demas cae en `other`. La etiqueta del mapper siempre gana: el sabe mas.
 */
export type ServiceKind =
  | 'postgres'
  | 'mysql'
  | 'mongo'
  | 'redis'
  | 'kafka'
  | 'amqp'
  | 'mqtt'
  | 'storage'
  | 'smtp'
  | 'search'
  | 'grpc'
  | 'http'
  | 'other';

export const SERVICE_KINDS: readonly ServiceKind[] = [
  'postgres',
  'mysql',
  'mongo',
  'redis',
  'kafka',
  'amqp',
  'mqtt',
  'storage',
  'smtp',
  'search',
  'grpc',
  'http',
  'other',
];

/** Una fila de la metrica `dependencia`: una flecha declarada. */
export interface DependencyRow {
  cluster: string;
  namespace: string;
  src: string;
  srcId: string;
  srcType: string;
  dst: string;
  dstId: string;
  dstSvc: string;
  dstAddr: string;
  dstPort: string;
  /** Namespace del destino (`dst_ns`, desde mapper 0.5.0). Vacio si es externo. */
  dstNs: string;
  /** Variable de entorno que origino la flecha (etiqueta `clave`). */
  envKey: string;
  external: boolean;
  state: ProbeState;
  /** Etiqueta `dst_kind` del mapper. Cadena vacia si no la emite. */
  kind: string;
}

/** Un nodo del grafo. Uno por `*_id` distinto. */
export interface GraphNode {
  id: string;
  label: string;
  cluster: string;
  /** Namespace donde vive. Vacio si es externo o si el mapper no lo dice. */
  namespace: string;
  /** Vive fuera del cluster: se pinta discontinuo. */
  external: boolean;
  incoming: number;
  outgoing: number;
  /** Flechas entrantes con la sonda caida. Si es > 0 el nodo va en rojo. */
  incomingDown: number;
  /** Que clase de cosa es. Decide el icono. */
  kind: ServiceKind;
}

/** Una flecha del grafo. Una por fila. */
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  port: string;
  envKey: string;
  dstSvc: string;
  dstAddr: string;
  state: ProbeState;
}

/** Resultado de `buildGraph`. */
export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Problemas en los datos que hay que mostrarle a quien mira el panel. */
  warnings: string[];
  /** Filas leidas, incluidas las descartadas. */
  rowCount: number;
}
