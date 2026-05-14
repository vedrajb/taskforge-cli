import {LogLevel} from './types.js';

// Codex emits these lines as internal housekeeping — they are not part of the agent's answer.
const CODEX_NOISE: RegExp[] = [
  /^Reading prompt from stdin/,
  /^OpenAI Codex v/,
  /^-{3,}\s*$/,
  /^workdir:\s/i,
  /^model:\s/i,
  /^provider:\s/i,
  /^\s*approval:\s/i,
  /^\s*sandbox:\s/i,
  /^\s*reasoning (effort|summaries):\s/i,
  /^\s*session id:\s/i,
  /^\s*user\s*$/,
  // Timestamp log lines from codex_core internals
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[\d.]*Z\s+(ERROR|WARN|INFO|DEBUG|TRACE)\s/,
  // Tool invocation / collaboration traces
  /^collab:\s/,
  /^exec\s*$/,
  /^\s*exited \d+(\s+in\s+[\d.]+\w+)?/,
  /^Wall time:\s/i,
  /^Output:\s*$/,
  /^tokens used/i,
  // Shell command invocations (starts with a quoted path or bare command name followed by flags)
  /^["']?[A-Za-z]:\\.*?["']?\s+-/,
  /^\s+in\s+[A-Za-z]:\\/,
  // stdin echo — codex sometimes echoes the prompt header lines
  /^Execute the following implementation plan/,
  /^ORIGINAL REQUEST:/,
  /^SELECTED PLAN:/,
  /^You are a software (planning|review)/,
  /^Prefer Git Bash/,
  /^Follow the plan steps/,
];

export type FilteredChunk = {text: string; level: LogLevel};

// Split a raw stdout chunk by line, classify each line, and return consecutive
// same-level runs as grouped entries. Noise lines are routed to 'diagnostic'
// so they land in the folded diagnostic section rather than the main transcript.
export function filterChunk(chunk: string, agentId: string): FilteredChunk[] {
  const patterns = agentId === 'codex' ? CODEX_NOISE : [];
  if (patterns.length === 0) return [{text: chunk.trimEnd(), level: 'output'}];

  const lines = chunk.split('\n');
  const result: FilteredChunk[] = [];
  let buf: string[] = [];
  let bufLevel: LogLevel = 'output';

  const flush = () => {
    const text = buf.join('\n').trimEnd();
    if (text.trim()) result.push({text, level: bufLevel});
    buf = [];
  };

  for (const line of lines) {
    const level: LogLevel = patterns.some((p) => p.test(line)) ? 'diagnostic' : 'output';
    if (level !== bufLevel) {
      flush();
      bufLevel = level;
    }
    buf.push(line);
  }
  flush();

  return result;
}
