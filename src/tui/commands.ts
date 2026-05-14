export const COMMANDS = ['/plan', '/execute', '/review', '/diff', '/clear', '/help', '/quit', '/diag'] as const;
export type CommandName = (typeof COMMANDS)[number];

export type ParsedCommand = {
  name: CommandName;
  args: string;
};

export function parseCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const [name, ...rest] = trimmed.split(' ');
  const cmd = COMMANDS.find((c) => c === name);
  if (!cmd) return null;
  return {name: cmd, args: rest.join(' ')};
}

export function isCommandMode(draft: string): boolean {
  return draft.startsWith('/');
}

export function commandSuggestions(prefix: string): CommandName[] {
  return COMMANDS.filter((c) => c.startsWith(prefix));
}
