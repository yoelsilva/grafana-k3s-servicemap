import type { PluginOptions } from '@grafana/plugin-e2e';
import { defineConfig } from '@playwright/test';
import baseConfig from './.config/playwright.config';

/**
 * See https://playwright.dev/docs/test-configuration.
 *
 * `PW_CHANNEL` permite usar un navegador ya instalado en vez del Chromium que
 * descarga Playwright. Hace falta en maquinas donde esa descarga no funciona
 * (p. ej. Windows detras de una red que la bloquea):
 *
 *   PW_CHANNEL=chrome GRAFANA_URL=http://127.0.0.1:3000 npm run e2e
 *
 * Sin la variable no cambia nada, que es como corre en CI.
 */
export default defineConfig<PluginOptions>(baseConfig, {
  // Todos los tests editan paneles de la misma instancia de Grafana: en
  // paralelo se pisan entre ellos y fallan de forma intermitente. Son tres,
  // tampoco se gana nada repartiendolos.
  workers: 1,
  fullyParallel: false,
  use: process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {},
});
