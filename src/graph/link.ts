/**
 * Enlace al hacer clic en un nodo. Puro: no sabe de Grafana ni de React.
 *
 * La plantilla es una URL con huecos que se rellenan con datos del nodo pulsado.
 * Despues, el panel la pasa por `replaceVariables` de Grafana para que tambien
 * funcionen las variables del dashboard (`$cluster`, `${__from}`...). El orden
 * importa: primero los huecos del nodo, luego Grafana.
 *
 * Los huecos llevan el prefijo `nodo.` a proposito. Los dashboards de Tecopos ya
 * tienen variables `$cluster` y `$servicio`; si los huecos se llamaran igual, en
 * la misma URL `$servicio` seria el filtro del dashboard y `${servicio}` el nodo
 * pulsado. Con el prefijo no hay forma de confundirlos.
 */
import type { GraphNode } from '../types';

/** Huecos disponibles en la plantilla, sin el `${nodo.` ni la llave de cierre. */
export const LINK_PLACEHOLDERS = ['servicio', 'tipo', 'namespace', 'cluster', 'id'] as const;

type Placeholder = (typeof LINK_PLACEHOLDERS)[number];

const PLACEHOLDER_PATTERN = new RegExp(`\\$\\{nodo\\.(${LINK_PLACEHOLDERS.join('|')})\\}`, 'g');

function valuesOf(node: GraphNode): Record<Placeholder, string> {
  return {
    servicio: node.label,
    tipo: node.kind,
    namespace: node.namespace,
    cluster: node.cluster,
    id: node.id,
  };
}

/**
 * Rellena la plantilla con los datos del nodo. `null` si no hay plantilla, que
 * es el caso por defecto: el clic no hace nada hasta que alguien lo configura.
 *
 * Los valores van codificados para URL. Ademas de lo evidente (espacios, `&`),
 * eso convierte un `$` del nombre en `%24`, asi que un nombre de nodo nunca
 * puede colarse como variable en la interpolacion de Grafana que viene despues.
 *
 * Un hueco que no existe (`${nodo.loquesea}`) se deja tal cual: mejor una URL
 * que se ve rara que una que falla en silencio.
 */
export function fillNodeLink(template: string, node: GraphNode): string | null {
  const trimmed = template.trim();
  if (trimmed === '') {
    return null;
  }
  const values = valuesOf(node);
  return trimmed.replace(PLACEHOLDER_PATTERN, (_match, key: Placeholder) => encodeURIComponent(values[key]));
}

/** Si la URL sale de Grafana (`https://...`, `http://...`). Esas se abren en pestaña nueva. */
export function isExternalLink(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url.trim());
}
