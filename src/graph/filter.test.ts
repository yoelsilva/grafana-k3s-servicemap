import { ALL_VALUE, activeFilter, isFilteredBy, nextFilterValue, toFilterVariable } from './filter';

const servicio = (value: unknown, includeAll = true, type = 'query') => ({
  name: 'servicio',
  type,
  includeAll,
  current: { value },
});

describe('toFilterVariable', () => {
  it('normaliza un valor multiple', () => {
    expect(toFilterVariable([servicio(['a', 'b'])], 'servicio')).toEqual({
      name: 'servicio',
      includeAll: true,
      values: ['a', 'b'],
    });
  });

  it('normaliza un valor simple y el nombre con espacios', () => {
    expect(toFilterVariable([servicio('a', false, 'custom')], ' servicio ')).toEqual({
      name: 'servicio',
      includeAll: false,
      values: ['a'],
    });
  });

  it('sin valor actual, lista vacia', () => {
    expect(toFilterVariable([{ name: 'servicio', type: 'query' }], 'servicio')?.values).toEqual([]);
  });

  it('null si no existe, si el nombre esta vacio o si no es seleccionable', () => {
    expect(toFilterVariable([servicio('a')], 'otra')).toBeNull();
    expect(toFilterVariable([servicio('a')], '  ')).toBeNull();
    expect(toFilterVariable([servicio('a', true, 'interval')], 'servicio')).toBeNull();
    expect(toFilterVariable([null, 'x', servicio('a')], 'servicio')?.values).toEqual(['a']);
  });
});

describe('nextFilterValue', () => {
  it('filtra por el nodo pulsado', () => {
    expect(nextFilterValue({ name: 's', includeAll: true, values: [ALL_VALUE] }, 'a')).toBe('a');
    expect(nextFilterValue({ name: 's', includeAll: true, values: ['a', 'b'] }, 'a')).toBe('a');
  });

  it('pulsar el nodo ya filtrado vuelve a All', () => {
    expect(nextFilterValue({ name: 's', includeAll: true, values: ['a'] }, 'a')).toBe(ALL_VALUE);
  });

  it('sin All no hay a donde volver', () => {
    expect(nextFilterValue({ name: 's', includeAll: false, values: ['a'] }, 'a')).toBeNull();
  });
});

describe('isFilteredBy y activeFilter', () => {
  it('solo cuenta como filtrado por un valor si es el unico', () => {
    expect(isFilteredBy({ name: 's', includeAll: true, values: ['a'] }, 'a')).toBe(true);
    expect(isFilteredBy({ name: 's', includeAll: true, values: ['a', 'b'] }, 'a')).toBe(false);
  });

  it('All y ninguna variable no filtran nada', () => {
    expect(activeFilter(null).size).toBe(0);
    expect(activeFilter({ name: 's', includeAll: true, values: [ALL_VALUE] }).size).toBe(0);
    expect([...activeFilter({ name: 's', includeAll: true, values: ['a', 'b'] })]).toEqual(['a', 'b']);
  });
});
