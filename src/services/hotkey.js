import { spawn, execFileSync } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import readline from 'readline';

class HotkeyService extends EventEmitter {
  constructor(config) {
    super();
    this.hotkeyBin = path.join(config.projectRoot, 'bin', 'hotkey-manager');
    this.hotkeyConfig = config.data.hotkey;
    this.proc = null;
  }

  start() {
    if (this.proc) return;

    const args = this.hotkeyConfig ? [this.hotkeyConfig.modifiers.join('+'), this.hotkeyConfig.key] : [];

    this.proc = spawn(this.hotkeyBin, args, {
      stdio: ['ignore', 'pipe', process.env.DEBUG ? 'inherit' : 'ignore'],
    });

    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on('line', (line) => {
      if (line.trim() === 'TRIGGERED') {
        this.emit('toggle');
      }
    });

    this.proc.on('exit', (code) => {
      console.debug('[hotkey] Hotkey manager exited with code:', code);
      this.proc = null;
    });
  }

  stop() {
    if (this.proc) {
      process.kill(this.proc.pid, 'SIGTERM');
      this.proc = null;
    }
  }

  capture(timeoutMs = 30_000) {
    const stdout = execFileSync(this.hotkeyBin, ['--capture'], {
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', process.env.DEBUG ? 'inherit' : 'ignore'],
    });
    return JSON.parse(stdout.toString());
  }
}

export { HotkeyService };
