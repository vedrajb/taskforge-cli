import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export async function launchTaskForge(argv: string[]): Promise<void> {
  if (argv.includes('--tui')) {
    // Keep the terminal UI available as an explicit fallback while desktop matures.
    const {main} = await import('../app.js');
    await main(argv);
    return;
  }

  const workspaceRoot = process.cwd();
  const desktopBin = process.env.TASKFORGE_DESKTOP_BIN;
  if (desktopBin) {
    await spawnAndWait(desktopBin, ['--root', workspaceRoot], process.cwd());
    return;
  }

  const packageRoot = resolvePackageRoot();
  if (!existsSync(path.join(packageRoot, 'src-tauri', 'tauri.conf.json'))) {
    throw new Error('TaskForge desktop app is not built. Set TASKFORGE_DESKTOP_BIN or run from the project checkout.');
  }

  // Development checkout fallback: run Tauri dev with the caller folder in env.
  await spawnAndWait('npm', ['run', 'desktop:dev'], packageRoot, {
    TASKFORGE_ROOT: workspaceRoot,
  });
}

function resolvePackageRoot(): string {
  // Compiled launcher lives at dist/desktop/launcher.js, so ../.. is the package root.
  const currentFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFile), '..', '..');
}

function spawnAndWait(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    // Shell mode is required on Windows so npm.cmd and user-provided .cmd launchers resolve.
    const child = spawn(command, args, {
      cwd,
      env: {...process.env, ...env},
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with ${code ?? `signal ${signal}`}`));
    });
  });
}
