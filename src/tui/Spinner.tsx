import React, {useEffect, useState} from 'react';
import {Box, Text} from 'ink';
import {spinnerFrame} from './theme.js';
import {Phase} from './types.js';

const PHASE_LABEL: Partial<Record<Phase, string>> = {
  planning: 'planning…',
  executing: 'executing…',
  reviewing: 'reviewing…',
};

export type SpinnerProps = {
  phase: Phase;
  startedAt: number | null;
};

export function Spinner({phase, startedAt}: SpinnerProps): React.ReactElement | null {
  const [frame, setFrame] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const label = PHASE_LABEL[phase];
  const active = label != null;

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => {
      setFrame((f) => f + 1);
      setElapsed(startedAt != null ? Math.floor((Date.now() - startedAt) / 1000) : 0);
    }, 100);
    return () => clearInterval(interval);
  }, [active, startedAt]);

  if (!active) return null;

  return (
    <Box paddingX={1}>
      <Text color="cyan">
        {spinnerFrame(frame)} {label} ({elapsed}s)
      </Text>
    </Box>
  );
}
