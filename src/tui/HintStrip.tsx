import React from 'react';
import {Box, Text} from 'ink';
import {Phase} from './types.js';

const HINTS: Record<Phase, string> = {
  idle: '? help  ·  /commands  ·  ctrl+c quit',
  planning: 'esc cancel',
  awaiting_choice: '↵ accept  ·  1 claude  ·  2 codex  ·  m merge  ·  esc cancel',
  executing: 'esc cancel',
  reviewing: 'esc cancel',
  done: '/review rerun  ·  ↵ new request  ·  ctrl+c quit',
  error: '/retry  ·  ctrl+c quit',
};

export type HintStripProps = {
  phase: Phase;
  commandMode?: boolean;
};

export function HintStrip({phase, commandMode}: HintStripProps): React.ReactElement {
  const hint = commandMode ? '/plan /execute /review /diff /clear /help /quit' : HINTS[phase];

  return (
    <Box paddingX={1}>
      <Text dimColor>{hint}</Text>
    </Box>
  );
}
