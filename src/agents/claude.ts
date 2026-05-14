import {
  AgentPlan,
  AgentPlanSchema,
  PlanParity,
  PlanParitySchema,
  AGENT_PLAN_SCHEMA_DESCRIPTION,
  PLAN_PARITY_SCHEMA_DESCRIPTION,
} from './types.js';
import {runProcess, RunProcessOptions, ProcessRunnerEvent} from './runProcess.js';

// stream-json emits newline-delimited JSON events. Each line is one of:
//   {"type":"system", ...}
//   {"type":"assistant","message":{"content":[{"type":"text","text":"..."}],...},...}
//   {"type":"result","result":"<escaped JSON string>",...}
// We forward assistant text chunks live and extract the result at the end.

type StreamEvent = Record<string, unknown>;

function buildStreamingOnEvent(
  wrappedOnEvent: RunProcessOptions['onEvent'],
  collectedLines: string[]
): RunProcessOptions['onEvent'] {
  let remainder = '';

  return (event: ProcessRunnerEvent) => {
    if (event.type !== 'output' || event.stream !== 'stdout') {
      wrappedOnEvent?.(event);
      return;
    }

    const lines = (remainder + event.data).split('\n');
    remainder = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      collectedLines.push(trimmed);

      let ev: StreamEvent;
      try {
        ev = JSON.parse(trimmed) as StreamEvent;
      } catch {
        wrappedOnEvent?.({type: 'output', stream: 'stdout', data: line});
        continue;
      }

      if (ev['type'] === 'assistant') {
        const msg = ev['message'] as {content?: Array<{type: string; text?: string}>} | undefined;
        const text = msg?.content
          ?.filter((c) => c.type === 'text')
          .map((c) => c.text ?? '')
          .join('');
        if (text) {
          wrappedOnEvent?.({type: 'output', stream: 'stdout', data: text});
        }
      }
    }
  };
}

function extractFirstJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in text');
  }
  return JSON.parse(text.slice(start, end + 1));
}

function extractResultFromLines(lines: string[]): unknown {
  // Pass 1: dedicated result event (claude --output-format stream-json emits this at the end).
  // Parse the outer event and inner result string separately so a bad JSON.parse on the
  // result text does not silently swallow the event and report the wrong error.
  for (const line of lines) {
    let ev: StreamEvent;
    try { ev = JSON.parse(line) as StreamEvent; } catch { continue; }
    if (ev['type'] === 'result' && typeof ev['result'] === 'string') {
      // extractFirstJson handles responses that wrap JSON in markdown code fences.
      return extractFirstJson(ev['result'] as string);
    }
  }
  // Pass 2: fallback — scan assistant message content blocks in case the CLI version
  // does not emit a separate result event.
  for (const line of lines) {
    let ev: StreamEvent;
    try { ev = JSON.parse(line) as StreamEvent; } catch { continue; }
    if (ev['type'] === 'assistant') {
      const msg = ev['message'] as {content?: Array<{type: string; text?: string}>} | undefined;
      const text = msg?.content
        ?.filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('');
      if (text) {
        try { return extractFirstJson(text); } catch { /* keep scanning */ }
      }
    }
  }
  throw new Error('No result event found in claude stream-json output');
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

// Prompt is passed via stdin ('-') to avoid any shell quoting issues on Windows.
const CLAUDE_BASE_ARGS = ['-p', '--verbose', '--output-format', 'stream-json', '-'];

export async function claudePlan(
  command: string,
  userRequest: string,
  effort: string,
  options: RunProcessOptions = {}
): Promise<AgentPlan> {
  const prompt = buildPlanPrompt(userRequest, effort);
  const collectedLines: string[] = [];

  const proc = runProcess(command, CLAUDE_BASE_ARGS, {
    ...options,
    stdinPayload: prompt,
    onEvent: buildStreamingOnEvent(options.onEvent, collectedLines),
  });

  const exit = await proc.completion;
  if (exit.type === 'exit' && exit.code !== 0) {
    throw new Error(`claude exited with code ${exit.code}`);
  }

  const result = extractResultFromLines(collectedLines);
  return AgentPlanSchema.parse(result);
}

export async function claudeParity(
  command: string,
  planA: AgentPlan,
  planB: AgentPlan,
  effort: string,
  options: RunProcessOptions = {}
): Promise<PlanParity> {
  const prompt = buildParityPrompt(planA, planB, effort);
  const collectedLines: string[] = [];

  const proc = runProcess(command, CLAUDE_BASE_ARGS, {
    ...options,
    stdinPayload: prompt,
    onEvent: buildStreamingOnEvent(options.onEvent, collectedLines),
  });

  const exit = await proc.completion;
  if (exit.type === 'exit' && exit.code !== 0) {
    throw new Error(`claude exited with code ${exit.code}`);
  }

  const result = extractResultFromLines(collectedLines);
  return PlanParitySchema.parse(result);
}

export async function claudeMergePlan(
  command: string,
  planA: AgentPlan,
  planB: AgentPlan,
  effort: string,
  options: RunProcessOptions = {}
): Promise<AgentPlan> {
  const prompt = buildMergePrompt(planA, planB, effort);
  const collectedLines: string[] = [];

  // Reuse Claude stream-json parsing so live assistant text still reaches the TUI.
  const proc = runProcess(command, CLAUDE_BASE_ARGS, {
    ...options,
    stdinPayload: prompt,
    onEvent: buildStreamingOnEvent(options.onEvent, collectedLines),
  });

  const exit = await proc.completion;
  if (exit.type === 'exit' && exit.code !== 0) {
    throw new Error(`claude exited with code ${exit.code}`);
  }

  const result = extractResultFromLines(collectedLines);
  return AgentPlanSchema.parse(result);
}
