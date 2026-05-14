import {execFile} from 'node:child_process';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {TaskForgeConfig, TaskForgeConfigSchema} from './schema.js';

const execFileAsync = promisify(execFile);
export const DEFAULT_CONFIG_FILE = 'taskforge.config.json';

export type LoadedConfig = {
  config: TaskForgeConfig;
  configPath: string;
  repoRoot: string;
  targetCwd: string;
};

export type LoadConfigOptions = {
  cwd?: string;
  configPath?: string;
};

export async function loadConfig(options: LoadConfigOptions = {}): Promise<LoadedConfig> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const configPath = path.resolve(cwd, options.configPath ?? DEFAULT_CONFIG_FILE);

  // Validate that TaskForge starts from a Git-aware workspace.
  await assertGitRepository(cwd);

  // Parse and validate the config before deriving runtime paths from it.
  const config = await readConfigFile(configPath);
  const targetCwd = path.resolve(cwd, config.target.cwd);
  const repoRoot = await assertGitRepository(targetCwd);

  return {
    config,
    configPath,
    repoRoot,
    targetCwd
  };
}

async function readConfigFile(configPath: string): Promise<TaskForgeConfig> {
  let rawConfig: string;

  // Load the JSON config explicitly so missing-file errors can name the expected path.
  try {
    rawConfig = await fs.readFile(configPath, 'utf8');
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new Error(`Missing TaskForge config: ${configPath}`);
    }
    throw error;
  }

  // Keep JSON parsing separate from schema validation for clearer startup failures.
  let parsedConfig: unknown;
  try {
    parsedConfig = JSON.parse(rawConfig);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${configPath}: ${message}`);
  }

  return TaskForgeConfigSchema.parse(parsedConfig);
}

async function assertGitRepository(cwd: string): Promise<string> {
  try {
    // Ask Git for the canonical repo root instead of assuming the config cwd is the root.
    const {stdout} = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {cwd});
    return stdout.trim();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Not a Git repository: ${cwd}. Run "git init" before starting TaskForge. ${message}`);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
