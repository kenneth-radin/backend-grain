/**
 * Parser for the raw ESP32 command strings.
 *
 * Supported forms:
 *   START:MANUAL|AUTO:temp:fanSpeed   e.g. START:AUTO:45:80
 *   STOP
 *   FAN:FAN1|FAN2|ALL:ON|OFF          e.g. FAN:FAN1:ON
 *   STEP:START|STOP|CW|CCW            e.g. STEP:CW
 *   R1:1|R1:0                         relay ON/OFF
 *   H1:1|H1:0                         heater ON/OFF
 */

export interface ParsedCommand {
  command: string;
  commandStr: string;
  parameters: {
    mode: 'AUTO' | 'MANUAL';
    temperature?: number;
    fanSpeed?: number;
  };
  fanTarget?: 'FAN1' | 'FAN2' | 'ALL';
  fanAction?: 'ON' | 'OFF';
  relayAction?: 'ON' | 'OFF';
  stepperAction?: 'START' | 'STOP' | 'CW' | 'CCW';
  heaterAction?: 'ON' | 'OFF';
}

export function parseCommandString(raw: unknown): ParsedCommand | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;

  const s = raw.trim().toUpperCase().replace(/\s+/g, '');
  const parts = s.split(':');

  switch (parts[0]) {
    case 'START': {
      // START:<MODE>[:temp[:fanSpeed]]
      if (parts.length < 2) return null;
      const mode = parts[1] === 'AUTO' ? 'AUTO' : parts[1] === 'MANUAL' ? 'MANUAL' : null;
      if (!mode) return null;

      let temperature: number | undefined;
      let fanSpeed: number | undefined;

      if (parts[2] !== undefined && parts[2] !== '') {
        temperature = Number(parts[2]);
        if (!Number.isFinite(temperature)) return null;
      }
      if (parts[3] !== undefined && parts[3] !== '') {
        fanSpeed = Number(parts[3]);
        if (!Number.isFinite(fanSpeed)) return null;
      }

      return { command: s, commandStr: s, parameters: { mode, temperature, fanSpeed } };
    }

    case 'STOP':
      return { command: 'STOP', commandStr: 'STOP', parameters: { mode: 'MANUAL' } };

    case 'FAN': {
      if (parts.length < 3) return null;
      const target = parts[1];
      const action = parts[2];
      if (!['FAN1', 'FAN2', 'ALL'].includes(target)) return null;
      if (!['ON', 'OFF'].includes(action)) return null;
      return {
        command: s,
        commandStr: s,
        parameters: { mode: 'MANUAL' },
        fanTarget: target as ParsedCommand['fanTarget'],
        fanAction: action as ParsedCommand['fanAction']
      };
    }

    case 'STEP': {
      const action = parts[1];
      if (!action || !['START', 'STOP', 'CW', 'CCW'].includes(action)) return null;
      return {
        command: s,
        commandStr: s,
        parameters: { mode: 'MANUAL' },
        stepperAction: action as ParsedCommand['stepperAction']
      };
    }

    case 'R1':
    case 'H1': {
      const flag = parts[1];
      if (flag !== '1' && flag !== '0') return null;
      const state = flag === '1' ? 'ON' : 'OFF';
      if (parts[0] === 'R1') {
        return {
          command: s,
          commandStr: s,
          parameters: { mode: 'MANUAL' },
          relayAction: state
        };
      }
      return {
        command: s,
        commandStr: s,
        parameters: { mode: 'MANUAL' },
        heaterAction: state
      };
    }

    default:
      return null;
  }
}
