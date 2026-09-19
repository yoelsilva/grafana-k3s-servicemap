/**
 * Configuracion de dagre. El layout por capas es la razon de existir de este
 * panel (CLAUDE.md §3): los nodos sin flechas entrantes a la izquierda, los que
 * solo reciben a la derecha.
 */
import type { LayoutOptions } from 'cytoscape';

import { LayoutDirection } from '../types';

/** Por debajo de este zoom se ocultan las etiquetas de puerto (§3). */
export const PORT_LABEL_ZOOM_THRESHOLD = 0.6;

/** A partir de este numero de flechas se degrada en vez de fallar (§3). */
export const HEAVY_GRAPH_EDGES = 500;

export function dagreLayout(direction: LayoutDirection, heavy: boolean): LayoutOptions {
  return {
    name: 'dagre',
    rankDir: direction,
    // Separacion generosa entre capas: con 80 flechas manda la legibilidad.
    rankSep: direction === 'LR' ? 110 : 80,
    nodeSep: 28,
    edgeSep: 12,
    ranker: 'network-simplex',
    fit: true,
    padding: 24,
    // Con muchos nodos la animacion del layout es lo primero que se cae.
    animate: !heavy,
    animationDuration: 250,
  } as unknown as LayoutOptions;
}
