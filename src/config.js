import boxen from 'boxen';
import chalk from 'chalk';
import Conf from 'conf';
import prompts from 'prompts';

import { HotkeyService } from './services/hotkey.js';
import { LANGUAGES } from './data/languages.js';

const DEFAULT_CONFIG = {
  hotkey: { modifiers: ['cmd'], key: ';' },
  speech: { language: 'en', deepgramApiKey: null },
  setupDone: false,
};

class Config {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.conf = new Conf({
      projectName: 'speech2type',
      defaults: DEFAULT_CONFIG,
      schema: {
        hotkey: {
          type: 'object',
          properties: {
            modifiers: { type: 'array', items: { type: 'string' } },
            key: { type: 'string' },
          },
        },
        speech: {
          type: 'object',
          properties: {
            language: { type: 'string' },
            deepgramApiKey: { type: 'string', format: 'password', nullable: true },
          },
        },
      },
    });
    this.isFirstRun = !this.data.setupDone;
  }

  get data() {
    return this.conf.store;
  }

  get cancelHandler() {
    return {
      onCancel: () => {
        console.log('\n→ Cancelled');
        process.exit(0);
      },
    };
  }

  formatHotkey(hotkey = this.data.hotkey) {
    return hotkey.modifiers.join('+').toUpperCase() + '+' + hotkey.key.toUpperCase();
  }

  formatLanguage(language = this.data.speech.language) {
    const lang = LANGUAGES.find((lang) => lang.code === language);
    return lang ? `${lang.name} (${lang.code})` : language || 'English (US)';
  }

  showPath() {
    console.log(this.conf.path);
  }

  showHelp() {
    console.log(
      boxen(`${chalk.bold('Speech2Type')}\n\n${chalk.dim('Speech-to-text from your terminal to your cursor for any mac app.')}`, {
        padding: 1,
        borderStyle: 'round',
        borderColor: 'magenta',
        title: 'Help',
        fullscreen: (width, _) => [width - 10, 7],
      })
    );
    console.log(chalk.bold('Usage:'));
    console.log('  s2t                             Start app (default)');
    console.log('  s2t start                       Start app');
    console.log('  s2t config                      Show current configuration\n');
    console.log('  s2t config --hotkey             Change hotkey');
    console.log('  s2t config --language           Change language');
    console.log('  s2t config --deepgram-api-key   Update Deepgram API key\n');
    console.log(chalk.bold(`Current configuration:`));
    console.log(`  Hotkey: ${this.formatHotkey()}`);
    console.log(`  Language: ${this.formatLanguage()}`);
    console.log(
      `  Deepgram API key: ${
        this.data.speech.deepgramApiKey
          ? `Configured (${this.data.speech.deepgramApiKey.slice(0, 3)}...${this.data.speech.deepgramApiKey.slice(-3)})`
          : 'Not set'
      }`
    );
    console.log(chalk.dim('\nFor more information, visit: https://github.com/gergomiklos/speech2type\n'));
  }

  async configureDeepgramApiKey() {
    console.log(chalk.dim('Get a free API key here: https://deepgram.com'));

    while (true) {
      const response = await prompts(
        {
          type: 'password',
          name: 'apiKey',
          message: 'Paste your API key:',
        },
        this.cancelHandler
      );

      if (response.apiKey) {
        this.conf.set('speech.deepgramApiKey', response.apiKey);
        console.log(chalk.green('→ API key saved\n'));
        return response.apiKey;
      } else {
        console.log(chalk.red('→ No API key entered\n'));
      }
    }
  }

  async configureLanguage() {
    // Create choices with only English first, then "Show all" option
    const defaultChoices = [
      { title: 'English', value: 'en' },
      { title: '→ Show all languages (40+)', value: 'SHOW_ALL' },
    ];

    let languageResponse = await prompts(
      {
        type: 'select',
        name: 'language',
        message: 'Choose your language:',
        choices: defaultChoices,
      },
      this.cancelHandler
    );

    // If user selected "Show all", show complete list
    if (languageResponse.language === 'SHOW_ALL') {
      languageResponse = await prompts(
        {
          type: 'select',
          name: 'language',
          message: 'Choose your language (all languages):',
          choices: LANGUAGES.map((lang) => ({
            title: `${lang.name} (${lang.code})`,
            value: lang.code,
          })),
        },
        this.cancelHandler
      );
    }

    if (languageResponse.language) {
      const selectedLang = LANGUAGES.find((l) => l.code === languageResponse.language);
      this.conf.set('speech.language', selectedLang.code);
      console.log(chalk.green(`→ Language: ${selectedLang.name} (${selectedLang.code})\n`));
      return;
    }
    console.log(chalk.yellow('→ Using English (US)\n'));
  }

  captureHotkey() {
    try {
      const hotkeyService = new HotkeyService(this);
      return hotkeyService.capture();
    } catch (error) {
      console.log('Failed to capture hotkey', error);
      return null;
    }
  }

  async configureHotkey() {
    const response = await prompts(
      {
        type: 'confirm',
        name: 'keep',
        message: `Keep current hotkey? ${this.formatHotkey()}`,
        initial: true,
      },
      this.cancelHandler
    );

    if (!response.keep) {
      console.log(chalk.bold('Press your new hotkey combination...'));
      console.log(chalk.dim('(Ctrl+C to cancel)'));

      const hotkeyData = this.captureHotkey();
      if (hotkeyData) {
        this.conf.set('hotkey', hotkeyData);
        console.log(chalk.green(`→ New hotkey: ${this.formatHotkey(hotkeyData)}\n`));
      } else {
        console.log(chalk.yellow(`→ Hotkey not changed: ${this.formatHotkey()}\n`));
      }
    } else {
      console.log(chalk.green(`→ Keeping hotkey: ${this.formatHotkey()}\n`));
    }
  }

  async setupWizard() {
    console.clear();
    console.log(chalk.bold('Speech2Type Setup\n'));
    console.log('Speak anywhere. Text appears at your cursor.\n');

    // API Key
    console.log(chalk.bold('Deepgram API Key (for speech recognition)'));
    await this.configureDeepgramApiKey();

    // Language
    console.log(chalk.bold('Language (for speech recognition)'));
    await this.configureLanguage();

    // Hotkey
    console.log(chalk.bold('Hotkey (to start listening)'));
    await this.configureHotkey();

    // Mark setup as complete
    this.conf.set('setupDone', true);

    console.log(chalk.dim('Run with --help for more options later.\n'));
  }

  async ensureDeepgramApiKey() {
    let apiKey = this.data.speech.deepgramApiKey || process.env.DEEPGRAM_API_KEY;

    if (!apiKey) {
      console.log(chalk.yellow('Deepgram API key required for speech recognition. Please provide one to continue.\n'));

      apiKey = await this.configureDeepgramApiKey();
    }

    return apiKey;
  }
}

export { Config };
