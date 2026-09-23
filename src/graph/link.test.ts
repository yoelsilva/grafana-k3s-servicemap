import { GraphNode } from '../types';
import { LINK_PLACEHOLDERS, fillNodeLink, isExternalLink } from './link';

const NODE: GraphNode = {
  id: 'n_postgres_main',
  label: 'postgres-main',
  cluster: 'production',
  namespace: 'platform',
  external: false,
  incoming: 3,
  outgoing: 0,
  incomingDown: 0,
  kind: 'postgres',
};

describe('fillNodeLink', () => {
  it('sin plantilla no hay enlace', () => {
    expect(fillNodeLink('', NODE)).toBeNull();
  });

  it('una plantilla de solo espacios cuenta como vacia', () => {
    expect(fillNodeLink('   ', NODE)).toBeNull();
  });

  it('rellena todos los huecos', () => {
    const url = fillNodeLink(
      '/d/x?s=${nodo.servicio}&t=${nodo.tipo}&ns=${nodo.namespace}&c=${nodo.cluster}&id=${nodo.id}',
      NODE
    );

    expect(url).toBe('/d/x?s=postgres-main&t=postgres&ns=platform&c=production&id=n_postgres_main');
  });

  it('con el tipo en la ruta, una sola plantilla lleva a un dashboard por clase', () => {
    expect(fillNodeLink('/d/tipo-${nodo.tipo}', NODE)).toBe('/d/tipo-postgres');
    expect(fillNodeLink('/d/tipo-${nodo.tipo}', { ...NODE, kind: 'redis' })).toBe('/d/tipo-redis');
  });

  it('un hueco repetido se rellena todas las veces', () => {
    expect(fillNodeLink('${nodo.tipo}-${nodo.tipo}', NODE)).toBe('postgres-postgres');
  });

  it('codifica los valores para URL', () => {
    const url = fillNodeLink('/d/x?s=${nodo.servicio}', { ...NODE, label: 'mqtt broker & co' });

    expect(url).toBe('/d/x?s=mqtt%20broker%20%26%20co');
  });

  it('un $ en el nombre no puede colarse como variable de Grafana', () => {
    // Si llegara `$cluster` literal, replaceVariables lo interpolaria despues.
    const url = fillNodeLink('/d/x?s=${nodo.servicio}', { ...NODE, label: '$cluster' });

    expect(url).toBe('/d/x?s=%24cluster');
  });

  it('un id compuesto de multi-cluster queda codificado', () => {
    expect(fillNodeLink('${nodo.id}', { ...NODE, id: 'production/n_x' })).toBe('production%2Fn_x');
  });

  it('un namespace vacio deja el hueco vacio', () => {
    expect(fillNodeLink('ns=${nodo.namespace}', { ...NODE, namespace: '' })).toBe('ns=');
  });

  it('deja intactas las variables del dashboard para que las resuelva Grafana', () => {
    const url = fillNodeLink('/d/x?c=$cluster&s=${servicio}&from=${__from}&n=${nodo.servicio}', NODE);

    expect(url).toBe('/d/x?c=$cluster&s=${servicio}&from=${__from}&n=postgres-main');
  });

  it('un hueco que no existe se deja tal cual', () => {
    expect(fillNodeLink('/d/x?q=${nodo.loquesea}', NODE)).toBe('/d/x?q=${nodo.loquesea}');
  });

  it('quita los espacios de alrededor de la plantilla', () => {
    expect(fillNodeLink('  /d/x  ', NODE)).toBe('/d/x');
  });

  it('expone exactamente los cinco huecos documentados', () => {
    expect([...LINK_PLACEHOLDERS]).toEqual(['servicio', 'tipo', 'namespace', 'cluster', 'id']);
  });
});

describe('isExternalLink', () => {
  it.each([
    ['https://wiki.example.com/runbook', true],
    ['http://10.0.0.9:8080', true],
    ['HTTPS://EXAMPLE.COM', true],
    ['  https://example.com', true],
    ['/d/tipo-postgres', false],
    ['d/tipo-postgres', false],
    ['?var-x=1', false],
    ['', false],
  ])('%p es externo: %p', (url, expected) => {
    expect(isExternalLink(url)).toBe(expected);
  });
});
