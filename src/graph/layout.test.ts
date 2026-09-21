import { GraphEdge, GraphNode } from '../types';
import { dagreLayout, sinkAlignedMinLen, spreadTaxiTurns } from './layout';

/** Las opciones de dagre no estan tipadas por cytoscape; se leen como objeto. */
type DagreOptions = Record<string, unknown> & { minLen: (edge: { id(): string }) => number };

function node(id: string): GraphNode {
  return {
    id,
    label: id,
    cluster: '',
    namespace: '',
    external: false,
    incoming: 0,
    outgoing: 0,
    incomingDown: 0,
    kind: 'other',
  };
}

function edge(source: string, target: string, id = `${source}->${target}`): GraphEdge {
  return { id, source, target, port: '80', envKey: '', dstSvc: '', dstAddr: '', state: 1 };
}

/** Reconstruye la capa de cada nodo a partir de los `minLen`, para poder afirmar sobre ellas. */
function layersOf(nodes: GraphNode[], edges: GraphEdge[]): Map<string, number> {
  const minLen = sinkAlignedMinLen(nodes, edges);
  const layer = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  // Relajacion tipo Bellman-Ford: con un grafo aciclico converge.
  for (let pass = 0; pass < nodes.length; pass++) {
    for (const e of edges) {
      const candidate = (layer.get(e.source) ?? 0) + (minLen.get(e.id) ?? 1);
      if (candidate > (layer.get(e.target) ?? 0)) {
        layer.set(e.target, candidate);
      }
    }
  }
  return layer;
}

describe('sinkAlignedMinLen', () => {
  it('sin flechas no devuelve nada', () => {
    expect(sinkAlignedMinLen([node('a')], []).size).toBe(0);
  });

  it('una cadena separa cada eslabon una capa', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const edges = [edge('a', 'b'), edge('b', 'c')];

    const minLen = sinkAlignedMinLen(nodes, edges);

    expect(minLen.get('a->b')).toBe(1);
    expect(minLen.get('b->c')).toBe(1);
  });

  it('un atajo se estira para que el sumidero no se adelante', () => {
    // a -> b -> c -> d, y ademas a -> d directo. Sin esto, `d` caeria en la
    // capa 1 por el atajo en vez de quedarse al final con los demas sumideros.
    const nodes = [node('a'), node('b'), node('c'), node('d')];
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('a', 'd')];

    const minLen = sinkAlignedMinLen(nodes, edges);

    expect(minLen.get('a->d')).toBe(3);
    expect(layersOf(nodes, edges).get('d')).toBe(3);
  });

  it('todos los sumideros acaban en la misma capa, la ultima', () => {
    // Dos ramas de distinta longitud que terminan en almacenes distintos.
    const nodes = ['gw', 'largo1', 'largo2', 'corto', 'db1', 'db2'].map(node);
    const edges = [
      edge('gw', 'largo1'),
      edge('largo1', 'largo2'),
      edge('largo2', 'db1'),
      edge('gw', 'corto'),
      edge('corto', 'db2'),
    ];

    const layers = layersOf(nodes, edges);

    expect(layers.get('db1')).toBe(layers.get('db2'));
    expect(layers.get('db1')).toBe(3);
  });

  it('un ciclo no cuelga y respeta el minimo de una capa', () => {
    const nodes = [node('a'), node('b')];
    const edges = [edge('a', 'b'), edge('b', 'a')];

    const minLen = sinkAlignedMinLen(nodes, edges);

    expect(minLen.get('a->b')).toBeGreaterThanOrEqual(1);
    expect(minLen.get('b->a')).toBeGreaterThanOrEqual(1);
  });

  it('un autobucle no cuenta como profundidad', () => {
    const nodes = [node('a'), node('b')];
    const edges = [edge('a', 'a'), edge('a', 'b')];

    expect(sinkAlignedMinLen(nodes, edges).get('a->b')).toBe(1);
  });

  it('una flecha hacia un nodo que no existe no rompe nada', () => {
    const minLen = sinkAlignedMinLen([node('a')], [edge('a', 'fantasma')]);

    expect(minLen.get('a->fantasma')).toBeGreaterThanOrEqual(1);
  });
});

describe('dagreLayout', () => {
  const optionsOf = (...args: Parameters<typeof dagreLayout>) => dagreLayout(...args) as unknown as DagreOptions;

  it('en horizontal separa mas las capas que en vertical', () => {
    // Los nodos miden 140 de ancho y 46 de alto: en LR hace falta mas hueco.
    expect(optionsOf('LR', false).rankSep).toBe(150);
    expect(optionsOf('TB', false).rankSep).toBe(110);
  });

  it('pasa la direccion a dagre', () => {
    expect(optionsOf('TB', false).rankDir).toBe('TB');
  });

  it('con un grafo pesado apaga la animacion', () => {
    expect(optionsOf('LR', false).animate).toBe(true);
    expect(optionsOf('LR', true).animate).toBe(false);
  });

  it('usa el minLen que se le pasa', () => {
    const options = optionsOf('LR', false, new Map([['a->b', 4]]));

    expect(options.minLen({ id: () => 'a->b' })).toBe(4);
  });

  it('una flecha sin minLen conocido separa una capa', () => {
    expect(optionsOf('LR', false, new Map()).minLen({ id: () => 'desconocida' })).toBe(1);
    expect(optionsOf('LR', false).minLen({ id: () => 'lo-que-sea' })).toBe(1);
  });
});

describe('spreadTaxiTurns', () => {
  it('sin flechas no devuelve nada', () => {
    expect(spreadTaxiTurns([]).size).toBe(0);
  });

  it('una sola flecha gira por el medio', () => {
    expect(spreadTaxiTurns([edge('a', 'b')]).get('a->b')).toBe('50%');
  });

  it('dos flechas del mismo origen se van a los extremos', () => {
    const turns = spreadTaxiTurns([edge('a', 'b'), edge('a', 'c')]);

    expect(turns.get('a->b')).toBe('28%');
    expect(turns.get('a->c')).toBe('72%');
  });

  it('tres se reparten con una en el centro', () => {
    const turns = spreadTaxiTurns([edge('a', 'b'), edge('a', 'c'), edge('a', 'd')]);

    expect([turns.get('a->b'), turns.get('a->c'), turns.get('a->d')]).toEqual(['28%', '50%', '72%']);
  });

  it('ningun par de flechas del mismo origen comparte carril', () => {
    const edges = Array.from({ length: 12 }, (_, i) => edge('gw', `svc${i}`, `e${i}`));

    const turns = [...spreadTaxiTurns(edges).values()];

    expect(new Set(turns).size).toBe(12);
  });

  it('cada origen se reparte por su cuenta', () => {
    const turns = spreadTaxiTurns([edge('a', 'x'), edge('b', 'y')]);

    // Dos origenes con una flecha cada uno: las dos por el medio, no se estorban.
    expect(turns.get('a->x')).toBe('50%');
    expect(turns.get('b->y')).toBe('50%');
  });
});
