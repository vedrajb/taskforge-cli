import {TaskForgeConfig} from './schema.js';

export function createDefaultConfig(): TaskForgeConfig {
  // Mirror the checked-in config so desktop launches from folders without local setup.
  return {
    defaults: {
      effort: 'medium',
      roleEffort: {
        plan: 'high',
        execute: 'medium',
        review: 'high',
      },
    },
    agents: {
      claude: {
        command: 'claude',
        roles: ['plan', 'parity'],
        effort: {
          plan: 'high',
          parity: 'medium',
        },
      },
      codex: {
        command: 'codex',
        roles: ['plan', 'execute', 'review'],
        effort: {
          plan: 'high',
          execute: 'medium',
          review: 'high',
        },
      },
    },
    workflow: {
      planAgents: ['claude', 'codex'],
      parityAgent: 'claude',
      mergeAgent: 'claude',
      executeAgent: 'codex',
      reviewAgent: 'codex',
    },
    shell: {
      preferred: 'git-bash',
      fallback: 'powershell',
    },
    target: {
      cwd: '.',
    },
  };
}
