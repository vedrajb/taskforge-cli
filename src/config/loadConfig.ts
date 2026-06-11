import {execFile} from 'node:child_process';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {TaskForgeConfig, TaskForgeConfigSchema} from './schema.js';
import {createDefaultConfig} from './defaultConfig.js';

const execFileAsync = promisify(execFile);
export const DEFAULT_CONFIG_FILE = 'taskforge.config.json';

export type LoadedConfig = {
  config: TaskForgeConfig;
  configPath: string;
  configSource: 'workspace' | 'default';
  repoRoot: string;
  targetCwd: string;
  workspaceRoot: string;
  isGitRepository: boolean;
};

export type LoadConfigOptions = {
  cwd?: string;
  configPath?: string;
  allowMissingConfig?: boolean;
  allowMissingGit?: boolean;
};

export async function loadConfig(options: LoadConfigOptions = {}): Promise<LoadedConfig> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const configPath = path.resolve(cwd, options.configPath ?? DEFAULT_CONFIG_FILE);

  // Desktop launches should open anywhere; the TUI keeps the historical strict Git check.
  const workspaceRepoRoot = await resolveGitRepository(cwd, options.allowMissingGit ?? false);

  // Parse and validate the config before deriving runtime paths from it.
  const {config, source} = await readConfigFile(configPath, options.allowMissingConfig ?? false);
  const targetCwd = path.resolve(cwd, config.target.cwd);
  const targetRepoRoot = await resolveGitRepository(targetCwd, options.allowMissingGit ?? false);
  const repoRoot = targetRepoRoot || workspaceRepoRoot;

  return {
    config,
    configPath,
    configSource: source,
    repoRoot,
    targetCwd,
    workspaceRoot: cwd,
    isGitRepository: repoRoot.length > 0
  };
}

async function readConfigFile(
  configPath: string,
  allowMissingConfig: boolean
): Promise<{config: TaskForgeConfig; source: LoadedConfig['configSource']}> {
  let rawConfig: string;

  // Load the JSON config explicitly so missing-file errors can name the expected path.
  try {
    rawConfig = await fs.readFile(configPath, 'utf8');
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      if (allowMissingConfig) {
        return {config: createDefaultConfig(), source: 'default'};
      }
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

  return {config: TaskForgeConfigSchema.parse(parsedConfig), source: 'workspace'};
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

async function resolveGitRepository(cwd: string, allowMissingGit: boolean): Promise<string> {
  try {
    // Reuse the strict Git lookup, then downgrade only when the desktop caller allows it.
    return await assertGitRepository(cwd);
  } catch (error: unknown) {
    if (allowMissingGit) return '';
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
