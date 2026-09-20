/**
 * Estilos de cytoscape a partir del tema + CLAUDE.md §3.
 *
 * Fondos y textos salen del tema; los tres colores de estado son fijos porque
 * son semanticos, no de tema.
 */
import type { GrafanaTheme2 } from '@grafana/data';
import type { StylesheetStyle } from 'cytoscape';

import { LayoutDirection, ServiceKind } from '../types';

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

/**
 * Iconos por clase de servicio.
 *
 * Van **embebidos como data URI** dentro del bundle, nunca por red (§10): el
 * navegador de quien mira el dashboard puede no tener Internet.
 *
 * Son siluetas genericas por categoria, no logos de producto: se reconocen
 * igual de bien, no arrastran marcas de terceros y con un solo trazo neutro
 * funcionan en tema claro y oscuro.
 */
const ICON_STROKE = '#A8A8B3';

function icon(body: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${ICON_STROKE}" ` +
    `stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const DATABASE = icon(
  '<ellipse cx="12" cy="5.5" rx="7.5" ry="3"/><path d="M4.5 5.5v13c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-13"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>'
);
const QUEUE = icon('<rect x="3" y="4" width="18" height="5" rx="1"/><rect x="3" y="15" width="18" height="5" rx="1"/><path d="M12 9v6"/>');

export const KIND_ICONS: Readonly<Record<ServiceKind, string>> = {
  postgres: DATABASE,
  mysql: DATABASE,
  mongo: DATABASE,
  // Rayo: memoria volatil, acceso inmediato.
  redis: icon('<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>'),
  kafka: QUEUE,
  amqp: QUEUE,
  // Ondas de emision.
  mqtt: icon('<circle cx="12" cy="18" r="2"/><path d="M8 14a5.7 5.7 0 0 1 8 0"/><path d="M5 11a10 10 0 0 1 14 0"/>'),
  // Cubo de almacenamiento.
  storage: icon('<path d="M4 6h16l-1.5 14.5a1 1 0 0 1-1 .9H6.5a1 1 0 0 1-1-.9z"/><path d="M3 3h18v3H3z"/>'),
  smtp: icon('<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  search: icon('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m21 21-5.8-5.8"/>'),
  // Ida y vuelta: llamada entre servicios.
  grpc: icon('<path d="M3 8h13l-3.5-3.5M21 16H8l3.5 3.5"/>'),
  http: icon('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"/>'),
  other: icon('<rect x="4" y="4" width="16" height="16" rx="3"/>'),
};

export function buildStylesheet(theme: GrafanaTheme2, direction: LayoutDirection = 'LR'): StylesheetStyle[] {
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
        'text-max-width': `${NODE_WIDTH - 46}px`,
        // El icono va pegado al borde izquierdo y el texto se corre para no
        // montarse encima.
        'background-image': 'data(icon)',
        'background-fit': 'none',
        'background-width': '17px',
        'background-height': '17px',
        'background-position-x': '12px',
        'background-position-y': '50%',
        'background-clip': 'none',
        'text-margin-x': 12,
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
        // Ortogonal, no bezier: con sesenta flechas las diagonales se cruzan
        // entre si y el mapa se vuelve ilegible. 'taxi' las obliga a correr por
        // los carriles que quedan entre capas.
        'curve-style': 'taxi',
        'taxi-direction': direction === 'LR' ? 'rightward' : 'downward',
        'taxi-turn': '50%',
        'taxi-turn-min-distance': 10,
        'taxi-radius': 6,
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
