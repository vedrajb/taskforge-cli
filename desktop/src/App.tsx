import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {Command, type Child} from '@tauri-apps/plugin-shell';
import {AlertTriangle, CheckCircle2, FileJson, GitBranch, Play, RefreshCw, RotateCcw, Save, Send, Settings, StopCircle} from 'lucide-react';

type Phase = 'idle' | 'planning' | 'awaiting_choice' | 'executing' | 'reviewing' | 'done' | 'error';
type LogLevel = 'output' | 'diagnostic' | 'error';
type AgentPlan = {goal: string; summary: string; steps: Array<{title: string; detail?: string}>; risks?: string[]; openQuestions?: string[]};
type SplitColumn = {status: 'running' | 'done' | 'failed' | 'aborted'; chunks: Array<{level: LogLevel; text: string; ts: number}>; startedAt: number; endedAt?: number; error?: string};
type TranscriptEntry =
  | {kind: 'user'; text: string; ts: number}
  | {kind: 'agent'; agent: string; text: string; level: LogLevel; ts: number}
  | {kind: 'system'; text: string; level: 'info' | 'warn' | 'error'; ts: number}
  | {kind: 'plan'; plan: AgentPlan; source: 'claude' | 'codex' | 'merged'; ts: number}
  | {kind: 'parity'; claudePlan: AgentPlan; codexPlan: AgentPlan; classification: string; reason: string; ts: number}
  | {kind: 'prompt_split'; promptId: string; phase: 'planning' | 'review'; columns: Record<string, SplitColumn>; collapsed: boolean; ts: number};

type Snapshot = {
  workspaceRoot: string;
  targetCwd: string;
  repoRoot: string;
  configPath: string;
  saveConfigPath: string;
  configSource: 'workspace' | 'global' | 'default';
  rawConfig: string;
  effectiveConfigJson: string;
  isGitRepository: boolean;
  canRunWorkflows: boolean;
  agents: string[];
  state: {
    entries: TranscriptEntry[];
    phase: Phase;
    selectedPlan: AgentPlan | null;
    activeSplitId: string | null;
  };
};

type LaunchContext = {root: string; workerPath: string; packageRoot: string};
type WorkerResponse =
  | {type: 'ready'}
  | {type: 'ack'; id?: string}
  | {type: 'error'; id?: string; message: string}
  | {type: 'event'; event: {type: 'state'; snapshot: Snapshot} | {type: 'error'; message: string} | {type: 'entry'; entry: TranscriptEntry}};

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState('');
  const [activeTab, setActiveTab] = useState<'transcript' | 'settings'>('transcript');
  const [settingsView, setSettingsView] = useState<'raw' | 'effective'>('raw');
  const [settingsRaw, setSettingsRaw] = useState('');
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [status, setStatus] = useState('starting desktop worker...');
  const [workerError, setWorkerError] = useState<string | null>(null);
  const childRef = useRef<Child | null>(null);
  const lineBuffer = useRef('');
  const configIdentityRef = useRef('');
  const pendingSettingsSaveRef = useRef(false);

  const busy = snapshot?.state.phase === 'planning'
    || snapshot?.state.phase === 'executing'
    || snapshot?.state.phase === 'reviewing';
  const canExecute = Boolean(snapshot?.state.selectedPlan);

  useEffect(() => {
    // Start the Node worker once per window and clean it up with the window.
    let disposed = false;
    void startWorker((response) => {
      if (disposed) return;
      handleWorkerResponse(response, setSnapshot, setStatus, setWorkerError, setSettingsNotice, pendingSettingsSaveRef);
    }, childRef, lineBuffer).catch((error: unknown) => {
      if (!disposed) setWorkerError(error instanceof Error ? error.message : String(error));
    });

    return () => {
      disposed = true;
      void childRef.current?.kill();
    };
  }, []);

  useEffect(() => {
    // Esc is a global stop shortcut for the active desktop task.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      void sendWorkerRequest(childRef.current, {type: 'cancel'});
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!snapshot) return;

    // Refresh the editor when the loaded settings source changes or no local edits exist.
    const identity = `${snapshot.configSource}:${snapshot.configPath}`;
    if (settingsDirty && snapshot.rawConfig === settingsRaw) {
      pendingSettingsSaveRef.current = false;
      setSettingsDirty(false);
      setSettingsNotice('Settings saved and reloaded.');
      return;
    }
    if (identity !== configIdentityRef.current || !settingsDirty) {
      configIdentityRef.current = identity;
      setSettingsRaw(snapshot.rawConfig);
      setSettingsDirty(false);
    }
  }, [snapshot, settingsDirty, settingsRaw]);

  const submit = useCallback(() => {
    // Plain text starts planning, matching the current HiveMind interaction model.
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    void sendWorkerRequest(childRef.current, {type: 'submitPrompt', text});
  }, [draft]);

  const phaseLabel = useMemo(() => {
    // Compact phase copy keeps the top bar readable at narrow widths.
    const phase = snapshot?.state.phase ?? 'idle';
    return phase.replace('_', ' ');
  }, [snapshot?.state.phase]);

  const settingsActive = activeTab === 'settings';

  return (
    <main className="shell">
      <aside className="sidenav" aria-label="HiveMind navigation">
        <div className="brand">
          <span className="brandMark" aria-hidden="true">
            <BrandMark />
          </span>
          <span className="brandText">HiveMind</span>
        </div>
        <nav>
          <button
            type="button"
            className={`navItem ${activeTab === 'transcript' ? 'active' : ''}`}
            onClick={() => setActiveTab('transcript')}
          >
            <FileJson size={16} />
            Transcript
          </button>
          <button
            type="button"
            className={`navItem ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <Settings size={16} />
            Settings
          </button>
        </nav>
        <div className="sideFoot">
          <span className="agentsLine">{snapshot?.agents.join(' + ') || 'agents loading'}</span>
          <span>{snapshot?.workspaceRoot ?? status}</span>
        </div>
      </aside>

      <section className={`workspace ${settingsActive ? 'settingsActive' : ''}`}>
        <header className="topbar">
          <h1>{settingsActive ? 'Settings' : 'Transcript'}</h1>
          <div className="statusCluster">
            <span className={`pill ${snapshot?.isGitRepository ? 'ok' : 'warn'}`}>
              <GitBranch size={14} />
              {snapshot?.isGitRepository ? 'git ready' : 'no git repo'}
            </span>
            <span className={`pill phase ${busy ? 'busy' : ''}`}>{phaseLabel}</span>
          </div>
        </header>

        {workerError && (
          <div className="banner error">
            <AlertTriangle size={16} />
            {workerError}
          </div>
        )}

        {settingsActive ? (
          <section className="settingsPanel" aria-label="HiveMind settings">
            <div className="settingsHeader">
              <div>
                <h2>Settings JSONC</h2>
                <p>
                  {snapshot?.configSource ?? 'loading'} · {snapshot?.configPath ?? 'waiting for worker'}
                  {snapshot && snapshot.saveConfigPath !== snapshot.configPath ? ` · saves to ${snapshot.saveConfigPath}` : ''}
                </p>
              </div>
              <div className="segmented">
                <button type="button" className={settingsView === 'raw' ? 'active' : ''} onClick={() => setSettingsView('raw')}>Raw</button>
                <button type="button" className={settingsView === 'effective' ? 'active' : ''} onClick={() => setSettingsView('effective')}>Effective</button>
              </div>
            </div>
            <textarea
              className="settingsEditor"
              value={settingsView === 'raw' ? settingsRaw : snapshot?.effectiveConfigJson ?? ''}
              readOnly={settingsView === 'effective'}
              spellCheck={false}
              onChange={(event) => {
                setSettingsRaw(event.currentTarget.value);
                setSettingsDirty(true);
                setSettingsNotice(null);
              }}
            />
            <div className="settingsActions">
              <button
                type="button"
                onClick={() => {
                  pendingSettingsSaveRef.current = true;
                  setSettingsNotice('Saving settings...');
                  void sendWorkerRequest(childRef.current, {type: 'saveSettings', rawJson: settingsRaw});
                }}
                disabled={busy || settingsView !== 'raw' || !settingsDirty}
              >
                <Save size={15} />
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setSettingsRaw(snapshot?.rawConfig ?? '');
                  setSettingsDirty(false);
                  setSettingsNotice(null);
                }}
                disabled={!settingsDirty}
              >
                <RotateCcw size={15} />
                Reset changes
              </button>
              {settingsNotice && <span>{settingsNotice}</span>}
              {busy && <span>Finish or cancel active task before saving settings.</span>}
            </div>
          </section>
        ) : (
          <section className="transcript" aria-label="HiveMind transcript">
            {(snapshot?.state.entries ?? []).map((entry, index) => (
              <TranscriptRow entry={entry} key={`${entry.ts}-${index}`} />
            ))}
          </section>
        )}

        {!settingsActive && (
          <footer className="composer">
            <div className="actions">
              <button type="button" onClick={() => void sendWorkerRequest(childRef.current, {type: 'executeSelected'})} disabled={!canExecute || busy}>
                <Play size={15} />
                Execute
              </button>
              <button type="button" onClick={() => void sendWorkerRequest(childRef.current, {type: 'review'})} disabled={busy}>
                <RefreshCw size={15} />
                Review
              </button>
              <button type="button" onClick={() => void sendWorkerRequest(childRef.current, {type: 'cancel'})} disabled={!busy && snapshot?.state.phase !== 'awaiting_choice'}>
                <StopCircle size={15} />
                Stop
              </button>
              <button type="button" onClick={() => void sendWorkerRequest(childRef.current, {type: 'clear'})}>
                Clear
              </button>
            </div>
            <div className="inputRow">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
                }}
                placeholder="Ask HiveMind to plan work in this folder..."
              />
              <button type="button" className="send" onClick={submit} disabled={busy || !draft.trim()}>
                <Send size={18} />
              </button>
            </div>
          </footer>
        )}
      </section>
    </main>
  );
}

async function startWorker(
  onResponse: (response: WorkerResponse) => void,
  childRef: React.MutableRefObject<Child | null>,
  lineBuffer: React.MutableRefObject<string>
): Promise<void> {
  // Tauri provides launch paths; the worker stays Node-based for this first desktop version.
  const context = await invoke<LaunchContext>('launch_context');
  const command = Command.create('node', [context.workerPath, '--root', context.root], {
    cwd: context.packageRoot,
    env: {TASKFORGE_ROOT: context.root},
  });
  command.stdout.on('data', (chunk) => consumeWorkerLines(String(chunk), lineBuffer, onResponse));
  command.stderr.on('data', (chunk) => {
    onResponse({type: 'error', message: String(chunk)});
  });
  command.on('error', (message) => onResponse({type: 'error', message}));
  command.on('close', (event) => {
    if (event.code !== 0) onResponse({type: 'error', message: `Worker exited with ${event.code}`});
  });
  childRef.current = await command.spawn();
}

function consumeWorkerLines(
  chunk: string,
  lineBuffer: React.MutableRefObject<string>,
  onResponse: (response: WorkerResponse) => void
): void {
  // The worker writes JSON lines; keep a small carry buffer for partial chunks.
  lineBuffer.current += chunk;
  const lines = lineBuffer.current.split(/\r?\n/);
  lineBuffer.current = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    onResponse(JSON.parse(line) as WorkerResponse);
  }
}

function handleWorkerResponse(
  response: WorkerResponse,
  setSnapshot: (snapshot: Snapshot) => void,
  setStatus: (status: string) => void,
  setWorkerError: (error: string | null) => void,
  setSettingsNotice: (notice: string | null) => void,
  pendingSettingsSaveRef: React.MutableRefObject<boolean>
): void {
  // Only state events update the app model; other messages are status/diagnostics.
  if (response.type === 'ready') {
    setStatus('worker ready');
    return;
  }
  if (response.type === 'error') {
    if (pendingSettingsSaveRef.current) {
      pendingSettingsSaveRef.current = false;
      setSettingsNotice(`Settings save failed: ${response.message}`);
    }
    setWorkerError(response.message);
    return;
  }
  if (response.type === 'event' && response.event.type === 'state') {
    setWorkerError(null);
    setSnapshot(response.event.snapshot);
  }
}

async function sendWorkerRequest(child: Child | null, request: Record<string, unknown>): Promise<void> {
  if (!child) return;

  // Stdin is the command channel; state returns asynchronously over stdout.
  await child.write(`${JSON.stringify({...request, id: crypto.randomUUID()})}\n`);
}

function BrandMark() {
  // Same artwork as the app/window icon, served from desktop/public.
  return <img className="brandImg" src="/icon.png" alt="HiveMind" width={38} height={38} />;
}

function TranscriptRow({entry}: {entry: TranscriptEntry}) {
  // Route each transcript kind to a compact desktop renderer.
  if (entry.kind === 'user') {
    return <div className="row user"><span>user</span><p>{entry.text}</p></div>;
  }
  if (entry.kind === 'system') {
    return <div className={`row system ${entry.level}`}><span>system</span><p>{entry.text}</p></div>;
  }
  if (entry.kind === 'agent') {
    return <div className={`row agent ${entry.level}`}><span>{entry.agent}</span><p>{entry.text}</p></div>;
  }
  if (entry.kind === 'plan') {
    return (
      <div className="row plan">
        <span>plan</span>
        <div>
          <strong>[{entry.source}] {entry.plan.goal}</strong>
          <ol>
            {entry.plan.steps.map((step, index) => <li key={`${step.title}-${index}`}>{step.title}</li>)}
          </ol>
        </div>
      </div>
    );
  }
  if (entry.kind === 'parity') {
    return (
      <div className="row parity">
        <span>{entry.classification === 'compatible' ? <CheckCircle2 size={15} /> : 'parity'}</span>
        <p><strong>{entry.classification}</strong> {entry.reason}</p>
      </div>
    );
  }

  return <SplitEntry entry={entry} />;
}

function SplitEntry({entry}: {entry: Extract<TranscriptEntry, {kind: 'prompt_split'}>}) {
  // Split blocks show each active planning agent without interleaving output.
  return (
    <div className="splitBlock">
      {Object.entries(entry.columns).map(([agent, column]) => (
        <div className="agentPane" key={agent}>
          <div className="agentHeader">
            <span>{agent}</span>
            <small>{column.status}</small>
          </div>
          <div className="agentOutput">
            {column.chunks.slice(-8).map((chunk, index) => (
              <p className={chunk.level} key={`${chunk.ts}-${index}`}>{chunk.text}</p>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
