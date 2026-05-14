import React from 'react';
import {Box, Text} from 'ink';
import {roleColor} from '../theme.js';
import {LogLevel} from '../types.js';

export function AgentMessage({
  agent,
  text,
  level,
}: {
  agent: string;
  text: string;
  level: LogLevel;
}): React.ReactElement {
  const agentColor = agent === 'claude' ? roleColor.claude : agent === 'codex' ? roleColor.codex : 'white';
  const tag = agent.padEnd(6, ' ') + ' ›';
  const dim = level === 'diagnostic';
  const errColor = level === 'error' ? roleColor.error : undefined;

  return (
    <Box paddingX={1}>
      <Text color={agentColor} bold>{tag}</Text>
      <Text color={errColor} dimColor={dim} wrap="truncate-end"> {text}</Text>
    </Box>
  );
}
