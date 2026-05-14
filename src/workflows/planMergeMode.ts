import {LoadedConfig} from '../config/loadConfig.js';
import {resolveEffort} from '../config/resolveEffort.js';
import {claudeMergePlan} from '../agents/claude.js';
import {codexMergePlan} from '../agents/codex.js';
import {AgentPlan} from '../agents/types.js';
import {RunProcessOptions} from '../agents/runProcess.js';

export type PlanMergeModeOptions = {
  onEvent?: RunProcessOptions['onEvent'];
  abortSignal?: AbortSignal;
};

export async function runPlanMergeMode(
  loadedConfig: LoadedConfig,
  claudePlan: AgentPlan,
  codexPlan: AgentPlan,
  opts: PlanMergeModeOptions = {}
): Promise<AgentPlan> {
  const {config} = loadedConfig;
  const agentId = config.workflow.mergeAgent;
  const command = config.agents[agentId]?.command ?? agentId;
  const effort = resolveEffort(config, agentId, 'plan');
  const claudeAgentId = config.workflow.planAgents.find((id) => id === 'claude') ?? config.workflow.planAgents[0];
  const codexAgentId = config.workflow.planAgents.find((id) => id === 'codex') ?? config.workflow.planAgents[1];
  const options: RunProcessOptions = {
    cwd: loadedConfig.targetCwd,
    signal: opts.abortSignal,
    onEvent: opts.onEvent,
  };

  // Dispatch through the same adapter family that produced the original plan pair.
  if (agentId === codexAgentId) {
    return codexMergePlan(command, claudePlan, codexPlan, effort, options);
  }

  // The first planner is treated as the Claude-compatible planner by plan mode.
  if (agentId !== claudeAgentId) {
    throw new Error(`Unsupported merge agent "${agentId}"`);
  }

  return claudeMergePlan(command, claudePlan, codexPlan, effort, options);
}
