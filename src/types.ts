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
}

export const defaultOptions: ServiceMapOptions = {
  direction: 'LR',
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
  /** Variable de entorno que origino la flecha (etiqueta `clave`). */
  envKey: string;
  external: boolean;
  state: ProbeState;
}

/** Un nodo del grafo. Uno por `*_id` distinto. */
export interface GraphNode {
  id: string;
  label: string;
  cluster: string;
  /** Solo destino y fuera del namespace: se pinta discontinuo. */
  external: boolean;
  incoming: number;
  outgoing: number;
  /** Flechas entrantes con la sonda caida. Si es > 0 el nodo va en rojo. */
  incomingDown: number;
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
