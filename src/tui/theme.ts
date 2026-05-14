export const roleColor = {
  user: 'cyan',
  claude: 'magenta',
  codex: 'green',
  system: 'gray',
  error: 'red',
  plan: 'yellow',
} as const;

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const ASCII_FRAMES = ['|', '/', '-', '\\'];

export function spinnerFrame(index: number): string {
  const frames = process.env['TF_ASCII'] ? ASCII_FRAMES : SPINNER_FRAMES;
  return frames[index % frames.length] ?? '·';
}

export const MIN_COL_WIDTH = 24;
export const MAX_SPLIT_ROWS = 12;
export const GUTTER_WIDTH = 1;
