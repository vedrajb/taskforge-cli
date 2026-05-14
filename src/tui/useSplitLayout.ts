import {useEffect, useState} from 'react';
import {MIN_COL_WIDTH, GUTTER_WIDTH} from './theme.js';

export type SplitMode = 'row' | 'stack';

export type SplitLayout = {
  mode: SplitMode;
  colW: number;
};

export function useSplitLayout(n: number): SplitLayout {
  const [termCols, setTermCols] = useState(process.stdout.columns ?? 80);

  useEffect(() => {
    const onResize = () => setTermCols(process.stdout.columns ?? 80);
    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
    };
  }, []);

  // paddingX={1} on PromptSplit's parent uses 2 cols; each box has a 1-char gutter between columns.
  const available = termCols - 2;
  const colW = Math.floor((available - (n - 1) * GUTTER_WIDTH) / Math.max(n, 1));

  if (colW < MIN_COL_WIDTH) {
    return {mode: 'stack', colW: available};
  }
  return {mode: 'row', colW};
}
