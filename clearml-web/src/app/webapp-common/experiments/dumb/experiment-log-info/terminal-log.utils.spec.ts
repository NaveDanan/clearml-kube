import {buildTerminalLogRows} from './terminal-log.utils';

describe('buildTerminalLogRows', () => {
  it('keeps ordinary log events and unicode intact', () => {
    const rows = buildTerminalLogRows([
      {timestamp: 1, msg: 'Starting training 🚀'},
      {timestamp: 2, msg: 'Accuracy ✅\nمرحبا بالعالم'},
    ]);

    expect(rows.map(row => row.entry)).toEqual([
      'Starting training 🚀',
      'Accuracy ✅',
      'مرحبا بالعالم',
    ]);
  });

  it('replaces consecutive carriage-return progress updates', () => {
    const rows = buildTerminalLogRows([
      {timestamp: 1, msg: '\r 10%|█         | 1/10'},
      {timestamp: 2, msg: '\r 50%|█████     | 5/10'},
      {timestamp: 3, msg: '\r100%|██████████| 10/10\n'},
      {timestamp: 4, msg: 'Training complete'},
    ]);

    expect(rows.map(row => row.entry)).toEqual([
      '100%|██████████| 10/10',
      'Training complete',
    ]);
    expect(rows[0].timestamp).toBe(3);
  });

  it('compacts tqdm updates even when storage removed carriage returns', () => {
    const rows = buildTerminalLogRows([
      {timestamp: 1, msg: 'Epoch 2: 5%|▌         | 1/20'},
      {timestamp: 2, msg: 'Epoch 2: 75%|███████▌  | 15/20'},
      {timestamp: 3, msg: 'Epoch 3: 5%|▌         | 1/20'},
    ]);

    expect(rows.map(row => row.entry)).toEqual([
      'Epoch 2: 75%|███████▌  | 15/20',
      'Epoch 3: 5%|▌         | 1/20',
    ]);
  });

  it('keeps ANSI styling but removes terminal cursor commands', () => {
    const rows = buildTerminalLogRows([
      {timestamp: 1, msg: '\u001b[2K\u001b[31mFailed\u001b[0m'},
    ]);

    expect(rows[0].entry).toBe('\u001b[31mFailed\u001b[0m');
  });
});
