import {TaskForgeConfig} from './schema.js';

export type AgentRole = 'plan' | 'parity' | 'execute' | 'review';

export function resolveEffort(config: TaskForgeConfig, agentId: string, role: AgentRole): string {
  const agent = config.agents[agentId];
  if (!agent) throw new Error(`Unknown agent "${agentId}"`);

  const agentRoleEffort = agent.effort[role];
  if (agentRoleEffort) return agentRoleEffort;

  const defaultRoleEffort = config.defaults.roleEffort[role];
  if (defaultRoleEffort) return defaultRoleEffort;

  const globalDefault = config.defaults.effort;
  if (globalDefault) return globalDefault;

  throw new Error(
    `No effort level configured for agent "${agentId}" role "${role}" and no global default set`
  );
}
