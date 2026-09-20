/**
 * Configuracion de dagre. El layout por capas es la razon de existir de este
 * panel (CLAUDE.md §3): los nodos sin flechas entrantes a la izquierda, los que
 * solo reciben a la derecha.
 */
import type { LayoutOptions } from 'cytoscape';

import { GraphEdge, GraphNode, LayoutDirection } from '../types';

/** Por debajo de este zoom se ocultan las etiquetas de puerto (§3). */
export const PORT_LABEL_ZOOM_THRESHOLD = 0.6;

/** A partir de este numero de flechas se degrada en vez de fallar (§3). */
export const HEAVY_GRAPH_EDGES = 500;

/**
 * Empuja a la ultima capa todo lo que solo recibe.
 *
 * Dagre coloca cada nodo segun su distancia al **origen**, asi que un Redis
 * colgado del primer servicio cae en la columna 2 y otro colgado del tercero
 * en la columna 4: los almacenes acaban desperdigados por todo el mapa. §3
 * pide justo lo contrario, que lo que solo recibe quede a la derecha.
 *
 * Se arregla midiendo la distancia al **final** en vez de al principio:
 *
 *   altura(n) = 0 si no tiene salientes, si no 1 + max(altura(sucesores))
 *   capa(n)   = altura maxima - altura(n)
 *
 * Con eso todos los sumideros comparten la ultima capa. Se le pasa a dagre
 * como `minLen` por flecha, que es la separacion minima de capas que debe
 * respetar.
 *
 * Los ciclos se cortan: si A llama a B y B llama a A, la segunda visita
 * devuelve 0 en vez de girar para siempre.
 */
export function sinkAlignedMinLen(nodes: GraphNode[], edges: GraphEdge[]): Map<string, number> {
  const successors = new Map<string, string[]>();
  nodes.forEach((node) => successors.set(node.id, []));
  edges.forEach((edge) => successors.get(edge.source)?.push(edge.target));

  const height = new Map<string, number>();
  const visiting = new Set<string>();

  const heightOf = (id: string): number => {
    const known = height.get(id);
    if (known !== undefined) {
      return known;
    }
    if (visiting.has(id)) {
      return 0;
    }
    visiting.add(id);
    let tallest = 0;
    for (const next of successors.get(id) ?? []) {
      if (next !== id) {
        tallest = Math.max(tallest, 1 + heightOf(next));
      }
    }
    visiting.delete(id);
    height.set(id, tallest);
    return tallest;
  };

  nodes.forEach((node) => heightOf(node.id));

  let deepest = 0;
  height.forEach((h) => {
    deepest = Math.max(deepest, h);
  });
  const layerOf = (id: string) => deepest - (height.get(id) ?? 0);

  const minLen = new Map<string, number>();
  edges.forEach((edge) => {
    const span = layerOf(edge.target) - layerOf(edge.source);
    minLen.set(edge.id, span >= 1 ? span : 1);
  });
  return minLen;
}

export function dagreLayout(
  direction: LayoutDirection,
  heavy: boolean,
  minLen?: ReadonlyMap<string, number>
): LayoutOptions {
  return {
    name: 'dagre',
    rankDir: direction,
    // Separacion generosa entre capas: con 80 flechas manda la legibilidad.
    rankSep: direction === 'LR' ? 150 : 110,
    nodeSep: 36,
    edgeSep: 20,
    ranker: 'network-simplex',
    // Separacion de capas por flecha: lo que alinea los sumideros a la derecha.
    minLen: (edge: { id(): string }) => minLen?.get(edge.id()) ?? 1,
    fit: true,
    padding: 24,
    // Con muchos nodos la animacion del layout es lo primero que se cae.
    animate: !heavy,
    animationDuration: 250,
  } as unknown as LayoutOptions;
}
