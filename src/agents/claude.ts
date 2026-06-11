import {
  AgentPlan,
  AgentPlanSchema,
  PlanParity,
  PlanParitySchema,
  AGENT_PLAN_SCHEMA_DESCRIPTION,
  PLAN_PARITY_SCHEMA_DESCRIPTION,
} from './types.js';
import {acpxRun, AcpxRunOptions} from './acpxAgent.js';
import {RunProcessOptions} from './runProcess.js';

function extractFirstJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in text');
  }
  return JSON.parse(text.slice(start, end + 1));
}

function effortNote(effort: string): string {
  return `Reasoning effort: ${effort}. Calibrate the depth of your analysis accordingly.`;
}

function buildPlanPrompt(userRequest: string, effort: string): string {
  return (
    `${effortNote(effort)}\n\n` +
    `You are a software planning agent. Produce a structured implementation plan for the following request.\n\n` +
    `REQUEST:\n${userRequest}\n\n` +
    `Respond with ONLY a single JSON object matching this schema (no markdown, no prose outside the JSON):\n` +
    AGENT_PLAN_SCHEMA_DESCRIPTION
  );
}

function buildParityPrompt(planA: AgentPlan, planB: AgentPlan, effort: string): string {
  return (
    `${effortNote(effort)}\n\n` +
    `You are a plan parity checker. Compare the two implementation plans below and classify their relationship.\n\n` +
    `PLAN A:\n${JSON.stringify(planA, null, 2)}\n\n` +
    `PLAN B:\n${JSON.stringify(planB, null, 2)}\n\n` +
    `Respond with ONLY a single JSON object matching this schema (no markdown, no prose outside the JSON):\n` +
    PLAN_PARITY_SCHEMA_DESCRIPTION
  );
}

function buildMergePrompt(planA: AgentPlan, planB: AgentPlan, effort: string): string {
  return (
    `${effortNote(effort)}\n\n` +
    `You are a software planning agent. Merge the two implementation plans below into one coherent plan.\n\n` +
    `Preserve compatible useful steps, resolve conflicts explicitly, and avoid duplicating equivalent work.\n\n` +
    `PLAN A:\n${JSON.stringify(planA, null, 2)}\n\n` +
    `PLAN B:\n${JSON.stringify(planB, null, 2)}\n\n` +
    `Respond with ONLY a single JSON object matching this schema (no markdown, no prose outside the JSON):\n` +
    AGENT_PLAN_SCHEMA_DESCRIPTION
  );
}

function toAcpxOptions(options: RunProcessOptions): AcpxRunOptions {
  return {
    cwd: options.cwd ?? process.cwd(),
    signal: options.signal,
    onEvent(ev) {
      if (ev.type === 'text_delta' && ev.stream === 'output') {
        options.onEvent?.({type: 'output', stream: 'stdout', data: ev.text});
      } else if (ev.type === 'done') {
        options.onEvent?.({type: 'exit', code: 0, signal: null});
      } else if (ev.type === 'error') {
        options.onEvent?.({type: 'exit', code: 1, signal: null});
      }
    },
  };
}

export async function claudePlan(
  command: string,
  userRequest: string,
  effort: string,
  options: RunProcessOptions = {}
): Promise<AgentPlan> {
  const prompt = buildPlanPrompt(userRequest, effort);
  const text = await acpxRun(command, prompt, toAcpxOptions(options));
  return AgentPlanSchema.parse(extractFirstJson(text));
}

export async function claudeParity(
  command: string,
  planA: AgentPlan,
  planB: AgentPlan,
  effort: string,
  options: RunProcessOptions = {}
): Promise<PlanParity> {
  const prompt = buildParityPrompt(planA, planB, effort);
  const text = await acpxRun(command, prompt, toAcpxOptions(options));
  return PlanParitySchema.parse(extractFirstJson(text));
}

export async function claudeMergePlan(
  command: string,
  planA: AgentPlan,
  planB: AgentPlan,
  effort: string,
  options: RunProcessOptions = {}
): Promise<AgentPlan> {
  const prompt = buildMergePrompt(planA, planB, effort);
  const text = await acpxRun(command, prompt, toAcpxOptions(options));
  return AgentPlanSchema.parse(extractFirstJson(text));
}
