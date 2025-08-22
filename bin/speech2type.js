#!/usr/bin/env node

if (!process.env.DEBUG) {
  console.debug = () => {};
}

import path from 'path';
import { fileURLToPath } from 'url';

import { Config } from '../src/config.js';
import { startApplication } from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');
const config = new Config(projectRoot);

const args = process.argv.slice(2);
const command = args[0];
const flag = args[1];

async function main() {
  switch (command) {
    case 'config':
      if (flag === '--hotkey') {
        await config.configureHotkey();
      } else if (flag === '--language') {
        await config.configureLanguage();
      } else if (flag === '--deepgram-api-key') {
        await config.configureDeepgramApiKey();
      } else if (flag === '--path') {
        config.showPath();
      } else {
        config.showHelp();
      }
      break;

    case 'help':
    case '--help':
    case '-h':
      config.showHelp();
      break;

    case 'start':
    case undefined:
      await startApplication(config);
      break;

    default:
      console.log(`Unknown command: ${command}`);
      config.showHelp();
      process.exit(1);
  }
}

main().catch(console.error);
