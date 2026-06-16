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

export function createDefaultConfigJsonc(): string {
  // Keep generated settings human-editable while preserving the same config shape.
  return `{
  // Default effort used when a role or agent does not override it.
  "defaults": {
    "effort": "medium",
    "roleEffort": {
      // Planning and review benefit from deeper reasoning by default.
      "plan": "high",
      "execute": "medium",
      "review": "high"
    }
  },

  // Agent commands are resolved from PATH unless a full path is provided.
  "agents": {
    "claude": {
      "command": "claude",
      "roles": ["plan", "parity"],
      "effort": {
        "plan": "high",
        "parity": "medium"
      }
    },
    "codex": {
      "command": "codex",
      "roles": ["plan", "execute", "review"],
      "effort": {
        "plan": "high",
        "execute": "medium",
        "review": "high"
      }
    }
  },

  // Workflow selects which configured agents handle each phase.
  "workflow": {
    "planAgents": ["claude", "codex"],
    "parityAgent": "claude",
    "mergeAgent": "claude",
    "executeAgent": "codex",
    "reviewAgent": "codex"
  },

  // Shell controls how local commands are launched.
  "shell": {
    "preferred": "git-bash",
    "gitBashPath": "C:\\\\Program Files\\\\Git\\\\bin\\\\bash.exe",
    "fallback": "powershell"
  },

  // Target cwd is resolved relative to the config workspace.
  "target": {
    "cwd": "."
  }
}
`;
}
