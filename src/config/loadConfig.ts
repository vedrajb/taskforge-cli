import {execFile} from 'node:child_process';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {parse as parseJsonc, printParseErrorCode, type ParseError} from 'jsonc-parser';
import {TaskForgeConfig, TaskForgeConfigSchema} from './schema.js';
import {createDefaultConfig, createDefaultConfigJsonc} from './defaultConfig.js';

const execFileAsync = promisify(execFile);
export const DEFAULT_CONFIG_FILE = 'taskforge.config.jsonc';
export const GLOBAL_CONFIG_FILE = path.join(os.homedir(), '.config', 'settings.jsonc');

export type LoadedConfig = {
  config: TaskForgeConfig;
  configPath: string;
  saveConfigPath: string;
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
  const {config, source, configPath, saveConfigPath, rawConfig} = await readConfigFile(
    workspaceConfigPath,
    options.allowMissingConfig ?? false
  );
  const targetCwd = path.resolve(cwd, config.target.cwd);
  const targetRepoRoot = await resolveGitRepository(targetCwd, options.allowMissingGit ?? false);
  const repoRoot = targetRepoRoot || workspaceRepoRoot;

  return {
    config,
    configPath,
    saveConfigPath,
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
): Promise<{config: TaskForgeConfig; source: LoadedConfig['configSource']; configPath: string; saveConfigPath: string; rawConfig: string}> {
  // Strictly use JSONC config files at workspace and global scopes.
  const workspace = await tryReadConfigFile(workspaceConfigPath);
  if (workspace) {
    return {
      ...parseConfigJsonc(workspace.rawConfig, workspace.path),
      source: 'workspace',
      configPath: workspace.path,
      saveConfigPath: workspaceConfigPath,
    };
  }

  const global = await tryReadConfigFile(GLOBAL_CONFIG_FILE);
  if (global) {
    return {
      ...parseConfigJsonc(global.rawConfig, global.path),
      source: 'global',
      configPath: global.path,
      saveConfigPath: GLOBAL_CONFIG_FILE,
    };
  }

  if (allowMissingConfig) {
    const config = createDefaultConfig();
    return {
      config,
      source: 'default',
      configPath: GLOBAL_CONFIG_FILE,
      saveConfigPath: GLOBAL_CONFIG_FILE,
      rawConfig: createDefaultConfigJsonc(),
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

function parseConfigJsonc(rawConfig: string, configPath: string): {config: TaskForgeConfig; rawConfig: string} {
  // Parse JSONC first so comments and trailing commas are accepted before schema validation.
  const errors: ParseError[] = [];
  const parsedConfig = parseJsonc(rawConfig, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length) {
    const first = errors[0]!;
    const location = offsetToLineColumn(rawConfig, first.offset);
    throw new Error(
      `Invalid JSONC in ${configPath}:${location.line}:${location.column}: ${printParseErrorCode(first.error)}`
    );
  }

  return {config: TaskForgeConfigSchema.parse(parsedConfig), rawConfig};
}

export async function validateAndWriteConfig(rawConfig: string, configPath: string): Promise<TaskForgeConfig> {
  // Validate before writing so bad JSONC never replaces a working settings file.
  const {config} = parseConfigJsonc(rawConfig, configPath);
  await fs.mkdir(path.dirname(configPath), {recursive: true});
  await fs.writeFile(configPath, rawConfig, 'utf8');
  return config;
}

function offsetToLineColumn(text: string, offset: number): {line: number; column: number} {
  // Convert jsonc-parser offsets into one-based editor coordinates.
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset; i++) {
    if (text[i] === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return {line, column};
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
