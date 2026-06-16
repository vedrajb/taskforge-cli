import {execFile} from 'node:child_process';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {TaskForgeConfig, TaskForgeConfigSchema} from './schema.js';
import {createDefaultConfig} from './defaultConfig.js';

const execFileAsync = promisify(execFile);
export const DEFAULT_CONFIG_FILE = 'taskforge.config.json';
export const GLOBAL_CONFIG_FILE = path.join(os.homedir(), '.config', 'settings.json');

export type LoadedConfig = {
  config: TaskForgeConfig;
  configPath: string;
  configSource: 'workspace' | 'global' | 'default';
  rawConfig: string;
  effectiveConfigJson: string;
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
  const workspaceConfigPath = path.resolve(cwd, options.configPath ?? DEFAULT_CONFIG_FILE);

  // Desktop launches should open anywhere; the TUI keeps the historical strict Git check.
  const workspaceRepoRoot = await resolveGitRepository(cwd, options.allowMissingGit ?? false);

  // Parse and validate the config before deriving runtime paths from it.
  const {config, source, configPath, rawConfig} = await readConfigFile(
    workspaceConfigPath,
    options.allowMissingConfig ?? false
  );
  const targetCwd = path.resolve(cwd, config.target.cwd);
  const targetRepoRoot = await resolveGitRepository(targetCwd, options.allowMissingGit ?? false);
  const repoRoot = targetRepoRoot || workspaceRepoRoot;

  return {
    config,
    configPath,
    configSource: source,
    rawConfig,
    effectiveConfigJson: JSON.stringify(config, null, 2),
    repoRoot,
    targetCwd,
    workspaceRoot: cwd,
    isGitRepository: repoRoot.length > 0
  };
}

async function readConfigFile(
  workspaceConfigPath: string,
  allowMissingConfig: boolean
): Promise<{config: TaskForgeConfig; source: LoadedConfig['configSource']; configPath: string; rawConfig: string}> {
  // Try workspace first, then global settings, then bundled defaults if allowed.
  const workspace = await tryReadConfigFile(workspaceConfigPath);
  if (workspace) {
    return {...parseConfigJson(workspace.rawConfig, workspace.path), source: 'workspace', configPath: workspace.path};
  }

  const global = await tryReadConfigFile(GLOBAL_CONFIG_FILE);
  if (global) {
    return {...parseConfigJson(global.rawConfig, global.path), source: 'global', configPath: global.path};
  }

  if (allowMissingConfig) {
    const config = createDefaultConfig();
    return {
      config,
      source: 'default',
      configPath: GLOBAL_CONFIG_FILE,
      rawConfig: JSON.stringify(config, null, 2),
    };
  }

  throw new Error(`Missing TaskForge config: ${workspaceConfigPath} or ${GLOBAL_CONFIG_FILE}`);
}

async function tryReadConfigFile(configPath: string): Promise<{path: string; rawConfig: string} | null> {
  // Missing config files are normal during fallback probing.
  try {
    return {path: configPath, rawConfig: await fs.readFile(configPath, 'utf8')};
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') return null;
    throw error;
  }
}

function parseConfigJson(rawConfig: string, configPath: string): {config: TaskForgeConfig; rawConfig: string} {
  // Keep JSON parsing separate from schema validation for clearer startup failures.
  let parsedConfig: unknown;
  try {
    parsedConfig = JSON.parse(rawConfig);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${configPath}: ${message}`);
  }

  return {config: TaskForgeConfigSchema.parse(parsedConfig), rawConfig};
}

export async function validateAndWriteConfig(rawConfig: string, configPath: string): Promise<TaskForgeConfig> {
  // Validate before writing so bad JSON never replaces a working settings file.
  const {config} = parseConfigJson(rawConfig, configPath);
  await fs.mkdir(path.dirname(configPath), {recursive: true});
  await fs.writeFile(configPath, rawConfig, 'utf8');
  return config;
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
