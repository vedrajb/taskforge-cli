import {ChildProcess, spawn, spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';

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

function commandExists(command: string): boolean {
  // Resolve direct paths without invoking a shell.
  if (path.isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    return existsSync(command);
  }

  // Windows shell execution hides ENOENT behind a normal shell exit, so preflight PATH.
  const probe = process.platform === 'win32'
    ? spawnSync('where.exe', [command], {stdio: 'ignore', windowsHide: true})
    : spawnSync('command', ['-v', command], {stdio: 'ignore', shell: true});
  return probe.status === 0;
}

function makeSpawnError(command: string): Error {
  // Match Node's spawn error wording closely enough for callers/tests to identify ENOENT.
  const error = new Error(`spawn ${command} ENOENT`);
  (error as NodeJS.ErrnoException).code = 'ENOENT';
  return error;
}

export function runProcess(command: string, args: string[] = [], options: RunProcessOptions = {}): RunningProcess {
  // On Windows, npm-installed CLIs are .cmd shims that only resolve via the shell.
  // We never pass the prompt as a CLI arg — callers use stdinPayload instead — so
  // shell: true is safe here: all args are flag names/values, never user content.
  const useShell = process.platform === 'win32';
  const stdinMode = options.stdinPayload !== undefined ? 'pipe' : 'ignore';
  const missingCommand = useShell && !commandExists(command);
  const spawnCommand = missingCommand ? process.execPath : command;
  const spawnArgs = missingCommand ? ['-e', ''] : args;

  const child = spawn(spawnCommand, spawnArgs, {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env
    },
    stdio: [stdinMode, 'pipe', 'pipe'],
    shell: missingCommand ? false : useShell,
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
    // Reject explicitly when the Windows shell would otherwise turn ENOENT into exit code 1.
    if (missingCommand) {
      reject(makeSpawnError(command));
      return;
    }

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
