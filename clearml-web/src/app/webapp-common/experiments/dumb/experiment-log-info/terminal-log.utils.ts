export interface TerminalLogEvent {
  timestamp?: number | string;
  '@timestamp'?: number | string;
  msg?: string;
}

export interface TerminalLogRow {
  timestamp?: number | string;
  entry: string;
  separator?: boolean;
  rewriteKey?: string;
}

// Terminal control bytes are intentionally matched before rows reach the DOM.
// eslint-disable-next-line no-control-regex
const ANSI_SEQUENCE = /\u001B\[[0-?]*[ -/]*([@-~])/g;
// eslint-disable-next-line no-control-regex
const ANSI_OSC_SEQUENCE = /\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g;
// eslint-disable-next-line no-control-regex
const ANSI_SGR_SEQUENCE = /\u001B\[[0-9;]*m/g;
// eslint-disable-next-line no-control-regex
const NON_RENDERING_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001A\u001C-\u001F\u007F]/g;

// Full-screen control operations: alternate-screen switch, erase-in-display and
// absolute cursor positioning. Their presence means the producer is repainting a
// screen (e.g. a live dashboard/animation) rather than appending lines.
// eslint-disable-next-line no-control-regex
const SCREEN_CONTROL_TEST = /\u001B\[(?:\?1049[hl]|[0-3]?J|\d*(?:;\d*)?[Hf])/;

const hasScreenControl = (logs: TerminalLogEvent[]): boolean =>
  (logs ?? []).some(item => typeof item?.msg === 'string' && SCREEN_CONTROL_TEST.test(item.msg));

/**
 * Convert stored log events into terminal-like display rows. ClearML keeps the
 * original events for paging and downloads; only this view is compacted.
 *
 * Streams that repaint a full screen (alternate-screen dashboards, animations)
 * are rendered by a small terminal emulator so overlapping frames collapse into
 * the current screen state instead of accumulating thousands of stale lines.
 */
export const buildTerminalLogRows = (logs: TerminalLogEvent[]): TerminalLogRow[] => {
  if (hasScreenControl(logs)) {
    return buildTerminalScreenRows(logs);
  }
  const rows: TerminalLogRow[] = [];

  (logs ?? []).forEach(logItem => {
    const timestamp = logItem.timestamp ?? logItem['@timestamp'];
    const message = logItem.msg ?? '';
    const eventStart = rows.length;
    let timestampPending = true;
    let buffer = '';
    let rewrite = false;

    const commit = () => {
      const entry = cleanTerminalText(buffer);
      buffer = '';
      if (!entry) {
        return;
      }

      const progressKey = getProgressKey(entry);
      const rewriteKey = progressKey || (rewrite ? 'carriage-return' : undefined);
      const previous = rows.at(-1);
      const replacePrevious = !!rewriteKey && !!previous?.rewriteKey && (
        rewriteKey === 'carriage-return' || previous.rewriteKey === rewriteKey
      );
      const row: TerminalLogRow = {
        timestamp: timestampPending ? timestamp : undefined,
        entry,
        rewriteKey,
      };

      if (replacePrevious) {
        rows[rows.length - 1] = row;
      } else {
        rows.push(row);
      }
      timestampPending = false;
      rewrite = false;
    };

    if (!message) {
      rows.push({timestamp, entry: ''});
    } else {
      message.split(/(\r\n|\r|\n)/).forEach(token => {
        if (token === '\r') {
          // A carriage return moves the cursor to the start of the active row.
          // Keep only the final state contained in this event.
          buffer = '';
          rewrite = true;
        } else if (token === '\n' || token === '\r\n') {
          commit();
          rewrite = false;
        } else {
          buffer += token;
        }
      });
      commit();
    }

    // Preserve the event boundary used by the existing console styling. If a
    // progress update replaced an earlier row, the replacement is the boundary.
    if (rows.length) {
      const lastRow = rows.at(-1);
      if (rows.length > eventStart || lastRow?.rewriteKey) {
        lastRow.separator = true;
      }
    }
  });

  return rows;
};

// Tokenizes the control operations the screen emulator understands. Text between
// matches (including SGR colour codes) is written to the virtual screen as-is.
// eslint-disable-next-line no-control-regex
const SCREEN_TOKEN = /\u001B\[\?1049[hl]|\u001B\[[0-3]?J|\u001B\[(\d*)(?:;\d*)?[Hf]|\u001B\[[0-2]?K|\r\n|\n|\r|\u0008/g;

interface ScreenCell {
  entry: string;
  timestamp?: number | string;
}

/**
 * Render events that repaint a screen into the resulting visible rows. The model
 * is deliberately line-based: absolute cursor addressing selects a row, erase and
 * clear operations drop stale content, and each repaint from the top overwrites
 * the previous frame. This keeps live dashboards/animations readable without a
 * full VT emulator while leaving ordinary logs to the append-based path above.
 */
export const buildTerminalScreenRows = (logs: TerminalLogEvent[]): TerminalLogRow[] => {
  const screen: ScreenCell[] = [];
  let row = 0;
  let buffer = '';
  let bufferTs: number | string | undefined;
  let dirty = false;

  const ensureRow = (target: number) => {
    while (screen.length <= target) {
      screen.push({entry: ''});
    }
  };

  const commit = () => {
    if (!dirty) {
      return;
    }
    ensureRow(row);
    screen[row] = {entry: buffer, timestamp: bufferTs};
    buffer = '';
    dirty = false;
  };

  (logs ?? []).forEach(logItem => {
    const timestamp = logItem.timestamp ?? logItem['@timestamp'];
    const message = logItem.msg ?? '';

    const appendText = (text: string) => {
      if (!text) {
        return;
      }
      if (!dirty) {
        bufferTs = timestamp;
      }
      buffer += text;
      dirty = true;
    };

    SCREEN_TOKEN.lastIndex = 0;
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = SCREEN_TOKEN.exec(message)) !== null) {
      appendText(message.slice(cursor, match.index));
      cursor = SCREEN_TOKEN.lastIndex;
      const token = match[0];

      if (token === '\n' || token === '\r\n') {
        commit();
        row += 1;
      } else if (token === '\r') {
        // Carriage return rewrites the active row from its start.
        buffer = '';
      } else if (token === '\b') {
        buffer = buffer.slice(0, -1);
      } else if (token.endsWith('h') || token.endsWith('l') || token.endsWith('J')) {
        // Alternate-screen switch or erase-in-display: begin a fresh frame.
        screen.length = 0;
        row = 0;
        buffer = '';
        dirty = false;
      } else if (token.endsWith('H') || token.endsWith('f')) {
        // Absolute cursor addressing: flush pending text then jump to the row.
        commit();
        const targetRow = match[1] ? parseInt(match[1], 10) : 1;
        row = Math.max(0, targetRow - 1);
        buffer = '';
      } else {
        // Erase-in-line: clear the current row's content.
        ensureRow(row);
        screen[row] = {entry: '', timestamp};
        buffer = '';
      }
    }
    appendText(message.slice(cursor));

    // A discrete log event without an explicit newline is still a finished line.
    if (dirty) {
      commit();
      row += 1;
    }
  });

  // Drop trailing blank rows produced by shrinking frames.
  let end = screen.length;
  while (end > 0 && screen[end - 1].entry === '') {
    end -= 1;
  }

  return screen.slice(0, end).map(cell => ({
    timestamp: cell.timestamp,
    entry: cleanTerminalText(cell.entry),
  }));
};

const cleanTerminalText = (value: string): string => {
  const withoutBackspaces: string[] = [];
  for (const character of value) {
    if (character === '\b') {
      withoutBackspaces.pop();
    } else {
      withoutBackspaces.push(character);
    }
  }

  return withoutBackspaces.join('')
    .replace(ANSI_OSC_SEQUENCE, '')
    // Keep SGR color/style sequences for ansi-to-html, but remove cursor
    // movement and erase-line commands that have no meaning in the DOM.
    .replace(ANSI_SEQUENCE, (sequence, command: string) => command === 'm' ? sequence : '')
    .replace(NON_RENDERING_CONTROL, '');
};

const getProgressKey = (value: string): string | undefined => {
  const plain = value.replace(ANSI_SGR_SEQUENCE, '');
  const tqdm = plain.match(/^(.*?)\s*\d{1,3}%\|/);
  if (tqdm) {
    return `tqdm:${tqdm[1].trim().toLowerCase()}`;
  }

  const keras = plain.match(/^\s*\d+\s*\/\s*(\d+)\s+(?:\[|━|=)/);
  if (keras) {
    return `keras:${keras[1]}`;
  }

  return undefined;
};
