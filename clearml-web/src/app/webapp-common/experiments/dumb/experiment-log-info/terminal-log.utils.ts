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

/**
 * Convert stored log events into terminal-like display rows. ClearML keeps the
 * original events for paging and downloads; only this view is compacted.
 */
export const buildTerminalLogRows = (logs: TerminalLogEvent[]): TerminalLogRow[] => {
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
