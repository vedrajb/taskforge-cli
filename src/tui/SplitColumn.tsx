import React, {useEffect, useState} from 'react';
import {Box, Spacer, Text} from 'ink';
import {SplitColumn as SplitColumnData, LogLevel} from './types.js';
import {roleColor, spinnerFrame, MAX_SPLIT_ROWS} from './theme.js';

const STATUS_ICON: Record<SplitColumnData['status'], string> = {
  running: '⠋',
  done: '✓',
  failed: '✗',
  aborted: '⊘',
};

const STATUS_COLOR: Record<SplitColumnData['status'], string> = {
  running: 'cyan',
  done: 'green',
  failed: 'red',
  aborted: 'gray',
};

export type SplitColumnProps = {
  agentId: string;
  col: SplitColumnData;
  colW: number;
  showDiag: boolean;
};

export function SplitColumn({agentId, col, colW, showDiag}: SplitColumnProps): React.ReactElement {
  const [spinFrame, setSpinFrame] = useState(0);

  useEffect(() => {
    if (col.status !== 'running') return;
    const t = setInterval(() => setSpinFrame((f) => f + 1), 100);
    return () => clearInterval(t);
  }, [col.status]);

  const agentColor = agentId === 'claude' ? roleColor.claude : agentId === 'codex' ? roleColor.codex : 'white';
  const statusIcon = col.status === 'running' ? spinnerFrame(spinFrame) : STATUS_ICON[col.status];
  const elapsed =
    col.status === 'running' && col.startedAt
      ? Math.floor((Date.now() - col.startedAt) / 1000)
      : col.endedAt && col.startedAt
      ? Math.floor((col.endedAt - col.startedAt) / 1000)
      : 0;

  const outputChunks = col.chunks.filter((c) => c.level === 'output');
  const diagChunks = col.chunks.filter((c) => c.level === 'diagnostic');
  const errorChunks = col.chunks.filter((c) => c.level === 'error');

  const visibleOutput = outputChunks.slice(-MAX_SPLIT_ROWS);
  const skipped = outputChunks.length - visibleOutput.length;

  const statusText = col.status === 'running' ? `running (${elapsed}s)` : col.status;
  const footerLeft = `${outputChunks.length} lines${diagChunks.length > 0 ? ` · ${diagChunks.length} diag` : ''} · `;

  return (
    <Box flexDirection="column" borderStyle="round" width={colW}>
      {/* Header: agent name left, nothing right — let the border be the fill */}
      <Box>
        <Text color={agentColor} bold>{agentId}</Text>
      </Box>

      {skipped > 0 && (
        <Text dimColor wrap="truncate-end">… {skipped} earlier lines</Text>
      )}
      {visibleOutput.map((c, i) => (
        <Text key={i} wrap="truncate-end">{c.text}</Text>
      ))}
      {errorChunks.map((c, i) => (
        <Text key={`e${i}`} color="red" wrap="truncate-end">{c.text}</Text>
      ))}
      {diagChunks.length > 0 && !showDiag && (
        <Text dimColor>▸ {diagChunks.length} diagnostic lines</Text>
      )}
      {diagChunks.length > 0 && showDiag && diagChunks.map((c, i) => (
        <Text key={`d${i}`} dimColor wrap="truncate-end">{c.text}</Text>
      ))}

      {/* Footer: counts left, status right */}
      <Box>
        <Text dimColor>{footerLeft}</Text>
        <Text color={STATUS_COLOR[col.status]}>{statusIcon} {statusText}</Text>
      </Box>
    </Box>
  );
}
