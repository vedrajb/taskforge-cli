import {z} from 'zod';

export const EffortSchema = z.enum(['low', 'medium', 'high']);

export const AgentRoleSchema = z.enum(['plan', 'parity', 'execute', 'review']);

export const RoleEffortSchema = z.record(AgentRoleSchema, EffortSchema);

export const DefaultsConfigSchema = z.object({
  effort: EffortSchema,
  roleEffort: RoleEffortSchema.default({})
}).strict();

export const ShellConfigSchema = z.object({
  preferred: z.enum(['git-bash', 'powershell']).default('git-bash'),
  gitBashPath: z.string().min(1).optional(),
  fallback: z.enum(['git-bash', 'powershell']).default('powershell')
}).strict();

export const AgentConfigSchema = z.object({
  command: z.string().min(1),
  roles: z.array(AgentRoleSchema).min(1),
  effort: RoleEffortSchema.default({})
}).strict();

export const WorkflowConfigSchema = z.object({
  planAgents: z.array(z.string().min(1)).min(1),
  parityAgent: z.string().min(1),
  executeAgent: z.string().min(1),
  reviewAgent: z.string().min(1),
  mergeAgent: z.string().min(1).default('claude')
}).strict();

export const TaskForgeConfigSchema = z.object({
  defaults: DefaultsConfigSchema,
  agents: z.record(AgentConfigSchema),
  workflow: WorkflowConfigSchema,
  shell: ShellConfigSchema.default({
    preferred: 'git-bash',
    fallback: 'powershell'
  }),
  target: z.object({
    cwd: z.string().min(1).default('.')
  }).strict()
}).strict().superRefine((config, context) => {
  const agentIds = new Set(Object.keys(config.agents));
  const workflowAgentIds = [
    ...config.workflow.planAgents,
    config.workflow.parityAgent,
    config.workflow.executeAgent,
    config.workflow.reviewAgent,
    config.workflow.mergeAgent
  ];

  // Ensure every workflow reference points at a declared agent.
  for (const agentId of workflowAgentIds) {
    if (!agentIds.has(agentId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Workflow references unknown agent "${agentId}"`
      });
    }
  }

  // Keep automatic plan merging on an agent that already produced a comparable plan.
  if (!config.workflow.planAgents.includes(config.workflow.mergeAgent)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `mergeAgent must be one of workflow.planAgents`
    });
  }

  // Ensure every configured workflow role is supported by the selected agent.
  const requiredRolesByAgent = new Map<string, Set<z.infer<typeof AgentRoleSchema>>>();
  for (const agentId of config.workflow.planAgents) {
    addRequiredRole(requiredRolesByAgent, agentId, 'plan');
  }
  addRequiredRole(requiredRolesByAgent, config.workflow.parityAgent, 'parity');
  addRequiredRole(requiredRolesByAgent, config.workflow.executeAgent, 'execute');
  addRequiredRole(requiredRolesByAgent, config.workflow.reviewAgent, 'review');

  for (const [agentId, roles] of requiredRolesByAgent) {
    const agent = config.agents[agentId];
    if (!agent) {
      continue;
    }

    for (const role of roles) {
      if (!agent.roles.includes(role)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Agent "${agentId}" is selected for "${role}" but does not declare that role`
        });
      }
    }
  }
});

function addRequiredRole(
  rolesByAgent: Map<string, Set<z.infer<typeof AgentRoleSchema>>>,
  agentId: string,
  role: z.infer<typeof AgentRoleSchema>
): void {
  // Accumulate workflow role requirements per configured agent id.
  const roles = rolesByAgent.get(agentId) ?? new Set<z.infer<typeof AgentRoleSchema>>();
  roles.add(role);
  rolesByAgent.set(agentId, roles);
}

export type TaskForgeConfig = z.infer<typeof TaskForgeConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type WorkflowConfig = z.infer<typeof WorkflowConfigSchema>;
