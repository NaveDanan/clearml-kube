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

  it('collapses full-screen redraws driven by cursor-home into the last frame', () => {
    const frame = (a: string, b: string) => `\u001b[H${a}\n${b}\n`;
    const rows = buildTerminalLogRows([
      {timestamp: 1, msg: frame('frame one line 1', 'frame one line 2')},
      {timestamp: 2, msg: frame('frame two line 1', 'frame two line 2')},
      {timestamp: 3, msg: frame('final frame l1', 'final frame l2')},
    ]);

    expect(rows.map(row => row.entry)).toEqual(['final frame l1', 'final frame l2']);
  });

  it('collapses per-line frame events sharing a single home repaint', () => {
    const rows = buildTerminalLogRows([
      {timestamp: 1, msg: '\u001b[Hheader'},
      {timestamp: 2, msg: 'body v1'},
      {timestamp: 3, msg: '\u001b[Hheader'},
      {timestamp: 4, msg: 'body v2'},
    ]);

    expect(rows.map(row => row.entry)).toEqual(['header', 'body v2']);
  });

  it('starts a fresh frame after an alternate-screen clear', () => {
    const rows = buildTerminalLogRows([
      {timestamp: 1, msg: 'boot log line'},
      {timestamp: 2, msg: '\u001b[?1049h\u001b[2J\u001b[Hlive dashboard'},
      {timestamp: 3, msg: '\u001b[Hlive dashboard v2'},
    ]);

    expect(rows.map(row => row.entry)).toEqual(['live dashboard v2']);
  });

  it('preserves colours and unicode inside repainted frames', () => {
    const rows = buildTerminalLogRows([
      {timestamp: 1, msg: '\u001b[H\u001b[38;2;255;150;60mcampfire\u001b[0m'},
      {timestamp: 2, msg: '\u001b[H\u001b[38;2;255;150;60mcampfire!!\u001b[0m'},
    ]);

    expect(rows.map(row => row.entry)).toEqual(['\u001b[38;2;255;150;60mcampfire!!\u001b[0m']);
  });
});
