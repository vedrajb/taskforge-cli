import React from 'react';
import {Box, Text} from 'ink';
import {TranscriptEntry} from './types.js';
import {SplitColumn} from './SplitColumn.js';
import {useSplitLayout} from './useSplitLayout.js';
import {roleColor} from './theme.js';

type SplitEntry = Extract<TranscriptEntry, {kind: 'prompt_split'}>;

export type PromptSplitProps = {
  entry: SplitEntry;
  showDiag: boolean;
};

export function PromptSplit({entry, showDiag}: PromptSplitProps): React.ReactElement {
  const agentIds = Object.keys(entry.columns);
  const {mode, colW} = useSplitLayout(agentIds.length);

  if (entry.collapsed) {
    const parts = agentIds.map((id) => {
      const col = entry.columns[id]!;
      const outputCount = col.chunks.filter((c) => c.level === 'output').length;
      const diagCount = col.chunks.filter((c) => c.level === 'diagnostic').length;
      const icon = col.status === 'done' ? '✓' : col.status === 'failed' ? '✗' : col.status === 'aborted' ? '⊘' : '·';
      const agentColor = id === 'claude' ? roleColor.claude : id === 'codex' ? roleColor.codex : 'white';
      return {id, outputCount, diagCount, icon, agentColor, status: col.status};
    });

    const diagTotal = parts.reduce((s, p) => s + p.diagCount, 0);

    return (
      <Box paddingX={1}>
        {parts.map((p, i) => (
          <Box key={p.id}>
            {i > 0 && <Text dimColor> · </Text>}
            <Text color={p.agentColor}>{p.id}</Text>
            <Text color={p.status === 'done' ? 'green' : p.status === 'failed' ? 'red' : 'gray'}>
              {' '}{p.icon} {p.outputCount}
            </Text>
          </Box>
        ))}
        {diagTotal > 0 && <Text dimColor>  ({diagTotal} diag suppressed)</Text>}
        <Text dimColor>  · press d to expand</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection={mode === 'row' ? 'row' : 'column'} paddingX={1}>
      {agentIds.map((id) => (
        <SplitColumn
          key={id}
          agentId={id}
          col={entry.columns[id]!}
          colW={colW}
          showDiag={showDiag}
        />
      ))}
    </Box>
  );
}
