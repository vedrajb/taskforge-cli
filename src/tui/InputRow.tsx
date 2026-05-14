import React from 'react';
import {Box, Text, useInput} from 'ink';

export type InputRowProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
};

export function InputRow({value, onChange, onSubmit}: InputRowProps): React.ReactElement {
  useInput((input, key) => {
    // Submit, edit, or append printable input in one place until Phase 2 shortcuts are added.
    if (key.return) {
      onSubmit(value);
      return;
    }

    if (key.backspace || key.delete) {
      onChange(value.slice(0, -1));
      return;
    }

    if (!key.ctrl && !key.meta && input) {
      onChange(`${value}${input}`);
    }
  });

  return (
    <Box>
      <Text bold>prompt </Text>
      <Text>{value}</Text>
      <Text color="gray">_</Text>
    </Box>
  );
}
