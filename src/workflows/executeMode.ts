import {LoadedConfig} from '../config/loadConfig.js';
import {resolveEffort} from '../config/resolveEffort.js';
import {codexExecute} from '../agents/codex.js';
import {AgentPlan} from '../agents/types.js';
import {RunProcessOptions} from '../agents/runProcess.js';

export type ExecuteModeOptions = {
  onEvent?: RunProcessOptions['onEvent'];
  abortSignal?: AbortSignal;
};

export async function runExecuteMode(
  loadedConfig: LoadedConfig,
  userRequest: string,
  plan: AgentPlan,
  opts: ExecuteModeOptions = {}
): Promise<void> {
  const {config} = loadedConfig;
  const agentId = config.workflow.executeAgent;
  const command = config.agents[agentId]?.command ?? 'codex';
  const effort = resolveEffort(config, agentId, 'execute');

  await codexExecute(command, userRequest, plan, effort, {
    cwd: loadedConfig.targetCwd,
    signal: opts.abortSignal,
    onEvent: opts.onEvent,
  });
}
