import {AgentPlan, PlanEssence} from '../agents/types.js';

export function normalizePlan(plan: AgentPlan): PlanEssence {
  return {
    goal: plan.goal.toLowerCase().trim(),
    stepTitles: plan.steps.map((s) => s.title.toLowerCase().trim()),
    riskThemes: plan.risks.map((r) => r.toLowerCase().trim()),
    openQuestionThemes: plan.openQuestions.map((q) => q.toLowerCase().trim()),
  };
}
