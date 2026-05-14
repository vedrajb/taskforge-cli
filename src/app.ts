import React from 'react';
import {render} from 'ink';
import {loadConfig} from './config/loadConfig.js';
import {App} from './tui/App.js';

export async function main(_argv: string[]): Promise<void> {
  let startupError: string | undefined;
  const loadedConfig = await loadConfig().catch((error: unknown) => {
    // Convert startup failures into TUI state so the placeholder shell can still render context.
    startupError = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
    return undefined;
  });

  // Render the Phase 1 placeholder surface after config validation has run.
  render(React.createElement(App, {loadedConfig, startupError}));
}
