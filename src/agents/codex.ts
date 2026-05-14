import {AgentPlan, AgentPlanSchema, AGENT_PLAN_SCHEMA_DESCRIPTION} from './types.js';
import {runProcess, RunProcessOptions} from './runProcess.js';

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

// Prompt is read from stdin ('-' is the default when stdin is piped) to avoid
// shell quoting issues on Windows where shell: true is required for .cmd shims.

export async function codexPlan(
  command: string,
  userRequest: string,
  effort: string,
  options: RunProcessOptions = {}
): Promise<AgentPlan> {
  const prompt = buildPlanPrompt(userRequest);
  const chunks: string[] = [];
  const wrappedOnEvent = options.onEvent;

  const proc = runProcess(
    command,
    ['exec', '--skip-git-repo-check', '-c', `reasoning_effort="${effort}"`],
    {
      ...options,
      stdinPayload: prompt,
      onEvent(event) {
        if (event.type === 'output' && event.stream === 'stdout') {
          chunks.push(event.data);
        }
        wrappedOnEvent?.(event);
      },
    }
  );

  const exit = await proc.completion;
  if (exit.type === 'exit' && exit.code !== 0) {
    throw new Error(`codex exited with code ${exit.code}`);
  }

  const raw = chunks.join('');
  const parsed = extractFirstJson(raw);
  return AgentPlanSchema.parse(parsed);
}

export async function codexExecute(
  command: string,
  userRequest: string,
  plan: AgentPlan,
  effort: string,
  options: RunProcessOptions = {}
): Promise<void> {
  const prompt = buildExecutePrompt(userRequest, plan);

  const proc = runProcess(
    command,
    ['exec', '-c', `reasoning_effort="${effort}"`],
    {
      ...options,
      stdinPayload: prompt,
    }
  );

  const exit = await proc.completion;
  if (exit.type === 'exit' && exit.code !== 0) {
    throw new Error(`codex exec exited with code ${exit.code}`);
  }
}

export async function codexMergePlan(
  command: string,
  planA: AgentPlan,
  planB: AgentPlan,
  effort: string,
  options: RunProcessOptions = {}
): Promise<AgentPlan> {
  const prompt = buildMergePrompt(planA, planB);
  const chunks: string[] = [];
  const wrappedOnEvent = options.onEvent;

  // Capture stdout for JSON parsing while still forwarding process output live.
  const proc = runProcess(
    command,
    ['exec', '--skip-git-repo-check', '-c', `reasoning_effort="${effort}"`],
    {
      ...options,
      stdinPayload: prompt,
      onEvent(event) {
        if (event.type === 'output' && event.stream === 'stdout') {
          chunks.push(event.data);
        }
        wrappedOnEvent?.(event);
      },
    }
  );

  const exit = await proc.completion;
  if (exit.type === 'exit' && exit.code !== 0) {
    throw new Error(`codex exited with code ${exit.code}`);
  }

  const raw = chunks.join('');
  const parsed = extractFirstJson(raw);
  return AgentPlanSchema.parse(parsed);
}

export async function codexReview(
  command: string,
  options: RunProcessOptions = {}
): Promise<void> {
  const proc = runProcess(command, ['exec', 'review', '--uncommitted'], {
    ...options,
  });

  const exit = await proc.completion;
  if (exit.type === 'exit' && exit.code !== 0) {
    throw new Error(`codex review exited with code ${exit.code}`);
  }
}
