import {AgentPlan, AgentPlanSchema, AGENT_PLAN_SCHEMA_DESCRIPTION} from './types.js';
import {acpxRun, AcpxRunOptions} from './acpxAgent.js';
import {RunProcessOptions} from './runProcess.js';

function extractFirstJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in output');
  }
  return JSON.parse(text.slice(start, end + 1));
}

function buildPlanPrompt(userRequest: string): string {
  return (
    `You are a software planning agent. Produce a structured implementation plan for the following request.\n\n` +
    `REQUEST:\n${userRequest}\n\n` +
    `Respond with ONLY a single JSON object matching this schema (no markdown, no prose outside the JSON):\n` +
    AGENT_PLAN_SCHEMA_DESCRIPTION
  );
}

function buildExecutePrompt(userRequest: string, plan: AgentPlan): string {
  return (
    `Execute the following implementation plan in the current workspace.\n\n` +
    `ORIGINAL REQUEST:\n${userRequest}\n\n` +
    `SELECTED PLAN:\n${JSON.stringify(plan, null, 2)}\n\n` +
    `Prefer Git Bash for repository operations. Follow the plan steps in order.`
  );
}

function buildMergePrompt(planA: AgentPlan, planB: AgentPlan): string {
  return (
    `You are a software planning agent. Merge the two implementation plans below into one coherent plan.\n\n` +
    `Preserve compatible useful steps, resolve conflicts explicitly, and avoid duplicating equivalent work.\n\n` +
    `PLAN A:\n${JSON.stringify(planA, null, 2)}\n\n` +
    `PLAN B:\n${JSON.stringify(planB, null, 2)}\n\n` +
    `Respond with ONLY a single JSON object matching this schema (no markdown, no prose outside the JSON):\n` +
    AGENT_PLAN_SCHEMA_DESCRIPTION
  );
}

function buildReviewPrompt(): string {
  return (
    `Review the uncommitted changes in the current workspace.\n` +
    `Check for bugs, security issues, code quality problems, and missing tests.\n` +
    `Provide a concise, actionable summary of findings.`
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

export async function codexPlan(
  command: string,
  userRequest: string,
  _effort: string,
  options: RunProcessOptions = {}
): Promise<AgentPlan> {
  const prompt = buildPlanPrompt(userRequest);
  const text = await acpxRun(command, prompt, toAcpxOptions(options));
  return AgentPlanSchema.parse(extractFirstJson(text));
}

export async function codexExecute(
  command: string,
  userRequest: string,
  plan: AgentPlan,
  _effort: string,
  options: RunProcessOptions = {}
): Promise<void> {
  const prompt = buildExecutePrompt(userRequest, plan);
  await acpxRun(command, prompt, toAcpxOptions(options));
}

export async function codexMergePlan(
  command: string,
  planA: AgentPlan,
  planB: AgentPlan,
  _effort: string,
  options: RunProcessOptions = {}
): Promise<AgentPlan> {
  const prompt = buildMergePrompt(planA, planB);
  const text = await acpxRun(command, prompt, toAcpxOptions(options));
  return AgentPlanSchema.parse(extractFirstJson(text));
}

export async function codexReview(
  command: string,
  options: RunProcessOptions = {}
): Promise<void> {
  const prompt = buildReviewPrompt();
  await acpxRun(command, prompt, toAcpxOptions(options));
}
