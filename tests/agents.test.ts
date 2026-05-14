import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, test } from 'node:test';
import {
  AgentPlanSchema,
  AgentPlanStepSchema,
  PlanParitySchema,
  type AgentPlan,
  type PlanParity,
} from '../src/agents/types.js';
import { runProcess, type ProcessRunnerEvent } from '../src/agents/runProcess.js';

type MockRunProcessModule = {
  calls: Array<{ command: string; args: string[]; options: Record<string, unknown> }>;
  enqueue: (item: {
    events?: ProcessRunnerEvent[];
    exit?: ProcessRunnerEvent;
    error?: Error;
  }) => void;
  reset: () => void;
};

const samplePlan: AgentPlan = {
  goal: 'Add agent tests',
  summary: 'Cover the primary agent behavior.',
  steps: [
    {
      id: 'inspect',
      title: 'Inspect agents',
      detail: 'Identify exported agent behavior.',
    },
  ],
  risks: ['Missing coverage'],
  openQuestions: [],
};

const alternatePlan: AgentPlan = {
  goal: 'Review the test plan',
  summary: 'Check that test coverage remains focused.',
  steps: [
    {
      id: 'review',
      title: 'Review coverage',
      detail: 'Compare expected and actual behavior.',
      files: ['src/agents/codex.ts'],
      risks: ['False positives'],
    },
  ],
  risks: [],
  openQuestions: ['Should integration tests be added later?'],
};

const sampleParity: PlanParity = {
  classification: 'compatible',
  reason: 'Both plans cover the same workflow.',
  coreDifferences: [],
  recommendedAction: 'proceed',
};

async function loadAgentModuleWithMock(moduleName: 'claude' | 'codex') {
  // Create an isolated module copy so each test controls the process runner import.
  const tempDir = mkdtempSync(join(tmpdir(), 'taskforge-agent-test-'));
  const mockPath = join(tempDir, 'mockRunProcess.ts');
  const copiedModulePath = join(tempDir, `${moduleName}.ts`);
  const runProcessUrl = pathToFileURL(resolve('src/agents/runProcess.ts')).href;
  const typesUrl = pathToFileURL(resolve('src/agents/types.ts')).href;

  // Provide a small process-runner fake that records args and replays queued events.
  writeFileSync(
    mockPath,
    `
      import type { ProcessRunnerEvent, RunProcessOptions, RunningProcess } from '${runProcessUrl}';

      export const calls: Array<{ command: string; args: string[]; options: RunProcessOptions }> = [];
      const queue: Array<{ events?: ProcessRunnerEvent[]; exit?: ProcessRunnerEvent; error?: Error }> = [];

      export function enqueue(item: { events?: ProcessRunnerEvent[]; exit?: ProcessRunnerEvent; error?: Error }) {
        queue.push(item);
      }

      export function reset() {
        calls.length = 0;
        queue.length = 0;
      }

      export function runProcess(
        command: string,
        args: string[] = [],
        options: RunProcessOptions = {}
      ): RunningProcess {
        const item = queue.shift() ?? {};
        calls.push({ command, args, options });

        for (const event of item.events ?? []) {
          options.onEvent?.(event);
        }

        return {
          child: {} as RunningProcess['child'],
          completion: item.error
            ? Promise.reject(item.error)
            : Promise.resolve(item.exit ?? { type: 'exit', code: 0, signal: null }),
          cancel: () => {},
        };
      }
    `,
    'utf8'
  );

  // Rewrite only local agent imports; the copied module still uses the real schemas.
  const source = readFileSync(resolve(`src/agents/${moduleName}.ts`), 'utf8')
    .replace(/from ['"]\.\/runProcess\.js['"]/g, `from '${pathToFileURL(mockPath).href}'`)
    .replace(/from ['"]\.\/types\.js['"]/g, `from '${typesUrl}'`);

  writeFileSync(copiedModulePath, source, 'utf8');

  const mock = (await import(pathToFileURL(mockPath).href)) as MockRunProcessModule;
  const module = await import(`${pathToFileURL(copiedModulePath).href}?${Date.now()}`);

  return { module, mock };
}

function outputEvent(stream: 'stdout' | 'stderr', data: string): ProcessRunnerEvent {
  // Keep event creation explicit so tests read like the process stream they simulate.
  return { type: 'output', stream, data };
}

function exitEvent(code: number | null, signal: NodeJS.Signals | null = null): ProcessRunnerEvent {
  // Match the event shape emitted by runProcess when a child process closes.
  return { type: 'exit', code, signal };
}

describe('agent type schemas', () => {
  test('accept valid plans with optional step files and risks omitted', () => {
    const parsed = AgentPlanSchema.parse(samplePlan);

    assert.deepEqual(parsed, samplePlan);
  });

  test('reject invalid plan parity enum values and missing required plan fields', () => {
    assert.throws(() =>
      PlanParitySchema.parse({
        ...sampleParity,
        classification: 'different',
      })
    );

    assert.throws(() =>
      AgentPlanSchema.parse({
        goal: 'Missing required arrays',
        summary: 'This shape omits risks and openQuestions.',
        steps: [],
      })
    );
  });

  test('validate optional and required step fields', () => {
    const minimalStep = AgentPlanStepSchema.parse({
      id: 'one',
      title: 'One',
      detail: 'A minimal valid step.',
    });

    assert.deepEqual(minimalStep, {
      id: 'one',
      title: 'One',
      detail: 'A minimal valid step.',
    });

    assert.throws(() =>
      AgentPlanStepSchema.parse({
        id: 'missing-detail',
        title: 'Missing detail',
      })
    );
  });
});

describe('runProcess', () => {
  test('streams stdout and stderr, merges env, applies cwd, and reports exit', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'taskforge-runprocess-cwd-'));
    const events: ProcessRunnerEvent[] = [];

    // Run a real child process to verify the public process-runner contract.
    const running = runProcess(
      process.execPath,
      [
        '-e',
        [
          'console.log(process.cwd())',
          'console.error(process.env.TASKFORGE_TEST_VALUE)',
        ].join(';'),
      ],
      {
        cwd,
        env: { TASKFORGE_TEST_VALUE: 'merged-env' },
        onEvent: (event) => events.push(event),
      }
    );

    const completion = await running.completion;
    const stdout = events
      .filter((event) => event.type === 'output' && event.stream === 'stdout')
      .map((event) => event.data)
      .join('');
    const stderr = events
      .filter((event) => event.type === 'output' && event.stream === 'stderr')
      .map((event) => event.data)
      .join('');

    assert.equal(completion.type, 'exit');
    assert.equal(completion.code, 0);
    assert.match(stdout, new RegExp(cwd.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')));
    assert.match(stderr, /merged-env/);
    assert.deepEqual(events.at(-1), completion);
  });

  test('supports manual cancellation and AbortSignal cancellation', async () => {
    // Start long-running children so both cancellation paths can terminate them.
    const manual = runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    manual.cancel();
    const manualExit = await manual.completion;

    const controller = new AbortController();
    const signaled = runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      signal: controller.signal,
    });
    controller.abort();
    const signaledExit = await signaled.completion;

    assert.equal(manualExit.type, 'exit');
    assert.equal(manualExit.signal, 'SIGTERM');
    assert.equal(signaledExit.type, 'exit');
    assert.equal(signaledExit.signal, 'SIGTERM');
  });

  test('rejects completion when spawning fails', async () => {
    // Use an impossible command name to exercise the child_process error path.
    const running = runProcess(`taskforge-missing-command-${Date.now()}`);

    await assert.rejects(running.completion, /ENOENT/);
  });
});

describe('claude agent wrappers', () => {
  test('claudePlan builds the CLI prompt, forwards events, and parses stdout JSON', async () => {
    const { module, mock } = await loadAgentModuleWithMock('claude');
    const forwarded: ProcessRunnerEvent[] = [];
    const events = [
      outputEvent('stderr', 'ignored diagnostic'),
      outputEvent('stdout', `prefix ${JSON.stringify(samplePlan)} suffix`),
    ];

    // Queue the process transcript before invoking the wrapper.
    mock.enqueue({ events });
    const plan = await module.claudePlan('claude-bin', 'Write tests', 'high', {
      cwd: 'repo',
      onEvent: (event: ProcessRunnerEvent) => forwarded.push(event),
    });

    const call = mock.calls[0];
    const prompt = call.args[3];

    assert.deepEqual(plan, samplePlan);
    assert.equal(call.command, 'claude-bin');
    assert.deepEqual(call.args.slice(0, 3), ['-p', '--output-format', 'json']);
    assert.match(prompt, /Write tests/);
    assert.match(prompt, /high/);
    assert.match(prompt, /openQuestions/);
    assert.deepEqual(forwarded, events);
  });

  test('claudePlan rejects non-zero exits and missing JSON output', async () => {
    const { module, mock } = await loadAgentModuleWithMock('claude');

    // Validate wrapper errors before schema parsing when the process fails.
    mock.enqueue({
      events: [outputEvent('stdout', JSON.stringify(samplePlan))],
      exit: exitEvent(2),
    });
    await assert.rejects(
      module.claudePlan('claude-bin', 'Write tests', 'medium'),
      /claude exited with code 2/
    );

    mock.enqueue({ events: [outputEvent('stdout', 'no json here')] });
    await assert.rejects(
      module.claudePlan('claude-bin', 'Write tests', 'medium'),
      /No JSON object found in output/
    );
  });

  test('claudeParity sends both plans and parses parity JSON', async () => {
    const { module, mock } = await loadAgentModuleWithMock('claude');

    // Return a parity response while checking the prompt includes both input plans.
    mock.enqueue({ events: [outputEvent('stdout', JSON.stringify(sampleParity))] });
    const parity = await module.claudeParity(
      'claude-bin',
      samplePlan,
      alternatePlan,
      'low'
    );

    const prompt = mock.calls[0].args[3];

    assert.deepEqual(parity, sampleParity);
    assert.match(prompt, /Add agent tests/);
    assert.match(prompt, /Review the test plan/);
    assert.match(prompt, /recommendedAction/);
  });
});

describe('codex agent wrappers', () => {
  test('codexPlan builds exec args and parses noisy stdout JSON', async () => {
    const { module, mock } = await loadAgentModuleWithMock('codex');

    // Simulate Codex printing explanatory text around the JSON payload.
    mock.enqueue({ events: [outputEvent('stdout', `before ${JSON.stringify(samplePlan)} after`)] });
    const plan = await module.codexPlan('codex-bin', 'Plan this work', 'medium');

    const call = mock.calls[0];
    const prompt = call.args[4];

    assert.deepEqual(plan, samplePlan);
    assert.equal(call.command, 'codex-bin');
    assert.deepEqual(call.args.slice(0, 4), [
      'exec',
      '--skip-git-repo-check',
      '--reasoning-effort',
      'medium',
    ]);
    assert.match(prompt, /Plan this work/);
    assert.match(prompt, /openQuestions/);
  });

  test('codexPlan rejects failed process exits and missing JSON output', async () => {
    const { module, mock } = await loadAgentModuleWithMock('codex');

    // Non-zero process exits are surfaced before JSON extraction.
    mock.enqueue({
      events: [outputEvent('stdout', JSON.stringify(samplePlan))],
      exit: exitEvent(1),
    });
    await assert.rejects(
      module.codexPlan('codex-bin', 'Plan this work', 'high'),
      /codex exited with code 1/
    );

    mock.enqueue({ events: [outputEvent('stdout', 'plain text only')] });
    await assert.rejects(
      module.codexPlan('codex-bin', 'Plan this work', 'high'),
      /No JSON object found in output/
    );
  });

  test('codexExecute wires exec args, includes the selected plan, and does not parse stdout', async () => {
    const { module, mock } = await loadAgentModuleWithMock('codex');

    // The execute path should rely only on process exit status.
    mock.enqueue({ events: [outputEvent('stdout', 'not json')] });
    await module.codexExecute('codex-bin', 'Implement the plan', samplePlan, 'high');

    const call = mock.calls[0];
    const prompt = call.args[3];

    assert.deepEqual(call.args.slice(0, 3), ['exec', '--reasoning-effort', 'high']);
    assert.match(prompt, /Implement the plan/);
    assert.match(prompt, /Add agent tests/);
    assert.match(prompt, /Git Bash/i);

    mock.enqueue({ exit: exitEvent(7) });
    await assert.rejects(
      module.codexExecute('codex-bin', 'Implement the plan', samplePlan, 'high'),
      /codex exec exited with code 7/
    );
  });

  test('codexReview wires review args and enforces exit status only', async () => {
    const { module, mock } = await loadAgentModuleWithMock('codex');

    // Review ignores stdout content and succeeds on a zero exit status.
    mock.enqueue({ events: [outputEvent('stdout', 'review text')] });
    await module.codexReview('codex-bin');

    assert.deepEqual(mock.calls[0].args, ['review', '--uncommitted']);

    mock.enqueue({ exit: exitEvent(3) });
    await assert.rejects(module.codexReview('codex-bin'), /codex review exited with code 3/);
  });
});
