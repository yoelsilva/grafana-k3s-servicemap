import { PanelPlugin } from '@grafana/data';

import { MapaPanel } from './components/MapaPanel';
import { ServiceMapOptions, defaultOptions } from './types';

export const plugin = new PanelPlugin<ServiceMapOptions>(MapaPanel).setPanelOptions((builder) =>
  builder.addRadio({
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
);
