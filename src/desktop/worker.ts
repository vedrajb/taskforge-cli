import readline from 'node:readline';
import {TaskForgeSession} from '../core/session.js';

type WorkerRequest =
  | {id?: string; type: 'init'; root?: string}
  | {id?: string; type: 'submitPrompt'; text: string}
  | {id?: string; type: 'choosePlan'; source: 'claude' | 'codex'}
  | {id?: string; type: 'mergePlans'}
  | {id?: string; type: 'executeSelected'}
  | {id?: string; type: 'review'}
  | {id?: string; type: 'cancel'}
  | {id?: string; type: 'clear'}
  | {id?: string; type: 'snapshot'};

type WorkerResponse =
  | {type: 'ready'}
  | {type: 'ack'; id?: string}
  | {type: 'error'; id?: string; message: string}
  | {type: 'event'; event: unknown};

let session: TaskForgeSession | null = null;

function writeResponse(response: WorkerResponse): void {
  // JSON lines keep the protocol trivial for Tauri, tests, and future native bridges.
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function workspaceRootFromArgs(): string {
  // The CLI launcher passes --root; the env fallback is convenient for Tauri dev mode.
  const rootIndex = process.argv.indexOf('--root');
  if (rootIndex !== -1 && process.argv[rootIndex + 1]) return process.argv[rootIndex + 1]!;
  return process.env.TASKFORGE_ROOT || process.cwd();
}

async function ensureSession(root = workspaceRootFromArgs()): Promise<TaskForgeSession> {
  if (session) return session;

  // Create one workspace session per worker process and stream all state changes outward.
  session = await TaskForgeSession.create({
    workspaceRoot: root,
    onEvent: (event) => writeResponse({type: 'event', event}),
  });
  return session;
}

async function handleRequest(request: WorkerRequest): Promise<void> {
  try {
    if (request.type === 'init') {
      session = await TaskForgeSession.create({
        workspaceRoot: request.root || workspaceRootFromArgs(),
        onEvent: (event) => writeResponse({type: 'event', event}),
      });
      writeResponse({type: 'ack', id: request.id});
      return;
    }

    const activeSession = await ensureSession();

    // Dispatch worker protocol commands into the headless session API.
    switch (request.type) {
      case 'submitPrompt':
        await activeSession.submitPrompt(request.text);
        break;
      case 'choosePlan':
        await activeSession.choosePlan(request.source);
        break;
      case 'mergePlans':
        await activeSession.mergePlans();
        break;
      case 'executeSelected':
        await activeSession.executeSelected();
        break;
      case 'review':
        await activeSession.review();
        break;
      case 'cancel':
        activeSession.cancel();
        break;
      case 'clear':
        activeSession.clear();
        break;
      case 'snapshot':
        writeResponse({type: 'event', event: {type: 'state', snapshot: activeSession.snapshot()}});
        break;
    }

    writeResponse({type: 'ack', id: request.id});
  } catch (error: unknown) {
    writeResponse({type: 'error', id: request.id, message: error instanceof Error ? error.message : String(error)});
  }
}

async function main(): Promise<void> {
  // Send a marker before initialization so launchers know stdout is protocol-ready.
  writeResponse({type: 'ready'});
  await ensureSession();

  const rl = readline.createInterface({input: process.stdin});
  rl.on('line', (line) => {
    void handleRequest(JSON.parse(line) as WorkerRequest);
  });
}

main().catch((error: unknown) => {
  writeResponse({type: 'error', message: error instanceof Error ? error.message : String(error)});
  process.exitCode = 1;
});
