import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import {
  AgentPlanSchema,
  AgentPlanStepSchema,
  PlanParitySchema,
  type AgentPlan,
  type PlanParity,
} from '../src/agents/types.js';
import { runProcess, type ProcessRunnerEvent } from '../src/agents/runProcess.js';

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

const sampleParity: PlanParity = {
  classification: 'compatible',
  reason: 'Both plans cover the same workflow.',
  coreDifferences: [],
  recommendedAction: 'proceed',
};

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
    const running = runProcess(`taskforge-missing-command-${Date.now()}`);

    await assert.rejects(running.completion, /ENOENT/);
  });
});
