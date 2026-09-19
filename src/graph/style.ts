/**
 * Estilos de cytoscape a partir del tema + CLAUDE.md §3.
 *
 * Fondos y textos salen del tema; los tres colores de estado son fijos porque
 * son semanticos, no de tema.
 */
import type { GrafanaTheme2 } from '@grafana/data';
import type { StylesheetStyle } from 'cytoscape';

/** Sonda OK, y color por defecto de los nodos. */
export const COLOR_OK = '#8E8E9E';
/** Sonda caida. */
export const COLOR_DOWN = '#F2495C';
/** Destino externo, o flecha no sondeada. */
export const COLOR_EXTERNAL = '#5794F2';

export const NODE_WIDTH = 140;
export const NODE_HEIGHT = 46;

/** Clase que se pone a las flechas cuando el zoom no da para leer el puerto. */
export const CLASS_NO_LABEL = 'no-label';

export function buildStylesheet(theme: GrafanaTheme2): StylesheetStyle[] {
  return [
    {
      selector: 'node',
      style: {
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        shape: 'round-rectangle',
        'background-color': theme.colors.background.secondary,
        'border-color': COLOR_OK,
        'border-width': 1.5,
        label: 'data(label)',
        color: theme.colors.text.primary,
        'font-family': theme.typography.fontFamily,
        'font-size': 12,
        'text-valign': 'center',
        'text-halign': 'center',
        // Una sola linea: si no cabe, se recorta. §3 pide legible, no completo.
        'text-wrap': 'ellipsis',
        'text-max-width': `${NODE_WIDTH - 16}px`,
      },
    },
    {
      // Destino fuera del namespace: discontinuo y azul mientras este bien.
      selector: 'node.external',
      style: {
        'border-style': 'dashed',
        'border-dash-pattern': [4, 3],
        'border-color': COLOR_EXTERNAL,
      },
    },
    {
      // Alguna flecha entrante caida. Va despues de .external a proposito: el
      // rojo gana al azul, y el discontinuo se conserva.
      selector: 'node.down',
      style: {
        'border-color': COLOR_DOWN,
        'border-width': 2.5,
      },
    },
    {
      selector: 'node:selected',
      style: {
        'background-color': theme.colors.background.canvas,
        'border-color': theme.colors.primary.border,
      },
    },
    {
      selector: 'edge',
      style: {
        'curve-style': 'bezier',
        width: 1.5,
        'line-color': COLOR_OK,
        'target-arrow-color': COLOR_OK,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.9,
        label: 'data(port)',
        color: theme.colors.text.secondary,
        'font-family': theme.typography.fontFamily,
        'font-size': 9,
        'text-background-color': theme.colors.background.canvas,
        'text-background-opacity': 0.85,
        'text-background-padding': '2px',
        'text-rotation': 'autorotate',
      },
    },
    {
      selector: 'edge.state-down',
      style: {
        width: 2.5,
        'line-color': COLOR_DOWN,
        'target-arrow-color': COLOR_DOWN,
      },
    },
    {
      selector: 'edge.state-notprobed',
      style: {
        'line-color': COLOR_EXTERNAL,
        'target-arrow-color': COLOR_EXTERNAL,
        'line-style': 'dashed',
        'line-dash-pattern': [5, 4],
      },
    },
    {
      selector: `edge.${CLASS_NO_LABEL}`,
      style: {
        'text-opacity': 0,
      },
    },
  ] as StylesheetStyle[];
}
