import {
  Container,
  Editor,
  Loader,
  ProcessTerminal,
  Spacer,
  Text,
  TUI,
  matchesKey,
  visibleWidth,
  wrapTextWithAnsi,
  type EditorTheme,
} from '@mariozechner/pi-tui';
import type {Component} from '@mariozechner/pi-tui';
import type {TranscriptEntry, SplitColumn as SplitColumnT} from './types.js';

const ANSI = {
  primary:   '\x1b[36m',   // cyan
  secondary: '\x1b[32m',   // green
  claude:    '\x1b[35m',   // magenta
  codex:     '\x1b[32m',   // green
  error:     '\x1b[31m',   // red
  warn:      '\x1b[33m',   // yellow
  plan:      '\x1b[33m',   // yellow
  gray:      '\x1b[90m',
  bold:      '\x1b[1m',
  reset:     '\x1b[0m',
};

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const ASCII_FRAMES   = ['|', '/', '-', '\\'];

function spinnerFrames(): string[] {
  return process.env['TF_ASCII'] ? ASCII_FRAMES : SPINNER_FRAMES;
}

function color(c: string, text: string): string {
  return `${c}${text}${ANSI.reset}`;
}

const EDITOR_THEME: EditorTheme = {
  borderColor: (s) => color(ANSI.primary, s),
  selectList: {
    selectedPrefix: (s) => color(ANSI.primary, s),
    selectedText:   (s) => color(ANSI.primary, s),
    description:    (s) => color(ANSI.gray, s),
    scrollInfo:     (s) => color(ANSI.gray, s),
    noMatch:        (s) => color(ANSI.gray, s),
  },
};

/**
 * Truncate a string to fit a visible-width budget, respecting ANSI escape codes.
 * Drops characters from the right until visible width <= maxWidth.
 */
function truncateAnsi(text: string, maxWidth: number): string {
  if (visibleWidth(text) <= maxWidth) return text;
  // Walk through grapheme-by-grapheme, preserving ANSI sequences
  let out = '';
  let w = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] === '\x1b' && text[i + 1] === '[') {
      const end = text.indexOf('m', i);
      if (end !== -1) {
        out += text.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    const ch = text[i]!;
    const chW = visibleWidth(ch);
    if (w + chW > maxWidth) break;
    out += ch;
    w += chW;
    i++;
  }
  return out + ANSI.reset;
}

function padToWidth(text: string, width: number): string {
  const w = visibleWidth(text);
  if (w >= width) return text;
  return text + ' '.repeat(width - w);
}

/**
 * RawLines: a pi-tui component that emits a fixed set of pre-rendered lines.
 * Unlike Markdown/Text it does NOT wrap, parse, or reflow content; it only
 * truncates per-line to fit `width` and pads each line to exactly width.
 */
class RawLines implements Component {
  constructor(private lines: string[]) {}

  setLines(lines: string[]): void {
    this.lines = lines;
  }

  invalidate(): void {}

  render(width: number): string[] {
    return this.lines.map((line) => padToWidth(truncateAnsi(line, width), width));
  }
}

/** Renders text entries (single or multi-line) into raw lines with a left margin. */
function renderEntryLines(entry: TranscriptEntry): string[] {
  switch (entry.kind) {
    case 'user':
      return [' ' + color(ANSI.primary, 'user   › ') + entry.text];

    case 'system': {
      const c = entry.level === 'error' ? ANSI.error : entry.level === 'warn' ? ANSI.warn : ANSI.gray;
      return [' ' + color(c, 'system › ') + entry.text];
    }

    case 'agent': {
      const ac = entry.agent === 'claude' ? ANSI.claude : entry.agent === 'codex' ? ANSI.codex : ANSI.reset;
      const tag = entry.agent.padEnd(6, ' ') + ' › ';
      const lines = entry.text.split('\n');
      return lines.map((line, i) => {
        let body = line;
        if (entry.level === 'diagnostic') body = color(ANSI.gray, body);
        else if (entry.level === 'error') body = color(ANSI.error, body);
        return i === 0
          ? ' ' + color(ac, tag) + body
          : ' ' + ' '.repeat(tag.length) + body;
      });
    }

    case 'plan': {
      const out: string[] = [];
      out.push(' ' + color(ANSI.plan, 'plan   › ') + color(ANSI.gray, `[${entry.source}] `) + entry.plan.goal);
      for (let i = 0; i < entry.plan.steps.length; i++) {
        out.push('          ' + color(ANSI.gray, `${i + 1}. ${entry.plan.steps[i]!.title}`));
      }
      return out;
    }

    case 'parity': {
      const cc = entry.classification === 'same' ? ANSI.secondary
        : entry.classification === 'compatible' ? ANSI.warn
        : ANSI.error;
      return [
        ' ' + color(ANSI.gray, 'parity › ') + color(cc, entry.classification) + color(ANSI.gray, ` — ${entry.reason}`),
        '          ' + color(ANSI.claude, 'claude: ') + entry.claudePlan.summary,
        '          ' + color(ANSI.codex,  'codex:  ') + entry.codexPlan.summary,
      ];
    }

    case 'prompt_split':
      // Handled by SplitComponent (live updates); fallback static rendering at fixed 80 width.
      return renderSplitLines(entry, !!process.env['TF_SHOW_DIAG'], 80);

    default:
      return [];
  }
}

function colorForAgent(id: string): string {
  return id === 'claude' ? ANSI.claude : id === 'codex' ? ANSI.codex : ANSI.reset;
}

function colorForStatus(status: SplitColumnT['status']): string {
  return status === 'done' ? ANSI.secondary : status === 'failed' ? ANSI.error : ANSI.gray;
}

/** Render the split block as raw lines for a known total width. */
function renderSplitLines(
  entry: Extract<TranscriptEntry, {kind: 'prompt_split'}>,
  showDiag: boolean,
  totalWidth: number
): string[] {
  const agentIds = Object.keys(entry.columns);
  if (agentIds.length === 0) return [];

  if (entry.collapsed) {
    const parts = agentIds.map((id) => {
      const col = entry.columns[id]!;
      const outputCount = col.chunks.filter((c) => c.level === 'output').length;
      const diagCount   = col.chunks.filter((c) => c.level === 'diagnostic').length;
      const icon = col.status === 'done' ? '✓' : col.status === 'failed' ? '✗' : col.status === 'aborted' ? '⊘' : '·';
      const ac = colorForAgent(id);
      const sc = colorForStatus(col.status);
      const diagNote = diagCount > 0 && !showDiag ? color(ANSI.gray, ` (${diagCount} diag)`) : '';
      return `${color(ac, id)} ${color(sc, `${icon} ${outputCount}`)}${diagNote}`;
    });
    return [' ' + parts.join(color(ANSI.gray, ' · ')) + color(ANSI.gray, '  · d to expand')];
  }

  // Side-by-side blocks. Account for left margin (1) and 1-col gutter between columns.
  const n = agentIds.length;
  const leftMargin = 1;
  const gutter = 1;
  const available = Math.max(20, totalWidth - leftMargin - (n - 1) * gutter);
  const colW = Math.max(20, Math.floor(available / n));

  const blocks = agentIds.map((id) => {
    const col = entry.columns[id]!;
    const ac = colorForAgent(id);
    const sc = colorForStatus(col.status);
    const icon = col.status === 'running' ? '⠋' : col.status === 'done' ? '✓' : col.status === 'failed' ? '✗' : '⊘';
    const elapsed = col.endedAt
      ? Math.floor((col.endedAt - col.startedAt) / 1000)
      : Math.floor((Date.now() - col.startedAt) / 1000);

    const lines: string[] = [];

    // Header: ┌─ id ─...─┐
    const headLabel = ` ${id} `;
    const headFill = '─'.repeat(Math.max(0, colW - 2 - visibleWidth(headLabel)));
    lines.push(color(ac, '┌' + headLabel + headFill + '┐'));

    const innerW = colW - 4;  // "│ " + content + " │"
    const MAX_BODY_ROWS = 20;

    const pushBody = (line: string, lineColor?: string) => {
      const padded = padToWidth(truncateAnsi(line, innerW), innerW);
      const styled = lineColor ? color(lineColor, padded) : padded;
      lines.push(color(ac, '│') + ' ' + styled + ' ' + color(ac, '│'));
    };

    // Join all chunks of the same level into a continuous stream and word-wrap
    // to the column width. acpx emits text_delta as tiny tokens, so we MUST
    // re-stitch them before line-wrapping or each token gets its own row.
    const wrapJoined = (chunks: typeof col.chunks): string[] => {
      const joined = chunks.map((c) => c.text).join('');
      if (!joined) return [];
      // Honor explicit \n in the stream, then word-wrap each logical line.
      const out: string[] = [];
      for (const logical of joined.split('\n')) {
        if (logical === '') { out.push(''); continue; }
        for (const w of wrapTextWithAnsi(logical, innerW)) out.push(w);
      }
      return out;
    };

    const outputLines = wrapJoined(col.chunks.filter((c) => c.level === 'output'));
    const diagLines = showDiag ? wrapJoined(col.chunks.filter((c) => c.level === 'diagnostic')) : [];
    const errorLines = wrapJoined(col.chunks.filter((c) => c.level === 'error'));

    // Show the most recent MAX_BODY_ROWS lines so streaming output keeps the tail visible.
    const all: Array<{text: string; color?: string}> = [
      ...outputLines.map((t) => ({text: t})),
      ...diagLines.map((t) => ({text: t, color: ANSI.gray})),
      ...errorLines.map((t) => ({text: t, color: ANSI.error})),
    ];
    const visible = all.slice(-MAX_BODY_ROWS);
    const skipped = all.length - visible.length;
    if (skipped > 0) pushBody(`… ${skipped} earlier lines`, ANSI.gray);
    for (const row of visible) pushBody(row.text, row.color);
    if (lines.length === 1) pushBody('');

    // Footer: └─ icon status (Ns) ─...─┘
    const footLabel = ` ${icon} ${col.status} (${elapsed}s) `;
    const footFill = '─'.repeat(Math.max(0, colW - 2 - visibleWidth(footLabel)));
    lines.push(color(sc, '└' + footLabel + footFill + '┘'));

    return lines;
  });

  // Stack rows side-by-side
  const maxRows = Math.max(...blocks.map((b) => b.length));
  const out: string[] = [];
  for (let i = 0; i < maxRows; i++) {
    const cells = blocks.map((b) => {
      const cell = b[i] ?? '';
      return padToWidth(cell, colW);
    });
    out.push(' '.repeat(leftMargin) + cells.join(' '.repeat(gutter)));
  }
  return out;
}

/** A live split block — re-renders on demand based on current entry state. */
class SplitComponent implements Component {
  constructor(
    private entry: Extract<TranscriptEntry, {kind: 'prompt_split'}>,
    private showDiag: boolean
  ) {}

  setEntry(entry: Extract<TranscriptEntry, {kind: 'prompt_split'}>): void {
    this.entry = entry;
  }

  setShowDiag(showDiag: boolean): void {
    this.showDiag = showDiag;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const lines = renderSplitLines(this.entry, this.showDiag, width);
    return lines.map((line) => padToWidth(truncateAnsi(line, width), width));
  }
}

export type ScreenCallbacks = {
  onSubmit: (text: string) => void;
  onKey: (key: string) => boolean;
};

export class PiTuiScreen {
  private tui: TUI;
  private chat: Container;
  private editor: Editor;
  private hint: Text;
  private spinnerLoader: Loader | null = null;
  private spinnerFrameIdx = 0;
  private spinnerInterval: ReturnType<typeof setInterval> | null = null;
  private spinnerLabel = '';
  private activeSplit: SplitComponent | null = null;
  private showDiag = !!process.env['TF_SHOW_DIAG'];
  private stopResolver: (() => void) | null = null;

  constructor(callbacks: ScreenCallbacks) {
    const terminal = new ProcessTerminal();
    this.tui = new TUI(terminal, false);

    this.chat = new Container();
    this.editor = new Editor(this.tui, EDITOR_THEME);
    this.hint = new Text('', 1, 0);

    this.tui.addChild(this.chat);
    this.tui.addChild(new Spacer(1));
    this.tui.addChild(this.editor);
    this.tui.addChild(this.hint);

    this.tui.addInputListener((data: string) => {
      if (matchesKey(data, 'ctrl+c')) {
        this.stop();
        return {consume: true};
      }
      const consumed = callbacks.onKey(data);
      return consumed ? {consume: true} : undefined;
    });

    this.editor.onSubmit = (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      this.editor.disableSubmit = true;
      try {
        callbacks.onSubmit(trimmed);
      } finally {
        this.editor.disableSubmit = false;
        this.editor.setText('');
      }
    };
  }

  start(): Promise<void> {
    this.tui.start();
    this.tui.setFocus(this.editor);
    return new Promise<void>((resolve) => {
      this.stopResolver = resolve;
    });
  }

  stop(): void {
    this.tui.stop();
    if (this.stopResolver) {
      this.stopResolver();
      this.stopResolver = null;
    }
  }

  banner(line: string): void {
    this.chat.addChild(new RawLines([' ' + color(ANSI.gray, line)]));
    this.tui.requestRender();
  }

  setHint(text: string): void {
    this.hint.setText(color(ANSI.gray, text));
    this.tui.requestRender();
  }

  setEditorDisabled(disabled: boolean): void {
    this.editor.disableSubmit = disabled;
  }

  appendEntry(entry: TranscriptEntry): void {
    const lines = renderEntryLines(entry);
    if (lines.length === 0) return;
    this.chat.addChild(new RawLines(lines));
    this.tui.requestRender();
  }

  beginSplit(entry: Extract<TranscriptEntry, {kind: 'prompt_split'}>): void {
    this.activeSplit = new SplitComponent(entry, this.showDiag);
    this.chat.addChild(this.activeSplit);
    this.tui.requestRender(true);
  }

  updateSplit(entry: Extract<TranscriptEntry, {kind: 'prompt_split'}>): void {
    if (!this.activeSplit) return;
    this.activeSplit.setEntry(entry);
    this.tui.requestRender(true);
  }

  finalizeSplit(): void {
    this.activeSplit = null;
    this.tui.requestRender();
  }

  toggleDiag(): void {
    this.showDiag = !this.showDiag;
    this.activeSplit?.setShowDiag(this.showDiag);
    this.tui.requestRender();
  }

  startSpinner(label: string): void {
    if (this.spinnerLoader) this.stopSpinner();
    this.spinnerLabel = label;
    this.spinnerFrameIdx = 0;
    this.spinnerLoader = new Loader(
      this.tui,
      (s: string) => color(ANSI.primary, s),
      (s: string) => s,
      `${spinnerFrames()[0]} ${label}`
    );
    this.chat.addChild(this.spinnerLoader);
    this.spinnerInterval = setInterval(() => {
      this.spinnerFrameIdx++;
      const f = spinnerFrames();
      this.spinnerLoader?.setMessage(`${f[this.spinnerFrameIdx % f.length]} ${this.spinnerLabel}`);
      this.tui.requestRender();
    }, 100);
  }

  stopSpinner(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
    if (this.spinnerLoader) {
      this.chat.removeChild(this.spinnerLoader);
      this.spinnerLoader = null;
    }
    this.tui.requestRender();
  }
}
