import {loadConfig, LoadedConfig, validateAndWriteConfig} from '../config/loadConfig.js';
import {runPlanMode} from '../workflows/planMode.js';
import {runPlanMergeMode} from '../workflows/planMergeMode.js';
import {runExecuteMode} from '../workflows/executeMode.js';
import {runReviewMode} from '../workflows/reviewMode.js';
import {AgentPlan} from '../agents/types.js';
import {AppState, LogLevel, SplitColumn, TranscriptEntry} from '../tui/types.js';
import {initialState, planResultToEntries, reducer} from '../tui/reducer.js';
import {filterChunk} from '../tui/filterOutput.js';
import {nanoid} from '../util/nanoid.js';

export type TaskForgeSessionEvent =
  | {type: 'state'; snapshot: TaskForgeSnapshot}
  | {type: 'entry'; entry: TranscriptEntry}
  | {type: 'error'; message: string};

export type TaskForgeSnapshot = {
  workspaceRoot: string;
  targetCwd: string;
  repoRoot: string;
  configPath: string;
  configSource: LoadedConfig['configSource'];
  rawConfig: string;
  effectiveConfigJson: string;
  isGitRepository: boolean;
  canRunWorkflows: boolean;
  agents: string[];
  state: AppState;
};

export type TaskForgeSessionOptions = {
  workspaceRoot: string;
  onEvent?: (event: TaskForgeSessionEvent) => void;
};

export class TaskForgeSession {
  private loadedConfig: LoadedConfig;
  private state: AppState;
  private abortController: AbortController | null = null;
  private onEvent?: (event: TaskForgeSessionEvent) => void;

  private constructor(loadedConfig: LoadedConfig, onEvent?: (event: TaskForgeSessionEvent) => void) {
    this.loadedConfig = loadedConfig;
    this.onEvent = onEvent;
    this.state = initialState();

    // Surface non-blocking desktop startup context in the transcript.
    if (loadedConfig.configSource === 'default') {
      this.addEntry({
        kind: 'system',
        text: 'No taskforge.config.json found here. Using bundled defaults.',
        level: 'warn',
        ts: Date.now(),
      });
    }
    if (!loadedConfig.isGitRepository) {
      this.addEntry({
        kind: 'system',
        text: 'This folder is not a Git repository. Initialize Git before planning or execution.',
        level: 'warn',
        ts: Date.now(),
      });
    }
  }

  static async create(options: TaskForgeSessionOptions): Promise<TaskForgeSession> {
    // Desktop sessions are intentionally forgiving so the window can open from any folder.
    const loadedConfig = await loadConfig({
      cwd: options.workspaceRoot,
      allowMissingConfig: true,
      allowMissingGit: true,
    });
    const session = new TaskForgeSession(loadedConfig, options.onEvent);
    session.emitState();
    return session;
  }

  snapshot(): TaskForgeSnapshot {
    // Keep the UI contract small: one snapshot contains all renderable app state.
    return {
      workspaceRoot: this.loadedConfig.workspaceRoot,
      targetCwd: this.loadedConfig.targetCwd,
      repoRoot: this.loadedConfig.repoRoot,
      configPath: this.loadedConfig.configPath,
      configSource: this.loadedConfig.configSource,
      rawConfig: this.loadedConfig.rawConfig,
      effectiveConfigJson: this.loadedConfig.effectiveConfigJson,
      isGitRepository: this.loadedConfig.isGitRepository,
      canRunWorkflows: this.loadedConfig.isGitRepository,
      agents: Object.keys(this.loadedConfig.config.agents),
      state: this.state,
    };
  }

  async submitPrompt(text: string): Promise<void> {
    const prompt = text.trim();
    if (!prompt) return;

    // Only idle or completed sessions can start a new planning cycle.
    if (this.state.phase !== 'idle' && this.state.phase !== 'done') {
      this.addEntry({kind: 'system', text: 'A task is already active.', level: 'warn', ts: Date.now()});
      return;
    }
    if (!this.ensureRunnable()) return;
    if (this.state.phase === 'done') this.dispatch({type: 'phase', phase: 'idle'});

    this.dispatch({type: 'draft', text: prompt});
    this.dispatch({type: 'submit'});
    this.emitState();
    await this.startPlanning(prompt);
  }

  async choosePlan(source: 'claude' | 'codex'): Promise<void> {
    const {planResult} = this.state;
    if (this.state.phase !== 'awaiting_choice' || planResult?.status !== 'parity_checked') {
      this.addEntry({kind: 'system', text: 'No plan choice is waiting.', level: 'warn', ts: Date.now()});
      return;
    }

    // Manual choice maps directly to the plan result that the planners returned.
    const plan = source === 'claude' ? planResult.claudePlan : planResult.codexPlan;
    this.dispatch({type: 'select_plan', plan});
    this.addEntry({kind: 'system', text: `Using ${source === 'claude' ? 'Claude' : 'Codex'} plan.`, level: 'info', ts: Date.now()});
    await this.startExecution(plan);
  }

  async executeSelected(): Promise<void> {
    if (!this.state.selectedPlan) {
      this.addEntry({kind: 'system', text: 'No plan selected. Run planning first.', level: 'warn', ts: Date.now()});
      return;
    }

    // The selected plan is the single source of truth for execution.
    await this.startExecution(this.state.selectedPlan);
  }

  async mergePlans(): Promise<void> {
    const {planResult} = this.state;
    if (!planResult || planResult.status !== 'parity_checked') {
      this.addEntry({kind: 'system', text: 'No divergent plans are available to merge.', level: 'warn', ts: Date.now()});
      return;
    }
    if (!this.ensureRunnable()) return;

    await this.startPlanMerge(planResult.claudePlan, planResult.codexPlan);
  }

  async review(): Promise<void> {
    if (!this.ensureRunnable()) return;

    // Reviews use the configured review agent and stream output into the transcript.
    this.dispatch({type: 'phase', phase: 'reviewing'});
    this.addEntry({kind: 'system', text: 'Starting review...', level: 'info', ts: Date.now()});
    const abort = new AbortController();
    this.abortController = abort;

    try {
      await runReviewMode(this.loadedConfig, {
        abortSignal: abort.signal,
        onEvent: (ev) => this.appendProcessOutput(ev, this.loadedConfig.config.workflow.reviewAgent),
      });
      this.addEntry({kind: 'system', text: 'Review complete.', level: 'info', ts: Date.now()});
      this.dispatch({type: 'phase', phase: 'done'});
    } catch (error: unknown) {
      this.handleTaskError('Review', error);
    } finally {
      this.abortController = null;
      this.emitState();
    }
  }

  cancel(): void {
    const activeTask = this.state.phase === 'planning'
      || this.state.phase === 'executing'
      || this.state.phase === 'reviewing';

    if (activeTask) {
      // Running work exits through its AbortSignal-aware workflow catch path.
      this.abortController?.abort();
      return;
    }

    if (this.state.phase === 'awaiting_choice') {
      // Pending choices have no process to abort, so reset local selection state.
      this.dispatch({type: 'cancel_plan_choice'});
      this.addEntry({kind: 'system', text: 'Pending plan cancelled.', level: 'info', ts: Date.now()});
    }
  }

  clear(): void {
    // Keep clear local to the transcript; config and workspace context remain loaded.
    this.dispatch({type: 'clear'});
    this.emitState();
  }

  async saveSettings(rawJson: string): Promise<void> {
    const busy = this.state.phase === 'planning'
      || this.state.phase === 'executing'
      || this.state.phase === 'reviewing'
      || this.state.phase === 'awaiting_choice';

    if (busy) {
      this.addEntry({kind: 'system', text: 'Settings cannot be saved while a task is active.', level: 'warn', ts: Date.now()});
      return;
    }

    // Validate and write first, then reload so derived paths and schema defaults refresh together.
    await validateAndWriteConfig(rawJson, this.loadedConfig.configPath);
    this.loadedConfig = await loadConfig({
      cwd: this.loadedConfig.workspaceRoot,
      allowMissingConfig: true,
      allowMissingGit: true,
    });
    this.addEntry({kind: 'system', text: `Settings saved: ${this.loadedConfig.configPath}`, level: 'info', ts: Date.now()});
    this.emitState();
  }

  private async startPlanning(userRequest: string): Promise<void> {
    this.dispatch({type: 'phase', phase: 'planning'});
    const abort = new AbortController();
    this.abortController = abort;

    // Represent multi-agent planning as the same prompt split model used by the TUI.
    const promptId = nanoid();
    const agentIds = this.loadedConfig.config.workflow.planAgents;
    this.dispatch({type: 'split_start', promptId, phase: 'planning', agentIds});
    this.emitState();

    try {
      const result = await runPlanMode(this.loadedConfig, userRequest, {
        abortSignal: abort.signal,
        onAgentEvent: (ev) => {
          if (ev.type === 'output' && ev.data) {
            this.appendSplitOutput(promptId, ev.agentId, ev.data, ev.stream ?? 'stdout');
          }
          if (ev.type === 'exit') {
            this.dispatch({
              type: 'split_agent_done',
              promptId,
              agentId: ev.agentId,
              status: ev.code === 0 ? 'done' : 'failed',
              error: ev.code !== 0 ? `exit ${ev.code}` : undefined,
            });
            this.emitState();
          }
        },
      });

      this.dispatch({type: 'split_finalize', promptId});
      const {entries, selectedPlan} = planResultToEntries(result);
      for (const entry of entries) this.addEntry(entry);
      this.dispatch({type: 'plan_result', result, selectedPlan});
      this.dispatch({type: 'phase', phase: result.status === 'both_failed' ? 'error' : 'awaiting_choice'});
    } catch (error: unknown) {
      this.dispatch({type: 'split_finalize', promptId});
      this.handleTaskError('Planning', error);
    } finally {
      this.abortController = null;
      this.emitState();
    }
  }

  private async startExecution(plan: AgentPlan): Promise<void> {
    if (!this.ensureRunnable()) return;

    // Execution uses the currently submitted prompt plus the selected plan artifact.
    this.dispatch({type: 'phase', phase: 'executing'});
    this.addEntry({kind: 'system', text: 'Starting execution...', level: 'info', ts: Date.now()});
    const abort = new AbortController();
    this.abortController = abort;

    try {
      await runExecuteMode(this.loadedConfig, this.state.submittedPrompt, plan, {
        abortSignal: abort.signal,
        onEvent: (ev) => this.appendProcessOutput(ev, this.loadedConfig.config.workflow.executeAgent),
      });
      this.addEntry({kind: 'system', text: 'Execution complete. Run review or start a new request.', level: 'info', ts: Date.now()});
      this.dispatch({type: 'phase', phase: 'done'});
    } catch (error: unknown) {
      this.handleTaskError('Execution', error);
    } finally {
      this.abortController = null;
      this.emitState();
    }
  }

  private async startPlanMerge(claudePlan: AgentPlan, codexPlan: AgentPlan): Promise<void> {
    this.dispatch({type: 'phase', phase: 'planning'});
    const mergeAgent = this.loadedConfig.config.workflow.mergeAgent;
    this.addEntry({kind: 'system', text: `Starting auto-merge with ${mergeAgent}...`, level: 'info', ts: Date.now()});
    const abort = new AbortController();
    this.abortController = abort;

    try {
      const mergedPlan = await runPlanMergeMode(this.loadedConfig, claudePlan, codexPlan, {
        abortSignal: abort.signal,
        onEvent: (ev) => this.appendProcessOutput(ev, mergeAgent),
      });
      this.dispatch({type: 'select_plan', plan: mergedPlan});
      this.addEntry({kind: 'plan', plan: mergedPlan, source: 'merged', ts: Date.now()});
      this.addEntry({kind: 'system', text: 'Auto-merge complete. Execute when ready.', level: 'info', ts: Date.now()});
      this.dispatch({type: 'phase', phase: 'awaiting_choice'});
    } catch (error: unknown) {
      this.handleTaskError('Auto-merge', error, 'awaiting_choice');
    } finally {
      this.abortController = null;
      this.emitState();
    }
  }

  private appendSplitOutput(promptId: string, agentId: string, data: string, stream: 'stdout' | 'stderr'): void {
    // Split chunks are filtered the same way as the terminal UI to hide diagnostics by default.
    for (const filtered of filterChunk(data, agentId)) {
      if (!filtered.text.trim()) continue;
      this.dispatch({
        type: 'split_append',
        promptId,
        agentId,
        chunk: filtered.text,
        stream,
        level: filtered.level,
      });
    }
    this.emitState();
  }

  private appendProcessOutput(
    event: {type: 'output' | 'exit'; stream?: 'stdout' | 'stderr'; data?: string; code?: number | null},
    agentId: string
  ): void {
    if (event.type !== 'output' || !event.data) return;

    // Single-agent phases append directly to the transcript.
    for (const filtered of filterChunk(event.data, agentId)) {
      if (!filtered.text.trim()) continue;
      this.addEntry({kind: 'agent', agent: agentId, text: filtered.text, level: filtered.level as LogLevel, ts: Date.now()});
    }
  }

  private handleTaskError(label: string, error: unknown, fallbackPhase: AppState['phase'] = 'idle'): void {
    const err = error as Error;
    if (err.name === 'AbortError') {
      // User cancellation is not an error; return to a usable idle state.
      this.addEntry({kind: 'system', text: `${label} cancelled.`, level: 'info', ts: Date.now()});
      this.dispatch({type: 'phase', phase: fallbackPhase});
      return;
    }

    this.addEntry({kind: 'system', text: `${label} failed: ${String(error)}`, level: 'error', ts: Date.now()});
    this.dispatch({type: 'phase', phase: 'error'});
    this.onEvent?.({type: 'error', message: String(error)});
  }

  private ensureRunnable(): boolean {
    if (this.loadedConfig.isGitRepository) return true;

    // Workflows require a Git-aware workspace because agents execute against repository state.
    this.addEntry({
      kind: 'system',
      text: 'This workspace is not a Git repository. Initialize Git or open a repository folder first.',
      level: 'error',
      ts: Date.now(),
    });
    return false;
  }

  private dispatch(action: Parameters<typeof reducer>[1]): void {
    this.state = reducer(this.state, action);
  }

  private addEntry(entry: TranscriptEntry): void {
    this.dispatch({type: 'append', entry});
    this.onEvent?.({type: 'entry', entry});
    this.emitState();
  }

  private emitState(): void {
    // Emit full snapshots so the desktop UI can recover after reconnects or missed events.
    this.onEvent?.({type: 'state', snapshot: this.snapshot()});
  }
}
