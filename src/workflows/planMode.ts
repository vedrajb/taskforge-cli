import {LoadedConfig} from '../config/loadConfig.js';
import {resolveEffort} from '../config/resolveEffort.js';
import {claudePlan, claudeParity} from '../agents/claude.js';
import {codexPlan} from '../agents/codex.js';
import {normalizePlan} from '../compare/normalizePlan.js';
import {comparePlans} from '../compare/comparePlans.js';
import {AgentPlan, PlanParity} from '../agents/types.js';
import {RunProcessOptions} from '../agents/runProcess.js';

export type PlanModeResult =
  | {status: 'aligned'; plan: AgentPlan; codexPlan: AgentPlan; claudePlan: AgentPlan}
  | {
      status: 'parity_checked';
      parity: PlanParity;
      plan: AgentPlan;
      codexPlan: AgentPlan;
      claudePlan: AgentPlan;
    }
  | {status: 'single_agent'; plan: AgentPlan; agentId: string; otherError: string}
  | {status: 'both_failed'; claudeError: string; codexError: string};

export type PlanModeAgentEvent = {
  agentId: string;
  type: 'output' | 'exit';
  stream?: 'stdout' | 'stderr';
  data?: string;
  code?: number | null;
};

export type PlanModeOptions = {
  onAgentEvent?: (event: PlanModeAgentEvent) => void;
  abortSignal?: AbortSignal;
};

export async function runPlanMode(
  loadedConfig: LoadedConfig,
  userRequest: string,
  opts: PlanModeOptions = {}
): Promise<PlanModeResult> {
  const {config} = loadedConfig;
  const {workflow} = config;

  const claudeAgentId = workflow.planAgents.find((id) => id === 'claude') ?? workflow.planAgents[0];
  const codexAgentId = workflow.planAgents.find((id) => id === 'codex') ?? workflow.planAgents[1];

  const claudeCommand = config.agents[claudeAgentId]?.command ?? 'claude';
  const codexCommand = config.agents[codexAgentId]?.command ?? 'codex';

  const claudeEffort = resolveEffort(config, claudeAgentId, 'plan');
  const codexEffort = resolveEffort(config, codexAgentId, 'plan');

  function makeRunOptions(agentId: string): RunProcessOptions {
    return {
      cwd: loadedConfig.targetCwd,
      signal: opts.abortSignal,
      onEvent(event) {
        if (event.type === 'output') {
          opts.onAgentEvent?.({agentId, type: 'output', stream: event.stream, data: event.data});
        } else {
          opts.onAgentEvent?.({agentId, type: 'exit', code: event.code});
        }
      },
    };
  }

  const [claudeResult, codexResult] = await Promise.allSettled([
    claudePlan(claudeCommand, userRequest, claudeEffort, makeRunOptions(claudeAgentId)),
    codexPlan(codexCommand, userRequest, codexEffort, makeRunOptions(codexAgentId)),
  ]);

  const claudeOk = claudeResult.status === 'fulfilled';
  const codexOk = codexResult.status === 'fulfilled';

  if (!claudeOk && !codexOk) {
    return {
      status: 'both_failed',
      claudeError: String((claudeResult as PromiseRejectedResult).reason),
      codexError: String((codexResult as PromiseRejectedResult).reason),
    };
  }

  if (!claudeOk || !codexOk) {
    const succeededId = claudeOk ? claudeAgentId : codexAgentId;
    const succeededPlan = claudeOk
      ? (claudeResult as PromiseFulfilledResult<AgentPlan>).value
      : (codexResult as PromiseFulfilledResult<AgentPlan>).value;
    const failedError = claudeOk
      ? String((codexResult as PromiseRejectedResult).reason)
      : String((claudeResult as PromiseRejectedResult).reason);

    return {
      status: 'single_agent',
      plan: succeededPlan,
      agentId: succeededId,
      otherError: failedError,
    };
  }

  const cp = (claudeResult as PromiseFulfilledResult<AgentPlan>).value;
  const dp = (codexResult as PromiseFulfilledResult<AgentPlan>).value;

  const essenceA = normalizePlan(cp);
  const essenceB = normalizePlan(dp);
  const comparison = comparePlans(essenceA, essenceB);

  if (comparison.aligned) {
    return {status: 'aligned', plan: dp, codexPlan: dp, claudePlan: cp};
  }

  // Plans differ — call Claude as parity checker.
  const parityAgentId = workflow.parityAgent;
  const parityCommand = config.agents[parityAgentId]?.command ?? 'claude';
  const parityEffort = resolveEffort(config, parityAgentId, 'parity');

  let parity: PlanParity;
  try {
    parity = await claudeParity(parityCommand, cp, dp, parityEffort, makeRunOptions(parityAgentId));
  } catch {
    // Parity call failed — treat as materially different so the user can choose.
    parity = {
      classification: 'materially_different',
      reason: 'Parity check failed; defaulting to user choice.',
      coreDifferences: comparison.reasons,
      recommendedAction: 'ask_user_to_choose',
    };
  }

  return {status: 'parity_checked', parity, plan: dp, codexPlan: dp, claudePlan: cp};
}
