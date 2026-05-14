import React from 'react';
import {Box, Text} from 'ink';
import {roleColor} from '../theme.js';

export function UserMessage({text}: {text: string}): React.ReactElement {
  return (
    <Box paddingX={1}>
      <Text color={roleColor.user} bold>{'user   ›'}</Text>
      <Text wrap="truncate-end"> {text}</Text>
    </Box>
  );
}
