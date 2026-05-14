import React, {useCallback, useReducer, useRef, useState} from 'react';
import {Box, useApp, useInput} from 'ink';
import {LoadedConfig} from '../config/loadConfig.js';
import {runPlanMode} from '../workflows/planMode.js';
import {runPlanMergeMode} from '../workflows/planMergeMode.js';
import {runExecuteMode} from '../workflows/executeMode.js';
import {runReviewMode} from '../workflows/reviewMode.js';
import {AgentPlan} from '../agents/types.js';
import {TranscriptEntry} from './types.js';
import {reducer, initialState, planResultToEntries} from './reducer.js';
import {Banner} from './Banner.js';
import {Transcript} from './Transcript.js';
import {Spinner} from './Spinner.js';
import {Composer} from './Composer.js';
import {HintStrip} from './HintStrip.js';
import {isCommandMode} from './commands.js';
import {nanoid} from '../util/nanoid.js';
import {filterChunk} from './filterOutput.js';

export type AppProps = {
  loadedConfig?: LoadedConfig;
  startupError?: string;
};

export function App({loadedConfig, startupError}: AppProps): React.ReactElement {
  const {exit} = useApp();
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState(startupError));
  const abortRef = useRef<AbortController | null>(null);
  const phaseStartRef = useRef<number | null>(null);
  const [showDiag, setShowDiag] = useState(!!process.env['TF_SHOW_DIAG']);

  const addEntry = useCallback((entry: TranscriptEntry) => {
    dispatch({type: 'append', entry});
  }, []);

  const startPlanning = useCallback(
    async (userRequest: string) => {
      if (!loadedConfig) return;
      dispatch({type: 'phase', phase: 'planning'});
      phaseStartRef.current = Date.now();

      const abort = new AbortController();
      abortRef.current = abort;

      const promptId = nanoid();
      const agentIds = loadedConfig.config.workflow.planAgents;

      dispatch({type: 'split_start', promptId, phase: 'planning', agentIds});

      try {
        const result = await runPlanMode(loadedConfig, userRequest, {
          abortSignal: abort.signal,
          onAgentEvent(ev) {
            if (ev.type === 'output' && ev.data) {
              for (const fc of filterChunk(ev.data, ev.agentId)) {
                if (!fc.text.trim()) continue;
                dispatch({
                  type: 'split_append',
                  promptId,
                  agentId: ev.agentId,
                  chunk: fc.text,
                  stream: ev.stream ?? 'stdout',
                  level: fc.level,
                });
              }
            }
            if (ev.type === 'exit') {
              dispatch({
                type: 'split_agent_done',
                promptId,
                agentId: ev.agentId,
                status: ev.code === 0 ? 'done' : 'failed',
                error: ev.code !== 0 ? `exit ${ev.code}` : undefined,
              });
            }
          },
        });

        dispatch({type: 'split_finalize', promptId});
        phaseStartRef.current = null;

        const {entries, selectedPlan} = planResultToEntries(result);
        for (const entry of entries) {
          dispatch({type: 'append', entry});
        }
        dispatch({type: 'plan_result', result, selectedPlan});

        if (result.status === 'both_failed') {
          dispatch({type: 'phase', phase: 'error'});
          return;
        }

        dispatch({type: 'phase', phase: 'awaiting_choice'});
      } catch (err) {
        dispatch({type: 'split_finalize', promptId});
        phaseStartRef.current = null;
        if ((err as Error).name !== 'AbortError') {
          addEntry({kind: 'system', text: `Planning failed: ${String(err)}`, level: 'error', ts: Date.now()});
          dispatch({type: 'phase', phase: 'error'});
        }
      }
    },
    [loadedConfig, addEntry]
  );

  const startExecution = useCallback(
    async (plan: AgentPlan) => {
      if (!loadedConfig) return;
      dispatch({type: 'phase', phase: 'executing'});
      phaseStartRef.current = Date.now();
      addEntry({kind: 'system', text: 'Starting execution…', level: 'info', ts: Date.now()});

      const abort = new AbortController();
      abortRef.current = abort;

      try {
        await runExecuteMode(loadedConfig, state.submittedPrompt, plan, {
          abortSignal: abort.signal,
          onEvent(ev) {
            if (ev.type === 'output') {
              const agentId = loadedConfig.config.workflow.executeAgent;
              for (const fc of filterChunk(ev.data, agentId)) {
                if (!fc.text.trim()) continue;
                addEntry({kind: 'agent', agent: agentId, text: fc.text, level: fc.level, ts: Date.now()});
              }
            }
          },
        });
        phaseStartRef.current = null;
        addEntry({kind: 'system', text: 'Execution complete. /review to review or ↵ for new request.', level: 'info', ts: Date.now()});
        dispatch({type: 'phase', phase: 'done'});
      } catch (err) {
        phaseStartRef.current = null;
        if ((err as Error).name !== 'AbortError') {
          addEntry({kind: 'system', text: `Execution failed: ${String(err)}`, level: 'error', ts: Date.now()});
          dispatch({type: 'phase', phase: 'error'});
        }
      }
    },
    [loadedConfig, state.submittedPrompt, addEntry]
  );

  const startReview = useCallback(async () => {
    if (!loadedConfig) return;
    dispatch({type: 'phase', phase: 'reviewing'});
    phaseStartRef.current = Date.now();
    addEntry({kind: 'system', text: 'Starting review…', level: 'info', ts: Date.now()});

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      await runReviewMode(loadedConfig, {
        abortSignal: abort.signal,
        onEvent(ev) {
          if (ev.type === 'output') {
              const agentId = loadedConfig.config.workflow.reviewAgent;
              for (const fc of filterChunk(ev.data, agentId)) {
                if (!fc.text.trim()) continue;
                addEntry({kind: 'agent', agent: agentId, text: fc.text, level: fc.level, ts: Date.now()});
              }
          }
        },
      });
      phaseStartRef.current = null;
      addEntry({kind: 'system', text: 'Review complete.', level: 'info', ts: Date.now()});
      dispatch({type: 'phase', phase: 'done'});
    } catch (err) {
      phaseStartRef.current = null;
      if ((err as Error).name !== 'AbortError') {
        addEntry({kind: 'system', text: `Review failed: ${String(err)}`, level: 'error', ts: Date.now()});
        dispatch({type: 'phase', phase: 'error'});
      }
    }
  }, [loadedConfig, addEntry]);

  const startPlanMerge = useCallback(async () => {
    const {planResult} = state;
    if (!planResult || planResult.status !== 'parity_checked') return;
    if (!loadedConfig) return;

    dispatch({type: 'phase', phase: 'planning'});
    phaseStartRef.current = Date.now();
    const mergeAgent = loadedConfig.config.workflow.mergeAgent;
    addEntry({kind: 'system', text: `Starting auto-merge with ${mergeAgent}…`, level: 'info', ts: Date.now()});

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const mergedPlan = await runPlanMergeMode(loadedConfig, planResult.claudePlan, planResult.codexPlan, {
        abortSignal: abort.signal,
        onEvent(ev) {
          if (ev.type === 'output') {
            for (const fc of filterChunk(ev.data, mergeAgent)) {
              if (!fc.text.trim()) continue;
              addEntry({kind: 'agent', agent: mergeAgent, text: fc.text, level: fc.level, ts: Date.now()});
            }
          }
        },
      });
      phaseStartRef.current = null;
      dispatch({type: 'select_plan', plan: mergedPlan});
      addEntry({kind: 'plan', plan: mergedPlan, source: 'merged', ts: Date.now()});
      addEntry({kind: 'system', text: 'Auto-merge complete. Press Enter to execute, or 1/2 to override.', level: 'info', ts: Date.now()});
      dispatch({type: 'phase', phase: 'awaiting_choice'});
    } catch (err) {
      phaseStartRef.current = null;
      if ((err as Error).name !== 'AbortError') {
        addEntry({kind: 'system', text: `Auto-merge failed: ${String(err)}`, level: 'error', ts: Date.now()});
        dispatch({type: 'phase', phase: 'awaiting_choice'});
      }
    }
  }, [loadedConfig, state, addEntry]);

  // Global key bindings (outside composer input)
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      abortRef.current?.abort();
      exit();
      return;
    }

    const {phase, planResult, selectedPlan, activeSplitId} = state;

    if (phase === 'awaiting_choice') {
      if (input === '1' && planResult?.status === 'parity_checked') {
        const plan = planResult.claudePlan;
        dispatch({type: 'select_plan', plan});
        addEntry({kind: 'system', text: 'Using Claude plan.', level: 'info', ts: Date.now()});
        startExecution(plan);
        return;
      }
      if (input === '2' && planResult?.status === 'parity_checked') {
        const plan = planResult.codexPlan;
        dispatch({type: 'select_plan', plan});
        addEntry({kind: 'system', text: 'Using Codex plan.', level: 'info', ts: Date.now()});
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

    // Toggle diagnostics fold
    if (input === 'D') {
      setShowDiag((v) => !v);
      return;
    }

    // Expand/collapse active split
    if (input === 'd' && activeSplitId) {
      dispatch({type: 'split_toggle', promptId: activeSplitId});
      return;
    }
  });

  const handleSubmit = useCallback(
    (text: string) => {
      if (state.phase !== 'idle' && state.phase !== 'done') return;
      // Reset to idle if coming from done with a new prompt
      if (state.phase === 'done') {
        dispatch({type: 'phase', phase: 'idle'});
      }
      startPlanning(text);
    },
    [state.phase, startPlanning]
  );

  const handleCommand = useCallback(
    (name: string, args: string) => {
      switch (name) {
        case '/help':
          addEntry({
            kind: 'system',
            text: 'Commands: /plan /execute /review /diff /clear /help /quit /diag',
            level: 'info',
            ts: Date.now(),
          });
          break;
        case '/clear':
          dispatch({type: 'clear'});
          break;
        case '/quit':
          exit();
          break;
        case '/review':
          startReview();
          break;
        case '/execute':
          if (state.selectedPlan) startExecution(state.selectedPlan);
          else addEntry({kind: 'system', text: 'No plan selected. Run a planning request first.', level: 'warn', ts: Date.now()});
          break;
        case '/plan':
          if (args.trim()) {
            dispatch({type: 'draft', text: ''});
            dispatch({type: 'append', entry: {kind: 'user', text: args.trim(), ts: Date.now()}});
            dispatch({type: 'phase', phase: 'idle'});
            startPlanning(args.trim());
          }
          break;
        case '/diag':
          setShowDiag((v) => !v);
          break;
        case '/diff':
          addEntry({kind: 'system', text: 'Use d to expand/collapse the active split block.', level: 'info', ts: Date.now()});
          break;
        default:
          addEntry({kind: 'system', text: `Unknown command: ${name}`, level: 'warn', ts: Date.now()});
      }
    },
    [state.selectedPlan, addEntry, startReview, startExecution, startPlanning, exit]
  );

  // Split finalized entries (for Static) from the active split (for dynamic region)
  const {activeSplitId, entries, phase} = state;

  const activeEntry = activeSplitId
    ? (entries.find(
        (e) => e.kind === 'prompt_split' && e.promptId === activeSplitId
      ) as Extract<TranscriptEntry, {kind: 'prompt_split'}> | undefined) ?? null
    : null;

  const finalizedEntries = activeSplitId
    ? entries.filter((e) => !(e.kind === 'prompt_split' && e.promptId === activeSplitId))
    : entries;

  const composerDisabled = phase === 'planning' || phase === 'executing' || phase === 'reviewing';

  return (
    <Box flexDirection="column">
      <Banner loadedConfig={loadedConfig} />
      <Transcript
        finalizedEntries={finalizedEntries}
        activeEntry={activeEntry}
        showDiag={showDiag}
      />
      <Spinner phase={phase} startedAt={phaseStartRef.current} />
      <Composer
        draft={state.draft}
        dispatch={dispatch}
        onSubmit={handleSubmit}
        onCommand={handleCommand}
        disabled={composerDisabled}
      />
      <HintStrip phase={phase} commandMode={isCommandMode(state.draft)} />
    </Box>
  );
}
