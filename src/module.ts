import { PanelPlugin } from '@grafana/data';

import { MapaPanel } from './components/MapaPanel';
import { ServiceMapOptions, defaultOptions } from './types';

export const plugin = new PanelPlugin<ServiceMapOptions>(MapaPanel).setPanelOptions((builder) =>
  builder
    .addRadio({
      path: 'direction',
      name: 'Direccion del layout',
      description: 'Por capas de izquierda a derecha, o de arriba abajo.',
      defaultValue: defaultOptions.direction,
      settings: {
        options: [
          { value: 'LR', label: 'Izquierda → derecha' },
          { value: 'TB', label: 'Arriba → abajo' },
        ],
      },
    })
    .addTextInput({
      path: 'nodeLink',
      name: 'Enlace al hacer clic en un nodo',
      description:
        'URL con huecos del nodo pulsado: ${nodo.servicio}, ${nodo.tipo}, ${nodo.namespace}, ' +
        '${nodo.cluster}, ${nodo.id}. Admite tambien variables del dashboard ($cluster, ${__from}, ${__to}). ' +
        'Con ${nodo.tipo} en la ruta, una sola plantilla lleva a un dashboard distinto por clase de servicio. ' +
        'Vacio: el clic no hace nada. Ctrl o Cmd + clic abre en pestaña nueva.',
      defaultValue: defaultOptions.nodeLink,
      settings: {
        placeholder: '/d/tipo-${nodo.tipo}?var-servicio=${nodo.servicio}&from=${__from}&to=${__to}',
      },
    })
);
