import React from 'react';
import {Box, Text} from 'ink';
import {roleColor} from '../theme.js';

export function SystemMessage({text, level}: {text: string; level: 'info' | 'warn' | 'error'}): React.ReactElement {
  const color = level === 'error' ? roleColor.error : level === 'warn' ? 'yellow' : roleColor.system;
  return (
    <Box paddingX={1}>
      <Text color={roleColor.system} bold>{'system ›'}</Text>
      <Text color={color} wrap="truncate-end"> {text}</Text>
    </Box>
  );
}
