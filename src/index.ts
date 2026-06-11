#!/usr/bin/env node

import {launchTaskForge} from './desktop/launcher.js';

launchTaskForge(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`taskforge failed: ${message}\n`);
  process.exitCode = 1;
});
