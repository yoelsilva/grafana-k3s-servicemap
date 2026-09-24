/**
 * El clic en un nodo filtra el dashboard por ese nodo. Puro: no sabe de Grafana,
 * recibe la variable ya normalizada y devuelve que valor poner.
 *
 * El filtro es una variable del dashboard (`$servicio` en el de referencia), no un
 * estado interno del panel: asi el resto de paneles del dashboard se filtran a la
 * vez, la URL se puede compartir y el boton atras del navegador lo deshace.
 */

/** Valor que Grafana entiende como «All» en la URL. */
export const ALL_VALUE = '$__all';

/** Lo unico que el filtro necesita saber de una variable del dashboard. */
export interface FilterVariable {
  name: string;
  /** Si admite «All». Sin el, un segundo clic no tiene a que volver. */
  includeAll: boolean;
  /** Valores seleccionados ahora mismo. «All» llega como `[ALL_VALUE]`. */
  values: string[];
}

/**
 * Normaliza una variable tal como la devuelve `getTemplateSrv().getVariables()`.
 * Devuelve null si no existe o no tiene valores seleccionables (un intervalo, un
 * datasource...), y entonces el clic no hace nada.
 */
export function toFilterVariable(variables: readonly unknown[], name: string): FilterVariable | null {
  const wanted = name.trim();
  if (wanted === '') {
    return null;
  }
  for (const raw of variables) {
    if (typeof raw !== 'object' || raw === null) {
      continue;
    }
    const variable = raw as { name?: unknown; type?: unknown; includeAll?: unknown; current?: unknown };
    if (variable.name !== wanted) {
      continue;
    }
    if (variable.type !== 'query' && variable.type !== 'custom') {
      return null;
    }
    const current = (variable.current ?? {}) as { value?: unknown };
    const value = current.value;
    const values = Array.isArray(value) ? value.map(String) : value === undefined ? [] : [String(value)];
    return { name: wanted, includeAll: variable.includeAll === true, values };
  }
  return null;
}

/** Si el dashboard esta filtrado exactamente por este valor. */
export function isFilteredBy(variable: FilterVariable, value: string): boolean {
  return variable.values.length === 1 && variable.values[0] === value;
}

/** Valores por los que esta filtrado el dashboard; vacio si esta en «All». */
export function activeFilter(variable: FilterVariable | null): Set<string> {
  if (!variable || variable.values.includes(ALL_VALUE)) {
    return new Set();
  }
  return new Set(variable.values);
}

/**
 * Que valor poner en la variable al pulsar un nodo.
 *
 * - Si ya esta filtrado por ese nodo, el clic quita el filtro (vuelve a «All»).
 *   Sin esto, salir del filtro obligaria a ir al desplegable de arriba.
 * - Si la variable no admite «All», no hay a donde volver: null, no se toca.
 * - En cualquier otro caso, filtra por el nodo.
 */
export function nextFilterValue(variable: FilterVariable, value: string): string | null {
  if (isFilteredBy(variable, value)) {
    return variable.includeAll ? ALL_VALUE : null;
  }
  return value;
}
