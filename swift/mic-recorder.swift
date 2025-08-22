import AVFoundation
import AVFAudio
import Foundation

final class MicStreamer: NSObject {
    private let engine = AVAudioEngine()
    private let targetFormat: AVAudioFormat
    private let bus: AVAudioNodeBus = 0
    private var isRunning = false

    override init() {
        self.targetFormat = AVAudioFormat(commonFormat: .pcmFormatInt16,
                                          sampleRate: 16000,
                                          channels: 1,
                                          interleaved: true)!
        super.init()
    }

    func start() throws {
        guard !isRunning else { return }

        let input = engine.inputNode
        let inputFormat = input.inputFormat(forBus: bus)

        fputs("[mic-recorder] Input format: \(inputFormat.sampleRate) Hz, \(inputFormat.channelCount) ch\n", stderr)
        fputs("[mic-recorder] Target format: \(targetFormat.sampleRate) Hz, \(targetFormat.channelCount) ch\n", stderr)

        guard let converter = AVAudioConverter(from: inputFormat, to: targetFormat) else {
            throw NSError(domain: "Mic", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to create AVAudioConverter"])
        }

        let bufferSize: AVAudioFrameCount = 1024

        input.installTap(onBus: bus, bufferSize: bufferSize, format: inputFormat) { [weak self] buffer, _ in
            guard let self = self, self.isRunning else { return }

            let ratio = self.targetFormat.sampleRate / inputFormat.sampleRate
            let outCap = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 10

            guard let outBuf = AVAudioPCMBuffer(pcmFormat: self.targetFormat, frameCapacity: outCap) else {
                fputs("[mic-recorder] Failed to create output buffer\n", stderr)
                return
            }

            var err: NSError?
            let status = converter.convert(to: outBuf, error: &err) { _, outStatus in
                outStatus.pointee = .haveData
                return buffer
            }

            if let err = err {
                fputs("[mic-recorder] Conversion error: \(err.localizedDescription)\n", stderr)
                return
            }

            guard status != .error,
                  let ch0 = outBuf.int16ChannelData,
                  outBuf.frameLength > 0 else {
                fputs("[mic-recorder] Conversion failed or empty buffer\n", stderr)
                return
            }

            let frames = Int(outBuf.frameLength)
            let bytes = frames * MemoryLayout<Int16>.size
            let audioData = Data(bytes: ch0[0], count: bytes)

            // Write may throw SIGPIPE when stdout closes; ignore SIGPIPE globally.
            FileHandle.standardOutput.write(audioData)
        }

        isRunning = true
        try engine.start()
        fputs("[mic-recorder] Audio engine started successfully\n", stderr)
    }

    func stop() {
        guard isRunning else { return }
        isRunning = false
        engine.stop()
        engine.inputNode.removeTap(onBus: bus)
        fputs("[mic-recorder] Audio engine stopped\n", stderr)
    }
}

// MARK: - Bootstrap

let streamer = MicStreamer()

// Ignore SIGPIPE so writes to a closed pipe don't terminate the process.
signal(SIGPIPE, SIG_IGN)

// Use a dedicated queue for signal delivery (avoid main queue starvation).
let signalQueue = DispatchQueue(label: "mic-recorder.signal")

let sigintSource  = DispatchSource.makeSignalSource(signal: SIGINT,  queue: signalQueue)
let sigtermSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: signalQueue)

// Prevent default handlers so DispatchSource receives signals.
signal(SIGINT, SIG_IGN)
signal(SIGTERM, SIG_IGN)

sigintSource.setEventHandler {
    fputs("[mic-recorder] Received SIGINT, stopping...\n", stderr)
    streamer.stop()
    _exit(0) // async-signal-safe
}

sigtermSource.setEventHandler {
    fputs("[mic-recorder] Received SIGTERM, stopping...\n", stderr)
    streamer.stop()
    _exit(0)
}

sigintSource.resume()
sigtermSource.resume()

// Optional safety net
atexit {
    streamer.stop()
}

AVCaptureDevice.requestAccess(for: .audio) { granted in
    if granted {
        fputs("[mic-recorder] Microphone access granted\n", stderr)
        do {
            try streamer.start()
            fputs("[mic-recorder] Microphone streaming started.\n", stderr)
        } catch {
            fputs("[mic-recorder] Mic start error: \(error)\n", stderr)
            _exit(1)
        }
    } else {
        fputs("[mic-recorder] Microphone permission denied\n", stderr)
        _exit(1)
    }
}

// Drive the process with GCD, not nested CFRunLoops.
dispatchMain()
