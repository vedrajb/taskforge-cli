import {LoadedConfig} from '../config/loadConfig.js';
import {codexReview} from '../agents/codex.js';
import {RunProcessOptions} from '../agents/runProcess.js';

export type ReviewModeOptions = {
  onEvent?: RunProcessOptions['onEvent'];
  abortSignal?: AbortSignal;
};

export async function runReviewMode(
  loadedConfig: LoadedConfig,
  opts: ReviewModeOptions = {}
): Promise<void> {
  const {config} = loadedConfig;
  const agentId = config.workflow.reviewAgent;
  const command = config.agents[agentId]?.command ?? 'codex';

  await codexReview(command, {
    cwd: loadedConfig.targetCwd,
    signal: opts.abortSignal,
    onEvent: opts.onEvent,
  });
}
