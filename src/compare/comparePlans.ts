import {PlanEssence} from '../agents/types.js';

const GOAL_OVERLAP_THRESHOLD = 0.6;
const STEP_COUNT_DIFF_THRESHOLD = 2;
const STEP_TITLE_UNMATCHED_RATIO = 0.3;
const LEVENSHTEIN_CLOSE_THRESHOLD = 5;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);
}

function wordOverlapRatio(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let overlap = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) overlap++;
  }
  return overlap / Math.max(tokensA.size, tokensB.size);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({length: m + 1}, (_, i) =>
    Array.from({length: n + 1}, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function hasCloseMatch(title: string, candidates: string[]): boolean {
  return candidates.some((c) => levenshtein(title, c) <= LEVENSHTEIN_CLOSE_THRESHOLD);
}

function unmatchedRatio(titlesA: string[], titlesB: string[]): number {
  if (titlesA.length === 0) return 0;
  const unmatched = titlesA.filter((t) => !hasCloseMatch(t, titlesB));
  return unmatched.length / titlesA.length;
}

export type ComparisonResult = {
  aligned: boolean;
  reasons: string[];
};

export function comparePlans(a: PlanEssence, b: PlanEssence): ComparisonResult {
  const reasons: string[] = [];

  const goalOverlap = wordOverlapRatio(a.goal, b.goal);
  if (goalOverlap < GOAL_OVERLAP_THRESHOLD) {
    reasons.push(
      `Goal overlap ratio ${goalOverlap.toFixed(2)} is below threshold ${GOAL_OVERLAP_THRESHOLD}`
    );
  }

  const stepDiff = Math.abs(a.stepTitles.length - b.stepTitles.length);
  if (stepDiff > STEP_COUNT_DIFF_THRESHOLD) {
    reasons.push(
      `Step count differs by ${stepDiff} (${a.stepTitles.length} vs ${b.stepTitles.length})`
    );
  }

  const unmatchedA = unmatchedRatio(a.stepTitles, b.stepTitles);
  const unmatchedB = unmatchedRatio(b.stepTitles, a.stepTitles);
  if (unmatchedA > STEP_TITLE_UNMATCHED_RATIO || unmatchedB > STEP_TITLE_UNMATCHED_RATIO) {
    reasons.push(
      `Unmatched step title ratio: A→B ${unmatchedA.toFixed(2)}, B→A ${unmatchedB.toFixed(2)}`
    );
  }

  for (const risk of a.riskThemes) {
    if (!hasCloseMatch(risk, b.riskThemes)) {
      reasons.push(`Risk in plan A has no analog in plan B: "${risk}"`);
      break;
    }
  }

  return {aligned: reasons.length === 0, reasons};
}
