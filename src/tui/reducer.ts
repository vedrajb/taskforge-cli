import {AppState, AppAction, TranscriptEntry, LogLevel, SplitColumn} from './types.js';
import {PlanModeResult} from '../workflows/planMode.js';

function classifyChunk(stream: 'stdout' | 'stderr', exitCode?: number): LogLevel {
  if (stream === 'stdout') return 'output';
  return exitCode != null && exitCode !== 0 ? 'error' : 'diagnostic';
}

export function initialState(startupError?: string): AppState {
  const entry: TranscriptEntry = startupError
    ? {kind: 'system', text: startupError, level: 'error', ts: Date.now()}
    : {kind: 'system', text: 'ready. type a request, or /help for commands.', level: 'info', ts: Date.now()};
  return {
    entries: [entry],
    phase: startupError ? 'error' : 'idle',
    draft: '',
    history: [],
    historyIndex: -1,
    planResult: null,
    selectedPlan: null,
    submittedPrompt: '',
    activeSplitId: null,
  };
}

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'append':
      return {...state, entries: [...state.entries, action.entry]};

    case 'phase':
      return {...state, phase: action.phase};

    case 'draft':
      return {...state, draft: action.text, historyIndex: -1};

    case 'history_nav': {
      const {history, historyIndex} = state;
      if (history.length === 0) return state;
      const nextIndex =
        action.dir === 'up'
          ? Math.min(historyIndex + 1, history.length - 1)
          : Math.max(historyIndex - 1, -1);
      const draft = nextIndex === -1 ? '' : (history[history.length - 1 - nextIndex] ?? '');
      return {...state, historyIndex: nextIndex, draft};
    }

    case 'submit': {
      const text = state.draft.trim();
      if (!text) return state;
      const entry: TranscriptEntry = {kind: 'user', text, ts: Date.now()};
      return {
        ...state,
        entries: [...state.entries, entry],
        history: [...state.history, text],
        historyIndex: -1,
        draft: '',
        submittedPrompt: text,
      };
    }

    case 'plan_result': {
      return {...state, planResult: action.result, selectedPlan: action.selectedPlan};
    }

    case 'select_plan':
      return {...state, selectedPlan: action.plan};

    case 'cancel_plan_choice':
      // Clear the pending plan decision so Enter cannot execute a stale selection.
      return {...state, phase: 'idle', planResult: null, selectedPlan: null};

    case 'clear':
      return {
        ...state,
        entries: [{kind: 'system', text: 'transcript cleared.', level: 'info', ts: Date.now()}],
        activeSplitId: null,
      };

    case 'split_start': {
      const now = Date.now();
      const columns: Record<string, SplitColumn> = {};
      for (const id of action.agentIds) {
        columns[id] = {status: 'running', chunks: [], startedAt: now};
      }
      const entry: TranscriptEntry = {
        kind: 'prompt_split',
        promptId: action.promptId,
        phase: action.phase,
        columns,
        collapsed: false,
        ts: now,
      };
      return {
        ...state,
        entries: [...state.entries, entry],
        activeSplitId: action.promptId,
      };
    }

    case 'split_append': {
      const level = action.level ?? classifyChunk(action.stream, action.exitCode);
      return {
        ...state,
        entries: state.entries.map((e) => {
          if (e.kind !== 'prompt_split' || e.promptId !== action.promptId) return e;
          const col = e.columns[action.agentId];
          if (!col) return e;
          const updatedCol: SplitColumn = {
            ...col,
            chunks: [...col.chunks, {level, text: action.chunk, ts: Date.now()}],
          };
          return {...e, columns: {...e.columns, [action.agentId]: updatedCol}};
        }),
      };
    }

    case 'split_agent_done': {
      return {
        ...state,
        entries: state.entries.map((e) => {
          if (e.kind !== 'prompt_split' || e.promptId !== action.promptId) return e;
          const col = e.columns[action.agentId];
          if (!col) return e;
          // Re-classify diagnostic chunks as error if agent exited non-zero.
          const chunks =
            action.status === 'failed'
              ? col.chunks.map((c) => (c.level === 'diagnostic' ? {...c, level: 'error' as LogLevel} : c))
              : col.chunks;
          const updatedCol: SplitColumn = {
            ...col,
            status: action.status,
            chunks,
            endedAt: Date.now(),
            error: action.error,
          };
          return {...e, columns: {...e.columns, [action.agentId]: updatedCol}};
        }),
      };
    }

    case 'split_finalize': {
      return {
        ...state,
        activeSplitId: null,
        entries: state.entries.map((e) => {
          if (e.kind !== 'prompt_split' || e.promptId !== action.promptId) return e;
          return {...e, collapsed: true};
        }),
      };
    }

    case 'split_toggle': {
      return {
        ...state,
        entries: state.entries.map((e) => {
          if (e.kind !== 'prompt_split' || e.promptId !== action.promptId) return e;
          return {...e, collapsed: !e.collapsed};
        }),
      };
    }

    default:
      return state;
  }
}

export function selectSplitEntry(state: AppState, promptId: string) {
  return state.entries.find(
    (e) => e.kind === 'prompt_split' && e.promptId === promptId
  ) as Extract<typeof state.entries[number], {kind: 'prompt_split'}> | undefined;
}

export function planResultToEntries(result: PlanModeResult): {
  entries: Array<Extract<ReturnType<typeof reducer>['entries'][number], {kind: 'system' | 'plan' | 'parity'}>>;
  selectedPlan: import('../agents/types.js').AgentPlan | null;
} {
  const ts = Date.now();
  const entries: Array<Extract<AppState['entries'][number], {kind: 'system' | 'plan' | 'parity'}>> = [];
  let selectedPlan = null;

  if (result.status === 'both_failed') {
    entries.push({kind: 'system', text: `Both agents failed. Claude: ${result.claudeError}`, level: 'error', ts});
    entries.push({kind: 'system', text: `Codex: ${result.codexError}`, level: 'error', ts: ts + 1});
    return {entries, selectedPlan};
  }

  if (result.status === 'single_agent') {
    entries.push({kind: 'system', text: `One agent failed: ${result.otherError}`, level: 'warn', ts});
    entries.push({kind: 'system', text: `Proceeding with ${result.agentId} plan. Press Enter to continue.`, level: 'info', ts: ts + 1});
    entries.push({kind: 'plan', plan: result.plan, source: result.agentId as 'claude' | 'codex', ts: ts + 2});
    selectedPlan = result.plan;
    return {entries, selectedPlan};
  }

  if (result.status === 'aligned') {
    entries.push({kind: 'system', text: 'Plans are aligned. Using Codex plan.', level: 'info', ts});
    entries.push({kind: 'plan', plan: result.plan, source: 'codex', ts: ts + 1});
    selectedPlan = result.plan;
    return {entries, selectedPlan};
  }

  if (result.status === 'parity_checked') {
    const {parity} = result;
    entries.push({
      kind: 'parity',
      claudePlan: result.claudePlan,
      codexPlan: result.codexPlan,
      classification: parity.classification,
      reason: parity.reason,
      ts,
    });
    if (parity.classification === 'materially_different') {
      // Show both competing plans before asking the user to choose one.
      entries.push({kind: 'plan', plan: result.claudePlan, source: 'claude', ts: ts + 1});
      entries.push({kind: 'plan', plan: result.codexPlan, source: 'codex', ts: ts + 2});
      entries.push({
        kind: 'system',
        text: 'Plans differ. Both plans shown above. Press 1=Claude  2=Codex  m=auto-merge  Esc=cancel.',
        level: 'warn',
        ts: ts + 3,
      });
    } else {
      entries.push({kind: 'plan', plan: result.plan, source: 'codex', ts: ts + 1});
      entries.push({kind: 'system', text: 'Plans compatible. Using Codex plan. Press Enter to execute.', level: 'info', ts: ts + 2});
      selectedPlan = result.plan;
    }
  }

  return {entries, selectedPlan};
}
