/**
 * Distingue clic de doble clic sobre un nodo. Puro: los temporizadores se inyectan
 * para poder probarlo sin reloj real.
 *
 * Hace falta porque las dos acciones se pisan: el clic filtra el dashboard, eso
 * refresca la query y el mapa se redibuja. Si el primer clic de un doble clic se
 * ejecutara al momento, el segundo caeria sobre un mapa recien recolocado y nunca
 * llegaria a ser doble. Asi que el clic espera `delay` ms a ver si llega otro.
 *
 * El coste es ese retraso en el clic simple. Por eso, si el doble clic no hace nada
 * (no hay enlace configurado), el clic se ejecuta sin esperar.
 */

/** Por encima de esto dos clics se sienten separados; por debajo, cuesta hacerlos. */
export const DOUBLE_TAP_MS = 250;

export interface TapTimers {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

export interface TapHandlers<T> {
  single: (target: T) => void;
  double: (target: T) => void;
  /** Si el doble clic haria algo ahora mismo. Se consulta en cada clic. */
  hasDouble: () => boolean;
}

export interface TapClassifier<T> {
  /** Un clic sobre `id`. `target` es lo que se pasa a los handlers. */
  tap: (id: string, target: T) => void;
  /** Descarta un clic pendiente, por ejemplo al desmontar el panel. */
  cancel: () => void;
}

export function createTapClassifier<T>(
  handlers: TapHandlers<T>,
  timers: TapTimers,
  delay: number = DOUBLE_TAP_MS
): TapClassifier<T> {
  let pending: { id: string; handle: unknown } | null = null;

  const cancel = () => {
    if (pending) {
      timers.clear(pending.handle);
      pending = null;
    }
  };

  const tap = (id: string, target: T) => {
    if (!handlers.hasDouble()) {
      cancel();
      handlers.single(target);
      return;
    }
    // Segundo clic sobre el mismo nodo a tiempo: es un doble clic, y el simple
    // que esperaba se descarta.
    if (pending && pending.id === id) {
      cancel();
      handlers.double(target);
      return;
    }
    // Primer clic, o clic rapido sobre otro nodo: si habia uno pendiente se descarta.
    // Filtrar por los dos seguidos acabaria igual (manda el ultimo), pero con un
    // refresco de mas.
    cancel();
    const handle = timers.set(() => {
      pending = null;
      handlers.single(target);
    }, delay);
    pending = { id, handle };
  };

  return { tap, cancel };
}
