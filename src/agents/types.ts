import {z} from 'zod';

export const AgentPlanStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string(),
  files: z.array(z.string()).optional(),
  risks: z.array(z.string()).optional(),
});

export const AgentPlanSchema = z.object({
  goal: z.string(),
  summary: z.string(),
  steps: z.array(AgentPlanStepSchema),
  risks: z.array(z.string()),
  openQuestions: z.array(z.string()),
});

export const PlanParitySchema = z.object({
  classification: z.enum(['same', 'compatible', 'materially_different']),
  reason: z.string(),
  coreDifferences: z.array(z.string()),
  recommendedAction: z.enum(['proceed', 'ask_user_to_choose', 'ask_user_to_merge']),
});

export type AgentPlan = z.infer<typeof AgentPlanSchema>;
export type AgentPlanStep = z.infer<typeof AgentPlanStepSchema>;
export type PlanParity = z.infer<typeof PlanParitySchema>;

export type PlanEssence = {
  goal: string;
  stepTitles: string[];
  riskThemes: string[];
  openQuestionThemes: string[];
};

export const AGENT_PLAN_SCHEMA_DESCRIPTION = `{
  "goal": "string — overall goal of the task",
  "summary": "string — brief summary of the approach",
  "steps": [
    {
      "id": "string — unique step identifier e.g. step-1",
      "title": "string — short step title",
      "detail": "string — detailed description of what to do",
      "files": ["string — optional files affected"],
      "risks": ["string — optional per-step risks"]
    }
  ],
  "risks": ["string — top-level project risks"],
  "openQuestions": ["string — unresolved questions"]
}`;

export const PLAN_PARITY_SCHEMA_DESCRIPTION = `{
  "classification": "same" | "compatible" | "materially_different",
  "reason": "string — explanation of the classification",
  "coreDifferences": ["string — list of core differences if any"],
  "recommendedAction": "proceed" | "ask_user_to_choose" | "ask_user_to_merge"
}`;
