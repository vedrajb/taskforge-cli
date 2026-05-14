import {AgentPlan} from '../agents/types.js';
import {PlanModeResult} from '../workflows/planMode.js';

export type Phase =
  | 'idle'
  | 'planning'
  | 'awaiting_choice'
  | 'executing'
  | 'reviewing'
  | 'done'
  | 'error';

export type LogLevel = 'output' | 'diagnostic' | 'error';

export type Chunk = {level: LogLevel; text: string; ts: number};

export type SplitColumn = {
  status: 'running' | 'done' | 'failed' | 'aborted';
  chunks: Chunk[];
  startedAt: number;
  endedAt?: number;
  error?: string;
};

export type TranscriptEntry =
  | {kind: 'user'; text: string; ts: number}
  | {kind: 'agent'; agent: string; text: string; level: LogLevel; ts: number}
  | {kind: 'system'; text: string; level: 'info' | 'warn' | 'error'; ts: number}
  | {kind: 'plan'; plan: AgentPlan; source: 'claude' | 'codex' | 'merged'; ts: number}
  | {kind: 'parity'; claudePlan: AgentPlan; codexPlan: AgentPlan; classification: string; reason: string; ts: number}
  | {
      kind: 'prompt_split';
      promptId: string;
      phase: 'planning' | 'review';
      columns: Record<string, SplitColumn>;
      collapsed: boolean;
      ts: number;
    };

export type AppState = {
  entries: TranscriptEntry[];
  phase: Phase;
  draft: string;
  history: string[];
  historyIndex: number;
  planResult: PlanModeResult | null;
  selectedPlan: AgentPlan | null;
  submittedPrompt: string;
  activeSplitId: string | null;
};

export type AppAction =
  | {type: 'append'; entry: TranscriptEntry}
  | {type: 'phase'; phase: Phase}
  | {type: 'draft'; text: string}
  | {type: 'history_nav'; dir: 'up' | 'down'}
  | {type: 'submit'}
  | {type: 'plan_result'; result: PlanModeResult; selectedPlan: AgentPlan | null}
  | {type: 'select_plan'; plan: AgentPlan}
  | {type: 'clear'}
  | {type: 'split_start'; promptId: string; phase: 'planning' | 'review'; agentIds: string[]}
  | {type: 'split_append'; promptId: string; agentId: string; chunk: string; stream: 'stdout' | 'stderr'; exitCode?: number; level?: LogLevel}
  | {type: 'split_agent_done'; promptId: string; agentId: string; status: 'done' | 'failed' | 'aborted'; error?: string}
  | {type: 'split_finalize'; promptId: string}
  | {type: 'split_toggle'; promptId: string};
