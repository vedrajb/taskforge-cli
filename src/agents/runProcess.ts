import {ChildProcess, spawn} from 'node:child_process';

export type ProcessOutputStream = 'stdout' | 'stderr';

export type ProcessRunnerEvent =
  | {
      type: 'output';
      stream: ProcessOutputStream;
      data: string;
    }
  | {
      type: 'exit';
      code: number | null;
      signal: NodeJS.Signals | null;
    };

export type RunProcessOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onEvent?: (event: ProcessRunnerEvent) => void;
  // When set, the string is written to stdin and stdin is then closed.
  stdinPayload?: string;
};

export type RunningProcess = {
  child: ChildProcess;
  completion: Promise<ProcessRunnerEvent>;
  cancel: () => void;
};

export function runProcess(command: string, args: string[] = [], options: RunProcessOptions = {}): RunningProcess {
  // On Windows, npm-installed CLIs are .cmd shims that only resolve via the shell.
  // We never pass the prompt as a CLI arg — callers use stdinPayload instead — so
  // shell: true is safe here: all args are flag names/values, never user content.
  const useShell = process.platform === 'win32';
  const stdinMode = options.stdinPayload !== undefined ? 'pipe' : 'ignore';

  const child = spawn(command, args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env
    },
    stdio: [stdinMode, 'pipe', 'pipe'],
    shell: useShell,
    windowsHide: true
  });

  if (options.stdinPayload !== undefined && child.stdin) {
    child.stdin.end(options.stdinPayload, 'utf8');
  }

  child.stdout!.on('data', (chunk: Buffer) => {
    options.onEvent?.({
      type: 'output',
      stream: 'stdout',
      data: chunk.toString()
    });
  });

  child.stderr!.on('data', (chunk: Buffer) => {
    options.onEvent?.({
      type: 'output',
      stream: 'stderr',
      data: chunk.toString()
    });
  });

  const cancel = () => {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  };

  options.signal?.addEventListener('abort', cancel, {once: true});

  const completion = new Promise<ProcessRunnerEvent>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      const event: ProcessRunnerEvent = {
        type: 'exit',
        code,
        signal
      };
      options.onEvent?.(event);
      resolve(event);
    });
  });

  return {
    child,
    completion,
    cancel
  };
}
