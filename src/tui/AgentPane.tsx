import React from 'react';
import {Box, Text} from 'ink';

export type AgentLogLine = {
  stream: 'stdout' | 'stderr';
  text: string;
};

export type AgentPaneProps = {
  logs: AgentLogLine[];
};

export function AgentPane({logs}: AgentPaneProps): React.ReactElement {
  const visibleLogs = logs.slice(-30);

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Text bold>Live Output</Text>
      {visibleLogs.map((log, index) => (
        <Text key={`${index}-${log.text}`} color={log.stream === 'stderr' ? 'red' : undefined}>
          [{log.stream}] {log.text}
        </Text>
      ))}
    </Box>
  );
}
