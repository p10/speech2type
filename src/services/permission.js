import { spawn, execFileSync } from 'child_process';
import path from 'path';

import chalk from 'chalk';

class PermissionService {
  constructor(config) {
    this.permissionBin = path.join(config.projectRoot, 'bin', 'permission-checker');
  }

  async showPermissionError(permissions) {
    console.log(chalk.red('\nMissing required permissions:\n'));

    if (!permissions.microphone) {
      console.log(chalk.bold('MICROPHONE ACCESS'));
      console.log(chalk.dim('This app needs Microphone access to capture speech.'));
      console.log(chalk.dim('Your terminal app needs to be added to the microphone permissions list.\n'));

      console.log('STEPS TO FIX:');
      console.log(chalk.dim('1. Open System Preferences > Security & Privacy > Privacy > Microphone'));
      console.log(chalk.dim('2. Look for your terminal app in the list or add it with "+" button'));
      console.log(chalk.dim('3. Check the box next to your terminal app to enable Microphone access\n'));

      spawn('open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'], { stdio: 'ignore' });
    }

    if (!permissions.accessibility) {
      console.log(chalk.bold('ACCESSIBILITY ACCESS'));
      console.log(chalk.dim('This app needs Accessibility access for global hotkeys.'));
      console.log(chalk.dim('Your terminal app needs to be added to the Accessibility permissions list manually.\n'));

      console.log('STEPS TO FIX:');
      console.log(chalk.dim('1. Open System Preferences > Security & Privacy > Privacy > Accessibility'));
      console.log(chalk.dim('2. Look for your terminal app in the list or add it with "+" button'));
      console.log(chalk.dim('3. Check the box next to your terminal app to enable Accessibility access\n'));

      spawn('open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'], { stdio: 'ignore' });
    }

    if (!permissions.automation) {
      console.log(chalk.bold('AUTOMATION - SYSTEM EVENTS ACCESS'));
      console.log(chalk.dim('This app needs Automation - System Events access for text typing.'));
      console.log(chalk.dim('Your terminal app needs to be added to the Automation permissions list.\n'));

      console.log('STEPS TO FIX:');
      console.log(chalk.dim('1. Open System Preferences > Security & Privacy > Privacy > Automation'));
      console.log(chalk.dim('2. Look for your terminal app in the list or add it with "+" button'));
      console.log(chalk.dim('3. Click on your terminal app and check the box next to "System Events"'));

      spawn('open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_Automation'], { stdio: 'ignore' });
    }

    console.log('COMMON TERMINAL APPS:');
    console.log(chalk.dim('Terminal (built-in macOS terminal), Warp, VS Code, Cursor (integrated in-app terminals)\n'));
    console.log('Once permissions are granted, restart the app to continue.');
  }

  validateAllPermissions() {
    console.debug('[permissions] Checking permissions...');

    let result;

    // microphone & accessibility
    try {
      const stdout = execFileSync(this.permissionBin, { stdio: ['ignore', 'pipe', 'pipe'] });
      result = JSON.parse(stdout.toString());
    } catch (error) {
      console.error('[permission] Failed to check permissions programmatically:', error);
    }

    // automation - system events
    try {
      execFileSync('/usr/bin/osascript', ['-e', 'tell application "System Events" to keystroke ""']);
      result.automation = true;
    } catch (error) {
      console.error('[permission] Failed to check permissions programmatically:', error);
    }

    const allGranted = Boolean(result.microphone && result.accessibility && result.automation);
    if (!allGranted) {
      this.showPermissionError(result);
      return false;
    }

    console.debug('[permissions] All permissions granted.');
    return true;
  }
}

export { PermissionService };
