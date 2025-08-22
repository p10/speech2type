import { spawn } from 'child_process';
import EventEmitter from 'events';
import path from 'path';

import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';

class TranscriberService extends EventEmitter {
  constructor(config) {
    super();
    this.micBin = path.join(config.projectRoot, 'bin', 'mic-recorder');
    this.deepgramApiKey = config.data.speech.deepgramApiKey;
    this.language = config.data.speech.language;
    this.dgConn = null;
    this.micProc = null;
    this.isRunning = false;
    this.isConnecting = false;
    this.silenceTimeout = null;

    if (process.env.DEBUG_TRANSCRIBER_STATE) {
      setInterval(() => {
        const dgState = this.dgConn?.connectionState?.() ?? 'null';
        const micState = this.micProc ? (this.micProc.killed ? 'killed' : 'alive') : 'null';
        console.debug('[transcriber] Deepgram connection state:', dgState);
        console.debug('[transcriber] Microphone process state:', micState);
      }, 5000);
    }
  }

  start() {
    if (this.isRunning) return;
    if (!this.deepgramApiKey) {
      throw new Error('[transcriber] Missing Deepgram API key');
    }
    this.isRunning = true;
    this.startConnection();
  }

  startConnection() {
    if (!this.isRunning || this.isConnecting) return;

    this.isConnecting = true;

    this.startMicrophone();
    const dgClient = createClient(this.deepgramApiKey);

    this.dgConn = dgClient.listen.live({
      language: this.language,
      model: 'nova-2',
      encoding: 'linear16',
      sample_rate: 16000,
      channels: 1,
      punctuate: true,
      smart_format: true,
    });

    this.dgConn.on(LiveTranscriptionEvents.Error, (error) => {
      console.error('[transcriber] Deepgram connection error:', error);
      this.stop(error);
    });

    this.dgConn.on(LiveTranscriptionEvents.Open, () => {
      console.debug('[transcriber] Deepgram connection opened');
      this.isConnecting = false;
      this.isRunning = true;
      this.resetSilenceTimeout(30_000);
      this.emit('open');
    });

    this.dgConn.on(LiveTranscriptionEvents.Close, () => {
      console.debug('[transcriber] Deepgram connection closed');
      this.stop();
    });

    this.dgConn.on(LiveTranscriptionEvents.Transcript, (data) => {
      this.handleTranscript(data);
    });
  }

  handleTranscript(data) {
    const transcript = data?.channel?.alternatives?.[0]?.transcript?.trim() || '';
    const isFinal = data?.is_final;

    if (!isFinal || !transcript) return;

    console.debug('[transcriber] transcript:', transcript);
    this.emit('transcript', transcript);

    this.resetSilenceTimeout();
  }

  startMicrophone() {
    if (this.micProc) return;

    this.micProc = spawn(this.micBin, [], {
      stdio: ['ignore', 'pipe', process.env.DEBUG ? 'inherit' : 'ignore'],
      env: { ...process.env },
    });

    this.micProc.stdout.on('data', (chunk) => {
      if (!this.dgConn || !this.isRunning) return;

      try {
        this.dgConn.send(chunk);
      } catch (error) {
        console.error('[transcriber] Error sending audio chunk:', error);
      }
    });

    this.micProc.on('error', (error) => {
      console.error('[transcriber] Microphone process error:', error);
      this.stop(error);
    });

    this.micProc.on('exit', (code) => {
      console.debug('[transcriber] Microphone process exited with code:', code);
      this.stop();
    });
  }

  resetSilenceTimeout(timeoutMs = 20_000) {
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
    }

    this.silenceTimeout = setTimeout(() => {
      console.debug('[transcriber] silence timeout reached');
      this.stop();
    }, timeoutMs);
  }

  clearSilenceTimeout() {
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
      this.silenceTimeout = null;
    }
  }

  stop(error = null) {
    if (!this.isRunning) return;

    if (error) {
      console.error('[transcriber] Stopping transcriber with error:', error);
    } else {
      console.debug('[transcriber] Stopping transcriber');
    }

    this.isRunning = false;
    this.isConnecting = false;
    this.clearSilenceTimeout();

    this.dgConn?.disconnect();
    this.dgConn = null;

    if (this.micProc && !this.micProc.killed) {
      process.kill(this.micProc.pid, 'SIGTERM');
    }
    this.micProc = null;

    if (error) {
      this.emit('error', error);
    } else {
      this.emit('close');
    }
  }
}

export { TranscriberService };
