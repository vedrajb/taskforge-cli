import {matchesKey} from '@mariozechner/pi-tui';
import {loadConfig, LoadedConfig} from './config/loadConfig.js';
import {PiTuiScreen} from './tui/screen.js';
import {runPlanMode} from './workflows/planMode.js';
import {runPlanMergeMode} from './workflows/planMergeMode.js';
import {runExecuteMode} from './workflows/executeMode.js';
import {runReviewMode} from './workflows/reviewMode.js';
import {AgentPlan} from './agents/types.js';
import {TranscriptEntry, Phase, AppState, SplitColumn, LogLevel} from './tui/types.js';
import {reducer, initialState, planResultToEntries} from './tui/reducer.js';
import {parseCommand, isCommandMode} from './tui/commands.js';
import {filterChunk} from './tui/filterOutput.js';
import {nanoid} from './util/nanoid.js';

const PKG_VERSION = '0.1.0';

const HINTS: Record<Phase, string> = {
  idle:            '? help  ·  /commands  ·  ctrl+c quit',
  planning:        'esc cancel  ·  ctrl+c quit',
  awaiting_choice: '↵ accept  ·  1 claude  ·  2 codex  ·  m merge  ·  esc cancel  ·  ctrl+c quit',
  executing:       'esc cancel  ·  ctrl+c quit',
  reviewing:       'esc cancel  ·  ctrl+c quit',
  done:            '/review  ·  ↵ new request  ·  ctrl+c quit',
  error:           '/plan retry  ·  ctrl+c quit',
};

class TaskForgeApp {
  private screen: PiTuiScreen;
  private state: AppState;
  private loadedConfig: LoadedConfig | undefined;
  private abortController: AbortController | null = null;
  private phaseStart: number | null = null;

  constructor(loadedConfig: LoadedConfig | undefined, startupError?: string) {
    this.loadedConfig = loadedConfig;
    this.state = initialState(startupError);

    this.screen = new PiTuiScreen({
      onSubmit: (text) => this.handleInput(text),
      onKey: (data) => this.handleKeypress(data),
    });
  }

  async run(): Promise<void> {
    // Banner
    const cwd = this.loadedConfig?.targetCwd ?? process.cwd();
    const agents = this.loadedConfig ? Object.keys(this.loadedConfig.config.agents).join('+') : 'none';
    const repo = this.loadedConfig?.repoRoot;
    const repoSuffix = repo ? ` (${repo.split(/[/\\]/).pop() ?? repo})` : '';
    this.screen.banner(`taskforge v${PKG_VERSION}  ·  ${agents}  ·  ${cwd}${repoSuffix}`);

    // Flush initial state entries (the "ready." message or startup error)
    for (const entry of this.state.entries) {
      this.screen.appendEntry(entry);
    }
    this.screen.setHint(HINTS[this.state.phase]);
    this.screen.setEditorDisabled(false);

    await this.screen.start();
  }

  private dispatch(action: Parameters<typeof reducer>[1]): void {
    this.state = reducer(this.state, action);
  }

  private addEntry(entry: TranscriptEntry): void {
    this.dispatch({type: 'append', entry});
    this.screen.appendEntry(entry);
  }

  private setPhase(phase: Phase): void {
    this.dispatch({type: 'phase', phase});
    // Keep the footer aligned with whether Esc cancels work or Ctrl+C quits.
    this.screen.setHint(isCommandMode(this.state.draft)
      ? '/plan /execute /review /diff /clear /help /quit'
      : HINTS[phase]);
    const busy = phase === 'planning' || phase === 'executing' || phase === 'reviewing';
    this.screen.setEditorDisabled(busy);
  }

  private handleKeypress(data: string): boolean {
    const {phase, planResult, selectedPlan, activeSplitId} = this.state;

    if (phase === 'awaiting_choice') {
      if (data === '1' && planResult?.status === 'parity_checked') {
        const plan = planResult.claudePlan;
        this.dispatch({type: 'select_plan', plan});
        this.addEntry({kind: 'system', text: 'Using Claude plan.', level: 'info', ts: Date.now()});
        void this.startExecution(plan);
        return true;
      }
      if (data === '2' && planResult?.status === 'parity_checked') {
        const plan = planResult.codexPlan;
        this.dispatch({type: 'select_plan', plan});
        this.addEntry({kind: 'system', text: 'Using Codex plan.', level: 'info', ts: Date.now()});
        void this.startExecution(plan);
        return true;
      }
      if (data === 'm' && planResult?.status === 'parity_checked') {
        void this.startPlanMerge();
        return true;
      }
      if (matchesKey(data, 'return') && selectedPlan) {
        void this.startExecution(selectedPlan);
        return true;
      }
    }

    if (matchesKey(data, 'escape')) {
      return this.cancelCurrentInteraction();
    }

    if (data === 'D') {
      this.screen.toggleDiag();
      return true;
    }

    if (data === 'd' && activeSplitId) {
      this.dispatch({type: 'split_toggle', promptId: activeSplitId});
      const entry = this.state.entries.find(
        (e) => e.kind === 'prompt_split' && e.promptId === activeSplitId
      ) as Extract<TranscriptEntry, {kind: 'prompt_split'}> | undefined;
      if (entry) this.screen.updateSplit(entry);
      return true;
    }

    return false;
  }

  private cancelCurrentInteraction(): boolean {
    const cancellableTask = this.state.phase === 'planning'
      || this.state.phase === 'executing'
      || this.state.phase === 'reviewing';

    if (cancellableTask) {
      // Active work owns an AbortController; its catch block restores the idle phase.
      this.abortController?.abort();
      return true;
    }

    if (this.state.phase === 'awaiting_choice') {
      // Awaiting choice has no running process, so clear the selected plan directly.
      this.dispatch({type: 'cancel_plan_choice'});
      this.screen.setHint(HINTS.idle);
      this.screen.setEditorDisabled(false);
      this.addEntry({kind: 'system', text: 'Pending plan cancelled.', level: 'info', ts: Date.now()});
      return true;
    }

    return false;
  }

  private handleInput(text: string): void {
    const {phase} = this.state;

    const cmd = parseCommand(text);
    if (cmd) {
      this.handleCommand(cmd.name, cmd.args);
      return;
    }

    if (phase !== 'idle' && phase !== 'done') return;
    if (phase === 'done') this.setPhase('idle');

    this.dispatch({type: 'submit'});
    this.screen.appendEntry({kind: 'user', text, ts: Date.now()});
    void this.startPlanning(text);
  }

  private handleCommand(name: string, args: string): void {
    switch (name) {
      case '/help':
        this.addEntry({kind: 'system', text: 'Commands: /plan /execute /review /diff /clear /help /quit /diag', level: 'info', ts: Date.now()});
        break;
      case '/clear':
        this.dispatch({type: 'clear'});
        // Rebuild screen from scratch — simplest approach for clear
        this.addEntry({kind: 'system', text: 'transcript cleared.', level: 'info', ts: Date.now()});
        break;
      case '/quit':
        this.screen.stop();
        break;
      case '/review':
        void this.startReview();
        break;
      case '/execute':
        if (this.state.selectedPlan) void this.startExecution(this.state.selectedPlan);
        else this.addEntry({kind: 'system', text: 'No plan selected. Run a planning request first.', level: 'warn', ts: Date.now()});
        break;
      case '/plan':
        if (args.trim()) {
          this.dispatch({type: 'phase', phase: 'idle'});
          this.screen.appendEntry({kind: 'user', text: args.trim(), ts: Date.now()});
          void this.startPlanning(args.trim());
        }
        break;
      case '/diag':
        this.screen.toggleDiag();
        break;
      case '/diff':
        this.addEntry({kind: 'system', text: 'Press d to expand/collapse the active split block.', level: 'info', ts: Date.now()});
        break;
      default:
        this.addEntry({kind: 'system', text: `Unknown command: ${name}`, level: 'warn', ts: Date.now()});
    }
  }

  private async startPlanning(userRequest: string): Promise<void> {
    if (!this.loadedConfig) return;

    this.setPhase('planning');
    this.phaseStart = Date.now();
    this.screen.startSpinner('planning…');

    const abort = new AbortController();
    this.abortController = abort;

    const promptId = nanoid();
    const agentIds = this.loadedConfig.config.workflow.planAgents;

    // Build the split entry in state
    const now = Date.now();
    const columns: Record<string, SplitColumn> = {};
    for (const id of agentIds) {
      columns[id] = {status: 'running', chunks: [], startedAt: now};
    }
    const splitEntry: Extract<TranscriptEntry, {kind: 'prompt_split'}> = {
      kind: 'prompt_split',
      promptId,
      phase: 'planning',
      columns,
      collapsed: false,
      ts: now,
    };
    this.dispatch({type: 'split_start', promptId, phase: 'planning', agentIds});
    this.screen.beginSplit(splitEntry);

    const getUpdatedSplit = (): Extract<TranscriptEntry, {kind: 'prompt_split'}> =>
      this.state.entries.find(
        (e) => e.kind === 'prompt_split' && e.promptId === promptId
      ) as Extract<TranscriptEntry, {kind: 'prompt_split'}>;

    try {
      const result = await runPlanMode(this.loadedConfig, userRequest, {
        abortSignal: abort.signal,
        onAgentEvent: (ev) => {
          if (ev.type === 'output' && ev.data) {
            for (const fc of filterChunk(ev.data, ev.agentId)) {
              if (!fc.text.trim()) continue;
              this.dispatch({
                type: 'split_append',
                promptId,
                agentId: ev.agentId,
                chunk: fc.text,
                stream: ev.stream ?? 'stdout',
                level: fc.level,
              });
              this.screen.updateSplit(getUpdatedSplit());
            }
          }
          if (ev.type === 'exit') {
            this.dispatch({
              type: 'split_agent_done',
              promptId,
              agentId: ev.agentId,
              status: ev.code === 0 ? 'done' : 'failed',
              error: ev.code !== 0 ? `exit ${ev.code}` : undefined,
            });
            this.screen.updateSplit(getUpdatedSplit());
          }
        },
      });

      this.dispatch({type: 'split_finalize', promptId});
      // Push the collapsed state into the widget so the final render shows ✓/✗.
      this.screen.updateSplit(getUpdatedSplit());
      this.screen.finalizeSplit();
      this.screen.stopSpinner();
      this.phaseStart = null;

      const {entries, selectedPlan} = planResultToEntries(result);
      for (const entry of entries) {
        this.addEntry(entry);
      }
      this.dispatch({type: 'plan_result', result, selectedPlan});

      if (result.status === 'both_failed') {
        this.setPhase('error');
        return;
      }
      this.setPhase('awaiting_choice');
    } catch (err) {
      this.dispatch({type: 'split_finalize', promptId});
      this.screen.finalizeSplit();
      this.screen.stopSpinner();
      this.phaseStart = null;
      if ((err as Error).name !== 'AbortError') {
        this.addEntry({kind: 'system', text: `Planning failed: ${String(err)}`, level: 'error', ts: Date.now()});
        this.setPhase('error');
      } else {
        this.setPhase('idle');
      }
    }
  }

  private async startExecution(plan: AgentPlan): Promise<void> {
    if (!this.loadedConfig) return;

    this.setPhase('executing');
    this.phaseStart = Date.now();
    this.screen.startSpinner('executing…');
    this.addEntry({kind: 'system', text: 'Starting execution…', level: 'info', ts: Date.now()});

    const abort = new AbortController();
    this.abortController = abort;

    try {
      await runExecuteMode(this.loadedConfig, this.state.submittedPrompt, plan, {
        abortSignal: abort.signal,
        onEvent: (ev) => {
          if (ev.type === 'output') {
            const agentId = this.loadedConfig!.config.workflow.executeAgent;
            for (const fc of filterChunk(ev.data, agentId)) {
              if (!fc.text.trim()) continue;
              this.addEntry({kind: 'agent', agent: agentId, text: fc.text, level: fc.level, ts: Date.now()});
            }
          }
        },
      });
      this.screen.stopSpinner();
      this.phaseStart = null;
      this.addEntry({kind: 'system', text: 'Execution complete. /review to review or ↵ for new request.', level: 'info', ts: Date.now()});
      this.setPhase('done');
    } catch (err) {
      this.screen.stopSpinner();
      this.phaseStart = null;
      if ((err as Error).name !== 'AbortError') {
        this.addEntry({kind: 'system', text: `Execution failed: ${String(err)}`, level: 'error', ts: Date.now()});
        this.setPhase('error');
      } else {
        this.setPhase('idle');
      }
    }
  }

  private async startReview(): Promise<void> {
    if (!this.loadedConfig) return;

    this.setPhase('reviewing');
    this.phaseStart = Date.now();
    this.screen.startSpinner('reviewing…');
    this.addEntry({kind: 'system', text: 'Starting review…', level: 'info', ts: Date.now()});

    const abort = new AbortController();
    this.abortController = abort;

    try {
      await runReviewMode(this.loadedConfig, {
        abortSignal: abort.signal,
        onEvent: (ev) => {
          if (ev.type === 'output') {
            const agentId = this.loadedConfig!.config.workflow.reviewAgent;
            for (const fc of filterChunk(ev.data, agentId)) {
              if (!fc.text.trim()) continue;
              this.addEntry({kind: 'agent', agent: agentId, text: fc.text, level: fc.level, ts: Date.now()});
            }
          }
        },
      });
      this.screen.stopSpinner();
      this.phaseStart = null;
      this.addEntry({kind: 'system', text: 'Review complete.', level: 'info', ts: Date.now()});
      this.setPhase('done');
    } catch (err) {
      this.screen.stopSpinner();
      this.phaseStart = null;
      if ((err as Error).name !== 'AbortError') {
        this.addEntry({kind: 'system', text: `Review failed: ${String(err)}`, level: 'error', ts: Date.now()});
        this.setPhase('error');
      } else {
        this.setPhase('idle');
      }
    }
  }

  private async startPlanMerge(): Promise<void> {
    const {planResult} = this.state;
    if (!planResult || planResult.status !== 'parity_checked') return;
    if (!this.loadedConfig) return;

    this.setPhase('planning');
    this.phaseStart = Date.now();
    const mergeAgent = this.loadedConfig.config.workflow.mergeAgent;
    this.screen.startSpinner('merging plans…');
    this.addEntry({kind: 'system', text: `Starting auto-merge with ${mergeAgent}…`, level: 'info', ts: Date.now()});

    const abort = new AbortController();
    this.abortController = abort;

    try {
      const mergedPlan = await runPlanMergeMode(
        this.loadedConfig,
        planResult.claudePlan,
        planResult.codexPlan,
        {
          abortSignal: abort.signal,
          onEvent: (ev) => {
            if (ev.type === 'output') {
              for (const fc of filterChunk(ev.data, mergeAgent)) {
                if (!fc.text.trim()) continue;
                this.addEntry({kind: 'agent', agent: mergeAgent, text: fc.text, level: fc.level, ts: Date.now()});
              }
            }
          },
        }
      );
      this.screen.stopSpinner();
      this.phaseStart = null;
      this.dispatch({type: 'select_plan', plan: mergedPlan});
      this.addEntry({kind: 'plan', plan: mergedPlan, source: 'merged', ts: Date.now()});
      this.addEntry({kind: 'system', text: 'Auto-merge complete. Press Enter to execute, or 1/2 to override.', level: 'info', ts: Date.now()});
      this.setPhase('awaiting_choice');
    } catch (err) {
      this.screen.stopSpinner();
      this.phaseStart = null;
      if ((err as Error).name !== 'AbortError') {
        this.addEntry({kind: 'system', text: `Auto-merge failed: ${String(err)}`, level: 'error', ts: Date.now()});
      }
      this.setPhase('awaiting_choice');
    }
  }
}

export async function main(_argv: string[]): Promise<void> {
  let startupError: string | undefined;
  const loadedConfig = await loadConfig().catch((error: unknown) => {
    startupError = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
    return undefined;
  });

  const app = new TaskForgeApp(loadedConfig, startupError);
  await app.run();
}
