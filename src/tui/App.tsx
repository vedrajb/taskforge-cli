import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Box, useApp, useInput} from 'ink';
import {LoadedConfig} from '../config/loadConfig.js';
import {AgentPane, AgentLogLine} from './AgentPane.js';
import {Footer} from './Footer.js';
import {InputRow} from './InputRow.js';
import {PlanPane} from './PlanPane.js';
import {StatusBar} from './StatusBar.js';
import {runPlanMode, PlanModeResult} from '../workflows/planMode.js';
import {runPlanMergeMode} from '../workflows/planMergeMode.js';
import {runExecuteMode} from '../workflows/executeMode.js';
import {runReviewMode} from '../workflows/reviewMode.js';
import {AgentPlan} from '../agents/types.js';
import {ProcessRunnerEvent} from '../agents/runProcess.js';

type Phase =
  | 'idle'
  | 'planning'
  | 'awaiting_choice'
  | 'executing'
  | 'reviewing'
  | 'done'
  | 'error';

export type AppProps = {
  loadedConfig?: LoadedConfig;
  startupError?: string;
};

export function App({loadedConfig, startupError}: AppProps): React.ReactElement {
  const {exit} = useApp();
  const [phase, setPhase] = useState<Phase>(startupError ? 'error' : 'idle');
  const [prompt, setPrompt] = useState('');
  const [submittedPrompt, setSubmittedPrompt] = useState('');
  const [logs, setLogs] = useState<AgentLogLine[]>(() => [
    {
      stream: startupError ? 'stderr' : 'stdout',
      text: startupError ?? 'TaskForge ready. Enter a request to plan.',
    },
  ]);
  const [planResult, setPlanResult] = useState<PlanModeResult | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<AgentPlan | null>(null);
  const [planDisplay, setPlanDisplay] = useState('No plan yet.');

  const abortRef = useRef<AbortController | null>(null);

  const addLog = useCallback((stream: 'stdout' | 'stderr', text: string) => {
    setLogs((prev) => [...prev, {stream, text}]);
  }, []);

  const makeProcessEventHandler = useCallback(
    (label: string) =>
      (event: ProcessRunnerEvent) => {
        if (event.type === 'output') {
          addLog(event.stream, `[${label}] ${event.data.trimEnd()}`);
        }
      },
    [addLog]
  );

  const startPlanning = useCallback(
    async (userRequest: string) => {
      if (!loadedConfig) return;
      setPhase('planning');
      addLog('stdout', `Starting planning for: ${userRequest}`);

      const abort = new AbortController();
      abortRef.current = abort;

      try {
        const result = await runPlanMode(loadedConfig, userRequest, {
          abortSignal: abort.signal,
          onAgentEvent(ev) {
            if (ev.type === 'output' && ev.data) {
              addLog(ev.stream ?? 'stdout', `[${ev.agentId}] ${ev.data.trimEnd()}`);
            }
          },
        });

        setPlanResult(result);

        if (result.status === 'both_failed') {
          addLog('stderr', `Both agents failed.`);
          addLog('stderr', `Claude: ${result.claudeError}`);
          addLog('stderr', `Codex: ${result.codexError}`);
          setPhase('error');
          return;
        }

        if (result.status === 'single_agent') {
          addLog('stderr', `One agent failed: ${result.otherError}`);
          addLog('stdout', `Proceeding with ${result.agentId} plan. Press Enter to continue or Ctrl+C to cancel.`);
          setSelectedPlan(result.plan);
          setPlanDisplay(JSON.stringify(result.plan, null, 2));
          setPhase('awaiting_choice');
          return;
        }

        if (result.status === 'aligned') {
          addLog('stdout', 'Plans are aligned. Using Codex plan.');
          setSelectedPlan(result.plan);
          setPlanDisplay(JSON.stringify(result.plan, null, 2));
          setPhase('awaiting_choice');
          return;
        }

        if (result.status === 'parity_checked') {
          const {parity} = result;
          addLog('stdout', `Parity: ${parity.classification} — ${parity.reason}`);
          if (parity.classification === 'materially_different') {
            // Require an explicit plan or merge choice when parity finds a material difference.
            setSelectedPlan(null);
            addLog('stdout', 'Plans differ materially. Press 1 for Claude plan, 2 for Codex plan, m to auto-merge, Ctrl+C to cancel.');
            setPlanDisplay(
              `=== Claude Plan ===\n${JSON.stringify(result.claudePlan, null, 2)}\n\n=== Codex Plan ===\n${JSON.stringify(result.codexPlan, null, 2)}`
            );
            setPhase('awaiting_choice');
          } else {
            addLog('stdout', 'Plans are compatible. Using Codex plan. Press Enter to execute.');
            setSelectedPlan(result.plan);
            setPlanDisplay(JSON.stringify(result.plan, null, 2));
            setPhase('awaiting_choice');
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          addLog('stderr', `Planning failed: ${String(err)}`);
          setPhase('error');
        }
      }
    },
    [loadedConfig, addLog]
  );

  const startExecution = useCallback(
    async (plan: AgentPlan) => {
      if (!loadedConfig) return;
      setPhase('executing');
      addLog('stdout', 'Starting execution...');

      const abort = new AbortController();
      abortRef.current = abort;

      try {
        await runExecuteMode(loadedConfig, submittedPrompt, plan, {
          abortSignal: abort.signal,
          onEvent: makeProcessEventHandler('codex-exec'),
        });
        addLog('stdout', 'Execution complete. Press r to review or Ctrl+C to exit.');
        setPhase('done');
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          addLog('stderr', `Execution failed: ${String(err)}`);
          setPhase('error');
        }
      }
    },
    [loadedConfig, submittedPrompt, addLog, makeProcessEventHandler]
  );

  const startReview = useCallback(async () => {
    if (!loadedConfig) return;
    setPhase('reviewing');
    addLog('stdout', 'Starting review...');

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      await runReviewMode(loadedConfig, {
        abortSignal: abort.signal,
        onEvent: makeProcessEventHandler('codex-review'),
      });
      addLog('stdout', 'Review complete.');
      setPhase('done');
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        addLog('stderr', `Review failed: ${String(err)}`);
        setPhase('error');
      }
    }
  }, [loadedConfig, addLog, makeProcessEventHandler]);

  const startPlanMerge = useCallback(async () => {
    if (!planResult || planResult.status !== 'parity_checked') return;
    if (!loadedConfig) return;

    setPhase('planning');
    const mergeAgent = loadedConfig.config.workflow.mergeAgent;
    addLog('stdout', `Starting auto-merge with ${mergeAgent}...`);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const mergedPlan = await runPlanMergeMode(loadedConfig, planResult.claudePlan, planResult.codexPlan, {
        abortSignal: abort.signal,
        onEvent: makeProcessEventHandler(`${mergeAgent}-merge`),
      });

      // Select the merged plan so Enter executes it after the merge preview is shown.
      setSelectedPlan(mergedPlan);
      setPlanDisplay(JSON.stringify(mergedPlan, null, 2));
      addLog('stdout', 'Auto-merge complete. Press Enter to execute the merged plan, or choose 1/2 to override.');
      setPhase('awaiting_choice');
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        addLog('stderr', `Auto-merge failed: ${String(err)}`);
        setPhase('awaiting_choice');
      }
    }
  }, [loadedConfig, planResult, addLog, makeProcessEventHandler]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      abortRef.current?.abort();
      exit();
      return;
    }

    if (phase === 'awaiting_choice') {
      if (input === '1' && planResult?.status === 'parity_checked') {
        const plan = planResult.claudePlan;
        setSelectedPlan(plan);
        setPlanDisplay(JSON.stringify(plan, null, 2));
        addLog('stdout', 'Using Claude plan.');
        startExecution(plan);
        return;
      }
      if (input === '2' && planResult?.status === 'parity_checked') {
        const plan = planResult.codexPlan;
        setSelectedPlan(plan);
        setPlanDisplay(JSON.stringify(plan, null, 2));
        addLog('stdout', 'Using Codex plan.');
        startExecution(plan);
        return;
      }
      if (input === 'm' && planResult?.status === 'parity_checked') {
        startPlanMerge();
        return;
      }
      if (key.return && selectedPlan) {
        startExecution(selectedPlan);
        return;
      }
    }

    if (phase === 'done' && input === 'r') {
      startReview();
      return;
    }
  });

  const handleSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || phase !== 'idle') return;
      setSubmittedPrompt(trimmed);
      setPrompt('');
      startPlanning(trimmed);
    },
    [phase, startPlanning]
  );

  const activeAgents = Object.keys(loadedConfig?.config.agents ?? {});

  const phaseLabel: Record<Phase, string> = {
    idle: 'idle — enter a request',
    planning: 'planning',
    awaiting_choice: 'awaiting choice',
    executing: 'executing',
    reviewing: 'reviewing',
    done: 'done',
    error: 'error',
  };
  // Treat only agent-running phases as active work for the status animation.
  const isBusy = phase === 'planning' || phase === 'executing' || phase === 'reviewing';

  return (
    <Box flexDirection="column" paddingX={1}>
      <StatusBar
        phase={phaseLabel[phase]}
        targetCwd={loadedConfig?.targetCwd ?? process.cwd()}
        repoRoot={loadedConfig?.repoRoot}
        activeAgents={activeAgents}
        isBusy={isBusy}
      />
      <Box marginTop={1}>
        <PlanPane selectedPlan={planDisplay} />
      </Box>
      <Box marginTop={1}>
        <AgentPane logs={logs} />
      </Box>
      {(phase === 'idle' || phase === 'done') && (
        <Box marginTop={1}>
          <InputRow value={prompt} onChange={setPrompt} onSubmit={handleSubmit} />
        </Box>
      )}
      <Footer phase={phase} />
    </Box>
  );
}
