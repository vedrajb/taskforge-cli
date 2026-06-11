import {
  createAcpRuntime,
  createFileSessionStore,
  createAgentRegistry,
  type AcpRuntimeEvent,
  type AcpRuntimeHandle,
} from 'acpx/runtime';
import {join} from 'node:path';
import {nanoid} from '../util/nanoid.js';

export type AcpxAgentEvent =
  | {type: 'text_delta'; text: string; stream: 'output' | 'thought'}
  | {type: 'tool_call'; title: string}
  | {type: 'done'; stopReason?: string}
  | {type: 'error'; message: string};

export type AcpxRunOptions = {
  cwd: string;
  signal?: AbortSignal;
  onEvent?: (event: AcpxAgentEvent) => void;
};

let _runtime: ReturnType<typeof createAcpRuntime> | null = null;

function getRuntime(cwd: string): ReturnType<typeof createAcpRuntime> {
  if (!_runtime) {
    _runtime = createAcpRuntime({
      cwd,
      sessionStore: createFileSessionStore({stateDir: join(cwd, '.acpx', 'sessions')}),
      agentRegistry: createAgentRegistry(),
      permissionMode: 'approve-reads',
      nonInteractivePermissions: 'fail',
      timeoutMs: 600_000,
    });
  }
  return _runtime;
}

export async function acpxRun(
  agentCommand: string,
  prompt: string,
  opts: AcpxRunOptions
): Promise<string> {
  const runtime = getRuntime(opts.cwd);

  const handle: AcpRuntimeHandle = await runtime.ensureSession({
    sessionKey: `tfg-${agentCommand}-${nanoid()}`,
    agent: agentCommand,
    mode: 'oneshot',
    cwd: opts.cwd,
  });

  const turn = runtime.startTurn({
    handle,
    text: prompt,
    mode: 'prompt',
    requestId: nanoid(),
    signal: opts.signal,
  });

  let fullText = '';

  try {
    for await (const event of turn.events) {
      if (opts.signal?.aborted) break;
      mapEvent(event, opts.onEvent, (text) => { fullText += text; });
    }
    const result = await turn.result;
    if (result.status === 'completed') {
      opts.onEvent?.({type: 'done', stopReason: result.stopReason});
    } else if (result.status === 'cancelled') {
      opts.onEvent?.({type: 'done', stopReason: 'cancelled'});
    } else {
      opts.onEvent?.({type: 'error', message: result.error.message});
      throw new Error(result.error.message);
    }
  } finally {
    await runtime.close({handle, reason: 'done'}).catch(() => {});
  }

  return fullText;
}

function mapEvent(
  event: AcpRuntimeEvent,
  onEvent: AcpxRunOptions['onEvent'],
  onText: (t: string) => void
): void {
  if (event.type === 'text_delta') {
    const stream = event.stream === 'thought' ? 'thought' : 'output';
    if (stream === 'output') onText(event.text);
    onEvent?.({type: 'text_delta', text: event.text, stream});
  } else if (event.type === 'tool_call') {
    onEvent?.({type: 'tool_call', title: event.title ?? event.text ?? ''});
  } else if (event.type === 'done') {
    onEvent?.({type: 'done', stopReason: event.stopReason});
  } else if (event.type === 'error') {
    onEvent?.({type: 'error', message: event.message});
  }
}
