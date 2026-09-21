import { FieldType, toDataFrame, type DataFrame, type Field } from '@grafana/data';

import { ProbeState } from '../types';
import { buildGraph, isDeclaredKind, resolveKind } from './build';

/** Una fila completa del contrato §2; los tests sobrescriben lo que les toca. */
interface RowInput {
  cluster?: string;
  namespace?: string;
  src?: string;
  src_id?: string;
  src_tipo?: string;
  dst?: string;
  dst_id?: string;
  dst_svc?: string;
  dst_addr?: string;
  dst_port?: string;
  dst_ns?: string;
  clave?: string;
  dst_kind?: string;
  externo?: string | boolean | number;
  Value?: number;
}

const BASE: Required<Omit<RowInput, 'externo' | 'Value'>> & { externo: string; Value: number } = {
  cluster: 'production',
  namespace: 'platform',
  src: 'api-gateway',
  src_id: 'n_api_gateway',
  src_tipo: 'deployment',
  dst: 'media-service',
  dst_id: 'n_media',
  dst_svc: 'media-svc-grpc',
  dst_addr: 'media-svc-grpc',
  dst_port: '50072',
  dst_ns: 'platform',
  clave: 'MEDIA_SERVICE_URL',
  dst_kind: '',
  externo: 'false',
  Value: ProbeState.Up,
};

/** Construye un frame en formato tabla, como el que devuelve Prometheus. */
function frameOf(rows: RowInput[], opts: { valueFieldName?: string; omit?: string[] } = {}): DataFrame {
  const merged = rows.map((row) => ({ ...BASE, ...row }));
  const columns = Object.keys(BASE).filter((name) => !(opts.omit ?? []).includes(name));

  const fields = columns.map((name) => {
    const isValue = name === 'Value';
    return {
      name: isValue ? (opts.valueFieldName ?? 'Value') : name,
      type: isValue ? FieldType.number : FieldType.string,
      values: merged.map((row) => row[name as keyof typeof BASE]),
    };
  });

  return toDataFrame({ fields });
}

describe('buildGraph', () => {
  it('sin series devuelve un grafo vacio', () => {
    const graph = buildGraph([]);

    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.warnings).toEqual([]);
    expect(graph.rowCount).toBe(0);
  });

  it('una fila produce dos nodos y una flecha', () => {
    const graph = buildGraph([frameOf([{}])]);

    expect(graph.rowCount).toBe(1);
    expect(graph.nodes.map((n) => n.id)).toEqual(['n_api_gateway', 'n_media']);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({
      id: 'n_api_gateway->n_media:50072',
      source: 'n_api_gateway',
      target: 'n_media',
      port: '50072',
      envKey: 'MEDIA_SERVICE_URL',
      dstSvc: 'media-svc-grpc',
      state: ProbeState.Up,
    });
  });

  it('cuenta entrantes, salientes y entrantes caidas', () => {
    const graph = buildGraph([
      frameOf([
        {},
        { dst: 'cache', dst_id: 'n_cache', dst_port: '6379', Value: ProbeState.Down },
        { src: 'billing', src_id: 'n_billing', dst_port: '50072' },
      ]),
    ]);

    const gateway = graph.nodes.find((n) => n.id === 'n_api_gateway')!;
    const media = graph.nodes.find((n) => n.id === 'n_media')!;
    const redis = graph.nodes.find((n) => n.id === 'n_cache')!;

    expect(gateway).toMatchObject({ incoming: 0, outgoing: 2, incomingDown: 0 });
    expect(media).toMatchObject({ incoming: 2, outgoing: 0, incomingDown: 0 });
    expect(redis).toMatchObject({ incoming: 1, outgoing: 0, incomingDown: 1 });
  });

  it('el mismo servicio es origen y destino sin duplicar nodo', () => {
    const graph = buildGraph([
      frameOf([
        { dst: 'core-service', dst_id: 'n_core' },
        { src: 'core-service', src_id: 'n_core', dst: 'cache', dst_id: 'n_cache' },
      ]),
    ]);

    expect(graph.nodes.map((n) => n.id)).toEqual(['n_api_gateway', 'n_core', 'n_cache']);
    const control = graph.nodes.find((n) => n.id === 'n_core')!;
    expect(control).toMatchObject({ incoming: 1, outgoing: 1 });
  });

  it('dos puertos entre los mismos nodos son dos flechas', () => {
    const graph = buildGraph([frameOf([{}, { dst_port: '50073' }])]);

    expect(graph.edges.map((e) => e.id)).toEqual(['n_api_gateway->n_media:50072', 'n_api_gateway->n_media:50073']);
    expect(graph.nodes).toHaveLength(2);
  });

  it('una fila repetida no colisiona de id', () => {
    const graph = buildGraph([frameOf([{}, {}])]);

    expect(graph.edges.map((e) => e.id)).toEqual(['n_api_gateway->n_media:50072', 'n_api_gateway->n_media:50072#1']);
  });

  describe('externo', () => {
    it('marca el nodo destino como externo', () => {
      const graph = buildGraph([
        frameOf([{ dst: 'events-storage', dst_id: 'n_events', dst_svc: '', externo: 'true', Value: ProbeState.Down }]),
      ]);

      expect(graph.nodes.find((n) => n.id === 'n_events')).toMatchObject({ external: true, incomingDown: 1 });
    });

    it('un nodo que tambien es origen nunca es externo', () => {
      const graph = buildGraph([
        frameOf([
          { dst: 'core-service', dst_id: 'n_core', externo: 'true' },
          { src: 'core-service', src_id: 'n_core', dst: 'cache', dst_id: 'n_cache' },
        ]),
      ]);

      expect(graph.nodes.find((n) => n.id === 'n_core')!.external).toBe(false);
    });

    it.each([
      ['true', true],
      ['TRUE', true],
      [' true ', true],
      ['false', false],
      ['', false],
      [true, true],
      [false, false],
      [1, true],
      [0, false],
    ])('interpreta externo=%p como %p', (input, expected) => {
      const graph = buildGraph([frameOf([{ dst_id: 'n_x', externo: input }])]);

      expect(graph.nodes.find((n) => n.id === 'n_x')!.external).toBe(expected);
    });

    it('sin la etiqueta externo nada es externo', () => {
      const graph = buildGraph([frameOf([{}], { omit: ['externo'] })]);

      expect(graph.nodes.every((n) => !n.external)).toBe(true);
    });
  });

  describe('namespace', () => {
    it('el origen lleva su namespace y el destino el suyo', () => {
      const graph = buildGraph([frameOf([{ namespace: 'platform', dst_ns: 'brokers' }])]);

      expect(graph.nodes.find((n) => n.id === 'n_api_gateway')!.namespace).toBe('platform');
      expect(graph.nodes.find((n) => n.id === 'n_media')!.namespace).toBe('brokers');
    });

    it('un destino sin namespace lo deja vacio', () => {
      // Es lo que emite el mapper cuando de verdad esta fuera del cluster.
      const graph = buildGraph([frameOf([{ dst_ns: '', externo: 'true' }])]);

      expect(graph.nodes.find((n) => n.id === 'n_media')!.namespace).toBe('');
    });

    it('el namespace del origen gana al que traia como destino', () => {
      const graph = buildGraph([
        frameOf([
          { dst: 'core', dst_id: 'n_core', dst_ns: 'equivocado' },
          { src: 'core', src_id: 'n_core', namespace: 'elbueno', dst: 'x', dst_id: 'n_x' },
        ]),
      ]);

      expect(graph.nodes.find((n) => n.id === 'n_core')!.namespace).toBe('elbueno');
    });

    it('sin la etiqueta dst_ns los destinos quedan sin namespace', () => {
      const graph = buildGraph([frameOf([{}], { omit: ['dst_ns'] })]);

      expect(graph.nodes.find((n) => n.id === 'n_media')!.namespace).toBe('');
    });
  });

  describe('Value', () => {
    it.each([
      [0, ProbeState.Down],
      [1, ProbeState.Up],
      [2, ProbeState.NotProbed],
      [7, ProbeState.NotProbed],
      [NaN, ProbeState.NotProbed],
    ])('mapea Value=%p a %p', (input, expected) => {
      const graph = buildGraph([frameOf([{ Value: input }])]);

      expect(graph.edges[0].state).toBe(expected);
    });

    it('acepta el nombre "Value #A" de las queries multiples', () => {
      const graph = buildGraph([frameOf([{ Value: ProbeState.Down }], { valueFieldName: 'Value #A' })]);

      expect(graph.edges[0].state).toBe(ProbeState.Down);
    });

    it('sin campo de valor todo queda como no sondeado', () => {
      const graph = buildGraph([frameOf([{}], { omit: ['Value'] })]);

      expect(graph.edges[0].state).toBe(ProbeState.NotProbed);
    });
  });

  describe('multi-cluster', () => {
    it('con un solo cluster el id de nodo va limpio', () => {
      const graph = buildGraph([frameOf([{}])]);

      expect(graph.nodes[0].id).toBe('n_api_gateway');
    });

    it('con varios clusteres el id se compone', () => {
      const graph = buildGraph([frameOf([{ cluster: 'production' }, { cluster: 'staging' }])]);

      expect(graph.nodes.map((n) => n.id)).toEqual([
        'production/n_api_gateway',
        'production/n_media',
        'staging/n_api_gateway',
        'staging/n_media',
      ]);
      expect(graph.edges[0].source).toBe('production/n_api_gateway');
    });

    it('una fila sin cluster no se compone aunque haya varios', () => {
      const graph = buildGraph([
        frameOf([{ cluster: 'production' }, { cluster: 'staging' }, { cluster: '', src_id: 'n_suelto' }]),
      ]);

      expect(graph.nodes.map((n) => n.id)).toContain('n_suelto');
    });

    it('sin la etiqueta cluster los ids van limpios', () => {
      const graph = buildGraph([frameOf([{}], { omit: ['cluster'] })]);

      expect(graph.nodes[0].id).toBe('n_api_gateway');
      expect(graph.nodes[0].cluster).toBe('');
    });
  });

  describe('etiquetas', () => {
    it('el nombre del workload gana al del destino', () => {
      const graph = buildGraph([
        frameOf([
          { dst: 'alias-raro', dst_id: 'n_core' },
          { src: 'core-service', src_id: 'n_core', dst: 'cache', dst_id: 'n_cache' },
        ]),
      ]);

      expect(graph.nodes.find((n) => n.id === 'n_core')!.label).toBe('core-service');
    });

    it('un nombre vacio cae al id', () => {
      const graph = buildGraph([frameOf([{ src: '', dst: '' }])]);

      expect(graph.nodes.map((n) => n.label)).toEqual(['n_api_gateway', 'n_media']);
    });

    it('un origen sin nombre no pisa la etiqueta ya puesta', () => {
      const graph = buildGraph([
        frameOf([
          { dst: 'core-service', dst_id: 'n_core' },
          { src: '', src_id: 'n_core', dst: 'cache', dst_id: 'n_cache' },
        ]),
      ]);

      expect(graph.nodes.find((n) => n.id === 'n_core')!.label).toBe('core-service');
    });

    it('un valor nulo se lee como cadena vacia', () => {
      const frame = frameOf([{}]);
      const svc = frame.fields.find((f: Field) => f.name === 'dst_svc')!;
      (svc.values as unknown as unknown[])[0] = null;

      const graph = buildGraph([frame]);

      expect(graph.edges[0].dstSvc).toBe('');
    });

    it('lee frames construidos a mano, sin pasar por toDataFrame', () => {
      const plain: DataFrame = {
        length: 1,
        fields: [
          { name: 'src', type: FieldType.string, config: {}, values: ['api-gateway'] },
          { name: 'src_id', type: FieldType.string, config: {}, values: ['n_api_gateway'] },
          { name: 'dst', type: FieldType.string, config: {}, values: ['media-service'] },
          { name: 'dst_id', type: FieldType.string, config: {}, values: ['n_media'] },
          { name: 'dst_port', type: FieldType.string, config: {}, values: ['50072'] },
          { name: 'Value', type: FieldType.number, config: {}, values: [ProbeState.Down] },
        ],
      };

      const graph = buildGraph([plain]);

      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]).toMatchObject({ port: '50072', state: ProbeState.Down });
      expect(graph.nodes.find((n) => n.id === 'n_media')!.incomingDown).toBe(1);
    });

  });

  describe('datos incompletos', () => {
    it('avisa y descarta las filas sin src_id', () => {
      const graph = buildGraph([frameOf([{}, { src_id: '' }])]);

      expect(graph.edges).toHaveLength(1);
      expect(graph.rowCount).toBe(2);
      expect(graph.warnings).toHaveLength(1);
      expect(graph.warnings[0]).toContain('1 fila(s) sin src_id o dst_id');
      expect(graph.warnings[0]).toContain('>= 0.2.0');
    });

    it('descarta tambien las filas sin dst_id', () => {
      const graph = buildGraph([frameOf([{ dst_id: '' }])]);

      expect(graph.edges).toHaveLength(0);
      expect(graph.warnings[0]).toContain('1 fila(s)');
    });

    it('avisa de las etiquetas que faltan y no inventa nodos', () => {
      const graph = buildGraph([frameOf([{}], { omit: ['src_id', 'dst_port'] })]);

      expect(graph.nodes).toEqual([]);
      expect(graph.warnings).toHaveLength(1);
      expect(graph.warnings[0]).toContain('Faltan etiquetas en los datos: dst_port, src_id');
    });

    it('junta las etiquetas que faltan de varios frames sin repetirlas', () => {
      const graph = buildGraph([frameOf([{}], { omit: ['src_id'] }), frameOf([{}], { omit: ['src_id', 'dst'] })]);

      expect(graph.warnings).toHaveLength(1);
      expect(graph.warnings[0]).toContain('dst, src_id');
    });
  });

  describe('clase de servicio', () => {
    it.each([
      ['5432', 'postgres'],
      ['3306', 'mysql'],
      ['27017', 'mongo'],
      ['6379', 'redis'],
      ['9092', 'kafka'],
      ['5672', 'amqp'],
      ['1883', 'mqtt'],
      ['9000', 'storage'],
      ['9200', 'search'],
      ['587', 'smtp'],
      ['443', 'http'],
      ['50051', 'grpc'],
      ['50099', 'grpc'],
    ])('deduce el puerto %s como %s', (port, expected) => {
      expect(resolveKind('', port)).toBe(expected);
    });

    it.each([['50050'], ['50100'], ['8080'], ['3000'], [''], ['no-es-un-numero']])(
      'el puerto %p no identifica nada y cae en other',
      (port) => {
        expect(resolveKind('', port)).toBe('other');
      }
    );

    it('la etiqueta del mapper gana al puerto', () => {
      // Postgres escuchando en el puerto de Redis: el mapper lo sabe, el puerto miente.
      expect(resolveKind('postgres', '6379')).toBe('postgres');
    });

    it('acepta la etiqueta con mayusculas y espacios', () => {
      expect(resolveKind('  Redis  ', '')).toBe('redis');
    });

    it('una etiqueta desconocida se ignora y se cae al puerto', () => {
      expect(resolveKind('cosarara', '5432')).toBe('postgres');
    });

    it.each([
      ['postgres', true],
      ['REDIS', true],
      ['  mqtt  ', true],
      ['other', false],
      ['OTHER', false],
      ['', false],
      ['cosarara', false],
    ])('isDeclaredKind(%p) es %p', (raw, expected) => {
      expect(isDeclaredKind(raw)).toBe(expected);
    });

    it('un "other" declarado no apaga la deduccion por puerto', () => {
      // El mapper 0.3.0 manda la etiqueta vacia cuando no sabe, pero si algun
      // dia emitiera "other" no debe pisar lo que el puerto si identifica.
      expect(resolveKind('other', '5432')).toBe('postgres');
      expect(resolveKind('OTHER', '6379')).toBe('redis');
      expect(resolveKind('other', '8080')).toBe('other');
    });

    it('un "other" declarado no bloquea una clase que llegue despues', () => {
      const graph = buildGraph([
        frameOf([
          { dst: 'x', dst_id: 'n_x', dst_port: '8080', dst_kind: 'other' },
          { dst: 'x', dst_id: 'n_x', dst_port: '8080', dst_kind: 'redis' },
        ]),
      ]);

      expect(graph.nodes.find((n) => n.id === 'n_x')!.kind).toBe('redis');
    });

    it('marca el nodo destino con su clase', () => {
      const graph = buildGraph([
        frameOf([{ dst: 'db', dst_id: 'n_db', dst_port: '5432' }, { dst_port: '6379', dst_id: 'n_cache' }]),
      ]);

      expect(graph.nodes.find((n) => n.id === 'n_db')!.kind).toBe('postgres');
      expect(graph.nodes.find((n) => n.id === 'n_cache')!.kind).toBe('redis');
    });

    it('un nodo con dos puertos se queda con el primero que lo identifica', () => {
      const graph = buildGraph([
        frameOf([
          { dst: 'events', dst_id: 'n_events', dst_port: '9092' },
          { dst: 'events', dst_id: 'n_events', dst_port: '9000' },
        ]),
      ]);

      expect(graph.nodes.find((n) => n.id === 'n_events')!.kind).toBe('kafka');
    });

    it('la etiqueta del mapper pisa a una clase ya deducida', () => {
      const graph = buildGraph([
        frameOf([
          { dst: 'raro', dst_id: 'n_raro', dst_port: '6379' },
          { dst: 'raro', dst_id: 'n_raro', dst_port: '6379', dst_kind: 'mongo' },
        ]),
      ]);

      expect(graph.nodes.find((n) => n.id === 'n_raro')!.kind).toBe('mongo');
    });

    it('una clase deducida no pisa a la que declaro el mapper', () => {
      const graph = buildGraph([
        frameOf([
          { dst: 'raro', dst_id: 'n_raro', dst_port: '5432', dst_kind: 'mongo' },
          { dst: 'raro', dst_id: 'n_raro', dst_port: '5432' },
        ]),
      ]);

      expect(graph.nodes.find((n) => n.id === 'n_raro')!.kind).toBe('mongo');
    });

    it('sin la etiqueta dst_kind todo se deduce del puerto', () => {
      const graph = buildGraph([frameOf([{ dst_port: '5432' }], { omit: ['dst_kind'] })]);

      expect(graph.nodes[1].kind).toBe('postgres');
    });

    it('un origen que nunca es destino se queda en other', () => {
      const graph = buildGraph([frameOf([{}])]);

      expect(graph.nodes[0].kind).toBe('other');
    });
  });

  it('suma las filas de varios frames', () => {
    const graph = buildGraph([
      frameOf([{}]),
      frameOf([{ src: 'billing', src_id: 'n_billing', dst: 'cache', dst_id: 'n_cache' }]),
    ]);

    expect(graph.rowCount).toBe(2);
    expect(graph.edges).toHaveLength(2);
    expect(graph.nodes).toHaveLength(4);
  });
});
