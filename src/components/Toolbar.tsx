import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { RadioButtonGroup, ToolbarButton, ToolbarButtonRow, useStyles2 } from '@grafana/ui';
import React from 'react';

import { MapView } from '../types';

interface Props {
  onFit: () => void;
  onRelayout: () => void;
  /**
   * Vista actual. Sin ella no se enseña el conmutador: con un servicio filtrado se ve
   * siempre su ramal, y sin entradas en los datos no hay vista central posible.
   */
  view?: MapView;
  onViewChange: (view: MapView) => void;
}

const VIEW_OPTIONS: Array<{ value: MapView; label: string; description: string }> = [
  {
    value: 'central',
    label: 'Central',
    description: 'Desde las entradas del clúster hasta el segundo nivel; lo demás, plegado en su dueño',
  },
  { value: 'full', label: 'Completo', description: 'Todas las conexiones declaradas' },
];

const getStyles = (theme: GrafanaTheme2) => ({
  toolbar: css({
    position: 'absolute',
    top: theme.spacing(0.5),
    right: theme.spacing(0.5),
    zIndex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
});

export const Toolbar: React.FC<Props> = ({ onFit, onRelayout, view, onViewChange }) => {
  const styles = useStyles2(getStyles);

  return (
    <div className={styles.toolbar}>
      {view && (
        <div data-testid="servicemap-view">
          <RadioButtonGroup size="sm" options={VIEW_OPTIONS} value={view} onChange={onViewChange} />
        </div>
      )}
      <ToolbarButtonRow>
        <ToolbarButton icon="crosshair" tooltip="Encuadrar el mapa" onClick={onFit} data-testid="servicemap-fit">
          Ajustar
        </ToolbarButton>
        <ToolbarButton
          icon="sync"
          tooltip="Recalcular el layout por capas"
          onClick={onRelayout}
          data-testid="servicemap-relayout"
        >
          Reordenar
        </ToolbarButton>
      </ToolbarButtonRow>
    </div>
  );
};
