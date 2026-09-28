import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { ToolbarButton, ToolbarButtonRow, useStyles2 } from '@grafana/ui';
import React from 'react';

interface Props {
  onFit: () => void;
  onRelayout: () => void;
  /** Con un servicio seleccionado, o la lista de NodePort abierta: volver al mapa central. */
  onBack?: () => void;
  focusLabel?: string;
}

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

export const Toolbar: React.FC<Props> = ({ onFit, onRelayout, onBack, focusLabel }) => {
  const styles = useStyles2(getStyles);

  return (
    <div className={styles.toolbar}>
      {onBack && (
        <ToolbarButton
          icon="arrow-left"
          tooltip={focusLabel ? `Salir de ${focusLabel}` : undefined}
          onClick={onBack}
          data-testid="servicemap-back"
        >
          Mapa central
        </ToolbarButton>
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
