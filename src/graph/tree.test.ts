import { EdgeRelation, Graph, GraphEdge, GraphNode, NodeRole, ProbeState, ServiceKind } from '../types';
import { LEVEL, centralView, levelMinLen, mergeParallel } from './tree';

function node(id: string, extra: Partial<GraphNode> = {}): GraphNode {
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
    role: 'service',
    ...extra,
  };
}

const entry = (id: string, role: NodeRole) => node(id, { role });
const infra = (id: string, kind: ServiceKind = 'postgres', extra: Partial<GraphNode> = {}) => node(id, { kind, ...extra });

function edge(
  source: string,
  target: string,
  relation: EdgeRelation = 'llama',
  state: ProbeState = ProbeState.Up,
  port = '80',
  hosts: string[] = []
): GraphEdge {
  return {
    id: `${source}->${target}:${port}`,
    source,
    target,
    port,
    envKey: `${target.toUpperCase()}_URL`,
    dstSvc: `${target}-svc`,
    dstAddr: '',
    state,
    relation,
    hosts,
    label: hosts[0] ?? port,
  };
}

/** Marca `incomingDown` como lo haria `buildGraph`. */
function graphOf(nodes: GraphNode[], edges: GraphEdge[]): Graph {
  const down = new Map<string, number>();
  edges.filter((e) => e.state === ProbeState.Down).forEach((e) => down.set(e.target, (down.get(e.target) ?? 0) + 1));
  return {
    nodes: nodes.map((n) => ({ ...n, incomingDown: down.get(n.id) ?? 0 })),
    edges,
    warnings: [],
    rowCount: edges.length,
  };
}

const ids = (items: Array<{ id: string }>) => items.map((item) => item.id).sort();

/**
 * Internet ─▶ gw ─enruta─▶ web ─▶ api ─▶ deep
 *          └────expone───▶ legacy
 * web y api usan la base comun; api tiene su redis privado.
 */
function sample(extraEdges: GraphEdge[] = [], extraNodes: GraphNode[] = []) {
  const nodes = [
    entry('internet', 'internet'),
    entry('gw', 'gateway'),
    node('web'),
    node('legacy'),
    node('api'),
    node('deep'),
    infra('db'),
    infra('redis-api', 'redis'),
    node('worker'),
    ...extraNodes,
  ];
  const edges = [
    edge('internet', 'gw', 'enruta', ProbeState.NotProbed, '443'),
    edge('gw', 'web', 'enruta', ProbeState.Up, '80', ['web.example.com']),
    edge('internet', 'legacy', 'expone', ProbeState.NotProbed, '31000'),
    edge('web', 'api'),
    edge('api', 'deep'),
    edge('web', 'db', 'llama', ProbeState.Up, '5432'),
    edge('api', 'db', 'llama', ProbeState.Up, '5432'),
    edge('api', 'redis-api', 'llama', ProbeState.Up, '6379'),
    edge('worker', 'db', 'llama', ProbeState.Up, '5432'),
    ...extraEdges,
  ];
  return graphOf(nodes, edges);
}

describe('centralView', () => {
  it('dibuja las entradas, el nivel 1 y el nivel 2, y nada mas si todo responde', () => {
    const view = centralView(sample());
    expect(view.hasEntries).toBe(true);
    // deep es nivel 3; db, redis-api y worker no estan en el arbol.
    expect(ids(view.nodes)).toEqual(['api', 'gw', 'internet', 'legacy', 'web']);
    expect(ids(view.edges)).toEqual([
      'gw->web:80',
      'internet->gw:443',
      'internet->legacy:31000',
      'web->api:80',
    ]);
  });

  it('pliega en su dueño lo que no dibuja, y cuenta lo caido', () => {
    const view = centralView(sample());
    // web: su base de datos. api: db, redis-api y deep (nivel 3).
    expect(view.folded.get('web')).toEqual({ total: 1, down: 0 });
    expect(view.folded.get('api')).toEqual({ total: 3, down: 0 });
    expect(view.folded.has('legacy')).toBe(false);
  });

  it('una dependencia privada caida marca a su dueño y no aparece ella', () => {
    const g = sample();
    g.edges = g.edges.map((e) => (e.target === 'redis-api' ? { ...e, state: ProbeState.Down } : e));
    const view = centralView(graphOf(g.nodes, g.edges));
    expect(ids(view.nodes)).not.toContain('redis-api');
    expect(view.folded.get('api')).toEqual({ total: 3, down: 1 });
  });

  it('la infraestructura compartida que no responde aparece, solo con sus flechas caidas', () => {
    const g = sample();
    g.edges = g.edges.map((e) =>
      e.target === 'db' && (e.source === 'api' || e.source === 'worker') ? { ...e, state: ProbeState.Down } : e
    );
    const view = centralView(graphOf(g.nodes, g.edges));
    // db aparece; worker tambien, porque tiene una conexion caida aunque no cuelgue de ninguna entrada.
    expect(ids(view.nodes)).toEqual(['api', 'db', 'gw', 'internet', 'legacy', 'web', 'worker']);
    const toDb = view.edges.filter((e) => e.target === 'db').map((e) => e.source).sort();
    // La de web responde y no se dibuja: se queda plegada en web.
    expect(toDb).toEqual(['api', 'worker']);
    expect(view.folded.get('web')).toEqual({ total: 1, down: 0 });
  });

  it('un servicio fuera del arbol que no llega a otro aparece, con la flecha caida', () => {
    const view = centralView(sample([edge('deep', 'api', 'llama', ProbeState.Down)]));
    expect(ids(view.nodes)).toContain('deep');
    expect(view.edges.find((e) => e.source === 'deep')?.state).toBe(ProbeState.Down);
  });

  it('la entrada a un broker se dibuja aunque sea infraestructura', () => {
    const view = centralView(
      sample(
        [edge('gw', 'broker', 'enruta', ProbeState.Up, '8083', ['mqtt.example.com']), edge('web', 'broker', 'llama', ProbeState.Up, '1883')],
        [infra('broker', 'mqtt')]
      )
    );
    expect(ids(view.nodes)).toContain('broker');
    expect(view.edges.map((e) => e.id)).toContain('gw->broker:8083');
    // La llamada de web al broker que responde queda plegada.
    expect(view.edges.map((e) => e.id)).not.toContain('web->broker:1883');
  });

  it('una entrada con dos caminos (Gateway y NodePort) tiene dos padres, no se duplica', () => {
    const view = centralView(sample([edge('internet', 'web', 'expone', ProbeState.NotProbed, '32000')]));
    expect(view.nodes.filter((n) => n.id === 'web')).toHaveLength(1);
    expect(view.edges.filter((e) => e.target === 'web').map((e) => e.source).sort()).toEqual(['gw', 'internet']);
  });

  it('sin entradas en los datos lo dice, para que el panel enseñe el mapa completo', () => {
    const view = centralView(graphOf([node('a'), node('b')], [edge('a', 'b')]));
    expect(view.hasEntries).toBe(false);
    expect(view.nodes).toEqual([]);
  });

  it('ignora flechas a nodos que no existen y no cuenta los bucles como llamadores', () => {
    const view = centralView(sample([edge('web', 'fantasma'), edge('legacy', 'legacy')]));
    expect(ids(view.nodes)).not.toContain('fantasma');
    expect(view.folded.get('web')).toEqual({ total: 2, down: 0 });
  });

  it('lo externo es infraestructura aunque no sea de una clase compartida', () => {
    const view = centralView(sample([edge('api', 'pagos', 'llama', ProbeState.Up, '443')], [node('pagos', { external: true })]));
    expect(ids(view.nodes)).not.toContain('pagos');
  });
});

describe('mergeParallel', () => {
  it('junta los puertos de dos flechas entre los mismos nodos, y manda la caida', () => {
    const [merged] = mergeParallel([
      edge('internet', 'svc', 'expone', ProbeState.NotProbed, '30237'),
      edge('internet', 'svc', 'expone', ProbeState.Down, '31821'),
    ]);
    expect(merged.label).toBe('30237, 31821');
    expect(merged.state).toBe(ProbeState.Down);
    expect(merged.envKey).toBe('SVC_URL');
    expect(merged.dstSvc).toBe('svc-svc');
  });

  it('resume con +N cuando hay muchos puertos, y cuenta las declaraciones distintas', () => {
    const edges = ['1', '2', '3', '4', '5'].map((p) => ({ ...edge('a', 'b', 'llama', ProbeState.Up, p), envKey: `K${p}` }));
    const [merged] = mergeParallel(edges);
    expect(merged.label).toBe('1, 2, 3 +2');
    expect(merged.envKey).toBe('5 declaraciones');
    expect(merged.state).toBe(ProbeState.Up);
  });

  it('una ruta agrupada se etiqueta por sus hostnames', () => {
    const [merged] = mergeParallel([
      edge('gw', 'web', 'enruta', ProbeState.NotProbed, '80', ['a.example.com']),
      edge('gw', 'web', 'enruta', ProbeState.NotProbed, '8080', ['b.example.com']),
    ]);
    expect(merged.label).toBe('a.example.com +1');
    expect(merged.state).toBe(ProbeState.NotProbed);
  });

  it('relaciones distintas entre los mismos nodos no se juntan', () => {
    expect(mergeParallel([edge('a', 'b', 'llama'), edge('a', 'b', 'enruta')])).toHaveLength(2);
  });
});

describe('niveles', () => {
  it('Internet 0, Gateway 1, nivel 1 y nivel 2; lo que sale por fallar no tiene nivel', () => {
    const g = sample([edge('deep', 'api', 'llama', ProbeState.Down)]);
    const { levels } = centralView(g);
    expect(Object.fromEntries(levels)).toEqual({
      internet: LEVEL.internet,
      gw: LEVEL.gateway,
      web: LEVEL.first,
      legacy: LEVEL.first,
      api: LEVEL.second,
    });
  });

  it('un nodo que es nivel 1 y ademas lo llama otro del nivel 1 se queda en nivel 1', () => {
    const { levels } = centralView(sample([edge('web', 'legacy')]));
    expect(levels.get('legacy')).toBe(LEVEL.first);
  });

  it('la separacion de capas pone cada nivel en su columna', () => {
    const view = centralView(sample([edge('deep', 'api', 'llama', ProbeState.Down)]));
    const minLen = levelMinLen(view.edges, view.levels);
    // El NodePort salta dos columnas, como lo que entra por el Gateway.
    expect(minLen.get('internet->legacy:31000')).toBe(2);
    expect(minLen.get('internet->gw:443')).toBe(1);
    expect(minLen.get('web->api:80')).toBe(1);
    // Una flecha dentro del mismo nivel, o hacia algo sin nivel, separa lo minimo.
    expect(minLen.get('deep->api:80')).toBe(1);
  });
});
