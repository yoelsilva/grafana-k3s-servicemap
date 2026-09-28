import { EdgeRelation, Graph, GraphEdge, GraphNode, NodeRole, ProbeState, ServiceKind } from '../types';
import { DIRECT_ID, LEVEL, centralView, directView, focusView, levelMinLen, mergeParallel } from './tree';

function node(id: string, extra: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    label: id,
    cluster: 'production',
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
const infra = (id: string, kind: ServiceKind = 'postgres') => node(id, { kind });

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

const graphOf = (nodes: GraphNode[], edges: GraphEdge[]): Graph => ({ nodes, edges, warnings: [], rowCount: edges.length });

const ids = (items: Array<{ id: string }>) => items.map((item) => item.id).sort();

/**
 * Internet ─▶ gw ─enruta─▶ web ─▶ api ─▶ deep ─▶ db
 *          │           └─▶ shop
 *          └─expone─▶ legacy ─▶ db
 * worker ─▶ db (no entra por ningun lado)
 */
function sample(overrides: (e: GraphEdge) => GraphEdge = (e) => e) {
  const nodes = [
    entry('internet', 'internet'),
    entry('gw', 'gateway'),
    node('web'),
    node('shop'),
    node('api'),
    node('deep'),
    node('legacy'),
    node('worker'),
    infra('db'),
  ];
  const edges = [
    edge('internet', 'gw', 'enruta', ProbeState.NotProbed, '443'),
    edge('internet', 'gw', 'enruta', ProbeState.NotProbed, '80'),
    edge('gw', 'web', 'enruta', ProbeState.Up, '80', ['web.example.com']),
    edge('gw', 'shop', 'enruta', ProbeState.Up, '80', ['shop.example.com']),
    edge('internet', 'legacy', 'expone', ProbeState.NotProbed, '31000'),
    edge('web', 'api'),
    edge('api', 'deep'),
    edge('deep', 'db', 'llama', ProbeState.Up, '5432'),
    edge('legacy', 'db', 'llama', ProbeState.Up, '5432'),
    edge('worker', 'db', 'llama', ProbeState.Up, '5432'),
  ].map(overrides);
  return graphOf(nodes, edges);
}

const down = (source: string, target: string) => (e: GraphEdge) =>
  e.source === source && e.target === target ? { ...e, state: ProbeState.Down } : e;

describe('centralView', () => {
  it('el Gateway y lo que enruta; Internet no se dibuja, y NodePort va resumido', () => {
    const view = centralView(sample());
    expect(view.hasEntries).toBe(true);
    expect(ids(view.nodes)).toEqual([DIRECT_ID, 'gw', 'shop', 'web']);
    // Ninguna llamada entre servicios ni nada de Internet: solo las rutas.
    expect(view.edges.map((e) => `${e.source}->${e.target}`).sort()).toEqual(['gw->shop', 'gw->web']);
  });

  it('el nodo de NodePort cuenta los servicios expuestos que no entran por el Gateway', () => {
    const g = sample();
    // web entra por el Gateway y ademas por NodePort: no cuenta dos veces.
    g.edges.push(edge('internet', 'web', 'expone', ProbeState.NotProbed, '32000'));
    g.edges.push(edge('internet', 'legacy', 'expone', ProbeState.NotProbed, '31001'));
    const direct = centralView(g).nodes.find((n) => n.id === DIRECT_ID);
    expect(direct).toMatchObject({ label: 'NodePort · 1', role: 'group', incoming: 2 });
  });

  it('el ramal de un servicio de entrada llega hasta abajo, y lo marca si algo falla lejos', () => {
    const view = centralView(sample(down('deep', 'db')));
    expect(view.branches.get('web')).toEqual({ total: 3, failing: ['deep → db:5432'] });
    expect(view.branches.get('shop')).toEqual({ total: 0, failing: [] });
  });

  it('si a un servicio de entrada no le llega alguien, tambien es problema suyo', () => {
    const g = sample();
    g.edges.push(edge('worker', 'web', 'llama', ProbeState.Down, '8080'));
    expect(centralView(g).branches.get('web')?.failing).toEqual(['worker → web:8080']);
  });

  it('un fallo en el ramal de lo expuesto marca el nodo de NodePort', () => {
    expect(centralView(sample(down('legacy', 'db'))).branches.get(DIRECT_ID)?.failing).toEqual(['legacy → db:5432']);
  });

  it('sin nada expuesto no hay nodo de NodePort', () => {
    const g = graphOf([entry('gw', 'gateway'), node('web')], [edge('gw', 'web', 'enruta')]);
    expect(ids(centralView(g).nodes)).toEqual(['gw', 'web']);
  });

  it('sin Gateway en los datos no hay vista central', () => {
    const view = centralView(graphOf([node('a'), node('b')], [edge('a', 'b')]));
    expect(view.hasEntries).toBe(false);
    expect(view.nodes).toEqual([]);
    expect(view.edges).toEqual([]);
  });

  it('cada nivel en su fila', () => {
    const view = centralView(sample());
    expect(view.levels.get('gw')).toBe(LEVEL.entry);
    expect(view.levels.get(DIRECT_ID)).toBe(LEVEL.entry);
    expect(view.levels.get('web')).toBe(LEVEL.first);
    const minLen = levelMinLen(view.edges, view.levels);
    expect(minLen.get('gw->web:80')).toBe(1);
    expect(levelMinLen([edge('x', 'y')], view.levels).get('x->y:80')).toBe(1);
  });

  it('un Gateway que enruta hacia otra entrada no la cuenta como servicio', () => {
    const g = sample();
    g.edges.push(edge('gw', 'internet', 'enruta'));
    expect(centralView(g).branches.has('internet')).toBe(false);
  });
});

describe('directView', () => {
  it('el nodo de NodePort arriba y cada servicio expuesto debajo, con sus puertos juntos', () => {
    const g = sample(down('legacy', 'db'));
    g.edges.push(edge('internet', 'legacy', 'expone', ProbeState.NotProbed, '31001'));
    const view = directView(g);
    expect(ids(view.nodes)).toEqual([DIRECT_ID, 'legacy']);
    expect(view.edges).toHaveLength(1);
    expect(view.edges[0]).toMatchObject({ source: DIRECT_ID, target: 'legacy', label: '31000, 31001' });
    expect(view.branches.get('legacy')?.failing).toEqual(['legacy → db:5432']);
    expect(view.levels.get(DIRECT_ID)).toBe(LEVEL.entry);
    expect(view.levels.get('legacy')).toBe(LEVEL.first);
  });

  it('marca tambien al expuesto al que no le llega alguien', () => {
    const g = sample();
    g.edges.push(edge('worker', 'legacy', 'llama', ProbeState.Down, '9000'));
    expect(directView(g).branches.get('legacy')?.failing).toEqual(['worker → legacy:9000']);
  });

  it('sin nada expuesto, vacia', () => {
    const view = directView(graphOf([entry('gw', 'gateway'), node('web')], [edge('gw', 'web', 'enruta')]));
    expect(view.nodes).toEqual([]);
    expect(view.edges).toEqual([]);
  });
});

describe('focusView', () => {
  it('quien lo llama y todo su ramal hacia abajo, cada conexion por separado', () => {
    const view = focusView(sample(), 'api');
    expect(ids(view.nodes)).toEqual(['api', 'db', 'deep', 'web']);
    expect(ids(view.edges)).toEqual(['api->deep:80', 'deep->db:5432', 'web->api:80']);
  });

  it('en una base de datos, todos los que la usan', () => {
    const view = focusView(sample(), 'db');
    expect(ids(view.nodes)).toEqual(['db', 'deep', 'legacy', 'worker']);
  });

  it('un ciclo no duplica flechas', () => {
    const g = sample();
    g.edges.push(edge('deep', 'api'));
    const view = focusView(g, 'api');
    expect(view.edges.filter((e) => e.id === 'deep->api:80')).toHaveLength(1);
  });

  it('en una entrada, a donde lleva: un salto', () => {
    expect(ids(focusView(sample(), 'gw').nodes)).toEqual(['gw', 'internet', 'shop', 'web']);
    expect(ids(focusView(sample(), 'internet').nodes)).toEqual(['gw', 'internet', 'legacy']);
  });

  it('el ramal de un servicio no sigue flechas de entrada, aunque salgan de el', () => {
    const g = sample();
    g.edges.push(edge('api', 'shop', 'enruta'));
    expect(ids(focusView(g, 'api').nodes)).not.toContain('shop');
  });

  it('un id que no existe no rompe: sin nodos', () => {
    expect(focusView(sample(), 'fantasma').nodes).toEqual([]);
  });

  it('una conexion caida hacia algo que no esta entre los nodos se nombra por su id', () => {
    const g = sample();
    g.edges.push(edge('web', 'n_perdido', 'llama', ProbeState.Down, '9000'));
    expect(centralView(g).branches.get('web')?.failing).toContain('web → n_perdido:9000');
  });

  it('una entrada sin rutas se enseña sola', () => {
    expect(ids(focusView(graphOf([entry('gw', 'gateway')], []), 'gw').nodes)).toEqual(['gw']);
  });

  it('un origen que no esta entre los nodos tambien se nombra por su id', () => {
    const g = sample();
    g.edges.push(edge('n_origen', 'web', 'llama', ProbeState.Down, '9001'));
    expect(centralView(g).branches.get('web')?.failing).toContain('n_origen → web:9001');
  });

  it('un nodo sin flechas se enseña solo', () => {
    const g = graphOf([node('solo')], []);
    expect(ids(focusView(g, 'solo').nodes)).toEqual(['solo']);
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
