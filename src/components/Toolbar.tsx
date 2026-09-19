import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { ToolbarButton, ToolbarButtonRow, useStyles2 } from '@grafana/ui';
import React from 'react';

interface Props {
  onFit: () => void;
  onRelayout: () => void;
}

const getStyles = (theme: GrafanaTheme2) => ({
  toolbar: css({
    position: 'absolute',
    top: theme.spacing(0.5),
    right: theme.spacing(0.5),
    zIndex: 1,
  }),
});

export const Toolbar: React.FC<Props> = ({ onFit, onRelayout }) => {
  const styles = useStyles2(getStyles);

  return (
    <div className={styles.toolbar}>
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
