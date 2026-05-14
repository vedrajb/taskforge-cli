import React, {useEffect, useState} from 'react';
import {Box, Text} from 'ink';

export type StatusBarProps = {
  phase: string;
  targetCwd: string;
  repoRoot?: string;
  activeAgents: string[];
  isBusy: boolean;
};

const BUSY_FRAMES = ['|', '/', '-', '\\'];

export function StatusBar({phase, targetCwd, repoRoot, activeAgents, isBusy}: StatusBarProps): React.ReactElement {
  const [frameIndex, setFrameIndex] = useState(0);
  const agentText = activeAgents.length > 0 ? activeAgents.join(', ') : 'none';
  const phaseText = isBusy ? `${BUSY_FRAMES[frameIndex]} ${phase}` : phase;

  useEffect(() => {
    if (!isBusy) {
      setFrameIndex(0);
      return;
    }

    // Advance a small spinner while an agent-backed task is actively running.
    const interval = setInterval(() => {
      setFrameIndex((current) => (current + 1) % BUSY_FRAMES.length);
    }, 120);

    return () => {
      clearInterval(interval);
    };
  }, [isBusy]);

  return (
    <Box flexDirection="column">
      <Text bold color={isBusy ? 'cyan' : undefined}>
        {phaseText}
      </Text>
      <Text>target: {targetCwd}</Text>
      <Text>repo: {repoRoot ?? 'unverified'}</Text>
      <Text>agents: {agentText}</Text>
    </Box>
  );
}
