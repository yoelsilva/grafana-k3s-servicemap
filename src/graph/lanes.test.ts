import { GraphEdge, GraphNode, ServiceKind } from '../types';
import {
  LANE_LABELS,
  LANE_ORDER,
  MIN_SHARED_CALLERS,
  Placed,
  SHARED_KINDS,
  bandPositions,
  classifyLanes,
  laneBoxes,
} from './lanes';

function node(id: string, kind: ServiceKind = 'other', external = false): GraphNode {
  return {
    id,
    label: id,
    cluster: '',
    namespace: '',
    external,
    incoming: 0,
    outgoing: 0,
    incomingDown: 0,
    kind,
  };
}

function edge(source: string, target: string, port = '80'): GraphEdge {
  return { id: `${source}->${target}:${port}`, source, target, port, envKey: '', dstSvc: '', dstAddr: '', state: 1 };
}

const SIZE = { width: 170, height: 46 };

describe('classifyLanes', () => {
  it('una base de datos que usan varios va a compartidos', () => {
    const lanes = classifyLanes(
      [node('a'), node('b'), node('db', 'postgres')],
      [edge('a', 'db'), edge('b', 'db')]
    );

    expect(lanes.get('db')).toBe('compartido');
    expect(lanes.get('a')).toBe('aplicacion');
  });

  it('un Redis privado de un solo servicio se queda con las aplicaciones', () => {
    const lanes = classifyLanes([node('a'), node('cache', 'redis')], [edge('a', 'cache')]);

    expect(lanes.get('cache')).toBe('aplicacion');
  });

  it('dos flechas del mismo servicio cuentan como un solo llamador', () => {
    // Mismo origen, dos puertos: sigue siendo de uno solo, no compartido.
    const lanes = classifyLanes([node('a'), node('q', 'kafka')], [edge('a', 'q', '9092'), edge('a', 'q', '9093')]);

    expect(lanes.get('q')).toBe('aplicacion');
  });

  it('infraestructura compartida fuera del cluster sigue siendo compartida', () => {
    // El Postgres en una maquina suelta que usan todos es, ante todo, la BD comun.
    const lanes = classifyLanes(
      [node('a'), node('b'), node('pg', 'postgres', true)],
      [edge('a', 'pg'), edge('b', 'pg')]
    );

    expect(lanes.get('pg')).toBe('compartido');
  });

  it('lo externo que no es infraestructura compartida va a externos', () => {
    const lanes = classifyLanes(
      [node('a'), node('b'), node('pagos', 'http', true)],
      [edge('a', 'pagos'), edge('b', 'pagos')]
    );

    expect(lanes.get('pagos')).toBe('externo');
  });

  it('infraestructura externa con un solo llamador va a externos', () => {
    const lanes = classifyLanes([node('a'), node('mq', 'mqtt', true)], [edge('a', 'mq')]);

    expect(lanes.get('mq')).toBe('externo');
  });

  it('un servicio de aplicacion muy usado no es infraestructura', () => {
    const lanes = classifyLanes(
      [node('a'), node('b'), node('c'), node('core', 'grpc')],
      [edge('a', 'core'), edge('b', 'core'), edge('c', 'core')]
    );

    expect(lanes.get('core')).toBe('aplicacion');
  });

  it('un autobucle no cuenta como llamador', () => {
    const lanes = classifyLanes([node('a'), node('db', 'postgres')], [edge('db', 'db'), edge('a', 'db')]);

    expect(lanes.get('db')).toBe('aplicacion');
  });

  it('un nodo sin flechas entrantes es aplicacion', () => {
    expect(classifyLanes([node('solo')], []).get('solo')).toBe('aplicacion');
  });

  it('las constantes dicen lo que la documentacion promete', () => {
    expect(MIN_SHARED_CALLERS).toBe(2);
    expect([...LANE_ORDER]).toEqual(['aplicacion', 'compartido', 'externo']);
    expect(SHARED_KINDS.has('grpc')).toBe(false);
    expect(SHARED_KINDS.has('http')).toBe(false);
    expect(SHARED_KINDS.has('other')).toBe(false);
    expect(LANE_LABELS.compartido).toBe('Servicios compartidos');
  });
});

describe('bandPositions', () => {
  it('sin nodos no mueve nada', () => {
    expect(bandPositions([], 'LR', SIZE, 90).size).toBe(0);
  });

  it('la primera franja se queda donde la puso dagre', () => {
    const placed: Placed[] = [
      { id: 'a', x: 100, y: 10, lane: 'aplicacion' },
      { id: 'b', x: 300, y: 50, lane: 'aplicacion' },
    ];

    const out = bandPositions(placed, 'LR', SIZE, 90);

    expect(out.get('a')).toEqual({ x: 100, y: 10 });
    expect(out.get('b')).toEqual({ x: 300, y: 50 });
  });

  it('en horizontal, la franja siguiente empieza despues de la anterior mas el hueco', () => {
    // Dagre puso la BD compartida en la misma columna que una app: se tienen que separar.
    const placed: Placed[] = [
      { id: 'app', x: 500, y: 0, lane: 'aplicacion' },
      { id: 'db', x: 500, y: 100, lane: 'compartido' },
    ];

    const out = bandPositions(placed, 'LR', SIZE, 90);

    // Fin de aplicaciones: 500 + 85 = 585. Mas 90 de hueco = 675. Inicio de la BD: 675 + 85.
    expect(out.get('db')).toEqual({ x: 760, y: 100 });
  });

  it('no toca el eje cruzado', () => {
    const placed: Placed[] = [
      { id: 'app', x: 0, y: 7, lane: 'aplicacion' },
      { id: 'db', x: 0, y: 333, lane: 'compartido' },
    ];

    expect(bandPositions(placed, 'LR', SIZE, 90).get('db')!.y).toBe(333);
  });

  it('conserva las distancias dentro de una franja', () => {
    const placed: Placed[] = [
      { id: 'app', x: 0, y: 0, lane: 'aplicacion' },
      { id: 'db1', x: 10, y: 0, lane: 'compartido' },
      { id: 'db2', x: 60, y: 0, lane: 'compartido' },
    ];

    const out = bandPositions(placed, 'LR', SIZE, 90);

    expect(out.get('db2')!.x - out.get('db1')!.x).toBe(50);
  });

  it('respeta el orden aunque falte la franja del medio', () => {
    const placed: Placed[] = [
      { id: 'app', x: 0, y: 0, lane: 'aplicacion' },
      { id: 'ext', x: 0, y: 0, lane: 'externo' },
    ];

    // Sin compartidos, externos va justo detras de aplicaciones.
    expect(bandPositions(placed, 'LR', SIZE, 90).get('ext')!.x).toBe(85 + 90 + 85);
  });

  it('si solo hay externos, se quedan donde estaban', () => {
    const placed: Placed[] = [{ id: 'ext', x: 42, y: 5, lane: 'externo' }];

    expect(bandPositions(placed, 'LR', SIZE, 90).get('ext')).toEqual({ x: 42, y: 5 });
  });

  it('en vertical separa por la altura, no por la anchura', () => {
    const placed: Placed[] = [
      { id: 'app', x: 3, y: 100, lane: 'aplicacion' },
      { id: 'db', x: 9, y: 100, lane: 'compartido' },
    ];

    const out = bandPositions(placed, 'TB', SIZE, 90);

    // Fin de aplicaciones: 100 + 23 = 123. Mas 90 = 213. Inicio de la BD: 213 + 23.
    expect(out.get('db')).toEqual({ x: 9, y: 236 });
  });
});

describe('laneBoxes', () => {
  it('sin nodos no hay cajas', () => {
    expect(laneBoxes([], 'LR', SIZE, 20, 30)).toEqual([]);
  });

  it('una caja por franja con nodos, en orden y con su nombre', () => {
    const placed: Placed[] = [
      { id: 'ext', x: 900, y: 0, lane: 'externo' },
      { id: 'app', x: 0, y: 0, lane: 'aplicacion' },
    ];

    const boxes = laneBoxes(placed, 'LR', SIZE, 20, 30);

    expect(boxes.map((b) => b.lane)).toEqual(['aplicacion', 'externo']);
    expect(boxes[0].label).toBe('Aplicaciones');
  });

  it('en horizontal todas abarcan la altura del mapa entero', () => {
    const placed: Placed[] = [
      { id: 'a1', x: 0, y: 0, lane: 'aplicacion' },
      { id: 'a2', x: 0, y: 400, lane: 'aplicacion' },
      { id: 'db', x: 500, y: 200, lane: 'compartido' },
    ];

    const [apps, shared] = laneBoxes(placed, 'LR', SIZE, 20, 30);

    // De 0-23-20-30 = -73 a 400+23+20 = 443.
    expect(apps.height).toBe(516);
    expect(shared.height).toBe(apps.height);
    expect(shared.y).toBe(apps.y);
  });

  it('en horizontal cada caja es tan ancha como sus nodos mas el margen', () => {
    const placed: Placed[] = [{ id: 'db', x: 500, y: 0, lane: 'compartido' }];

    const [box] = laneBoxes(placed, 'LR', SIZE, 20, 30);

    expect(box.width).toBe(170 + 40);
    expect(box.x).toBe(500);
  });

  it('en vertical abarcan la anchura del mapa entero y el titulo va arriba', () => {
    const placed: Placed[] = [
      { id: 'a1', x: 0, y: 0, lane: 'aplicacion' },
      { id: 'a2', x: 600, y: 0, lane: 'aplicacion' },
      { id: 'db', x: 300, y: 300, lane: 'compartido' },
    ];

    const [apps, shared] = laneBoxes(placed, 'TB', SIZE, 20, 30);

    // Anchura: de 0-85-20 = -105 a 600+85+20 = 705.
    expect(apps.width).toBe(810);
    expect(shared.width).toBe(apps.width);
    // Alto de una fila de un solo nivel: 46 + 2*20 de margen + 30 de titulo.
    expect(shared.height).toBe(46 + 40 + 30);
  });
});
