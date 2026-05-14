import React from 'react';
import {Box, Text} from 'ink';

export type PlanPaneProps = {
  selectedPlan: string;
};

export function PlanPane({selectedPlan}: PlanPaneProps): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Text bold>Selected Plan</Text>
      <Text>{selectedPlan}</Text>
    </Box>
  );
}
