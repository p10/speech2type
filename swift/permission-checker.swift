import AVFoundation
import Cocoa
import Foundation


func requestMicrophonePermission() {
    let semaphore = DispatchSemaphore(value: 0)
    
    AVCaptureDevice.requestAccess(for: .audio) { granted in
        semaphore.signal()
    }
    
    semaphore.wait()
}

func checkMicrophonePermission() -> Bool {
    let status = AVCaptureDevice.authorizationStatus(for: .audio)
    switch status {
    case .authorized:
        return true
    case .denied, .restricted:
        return false
    case .notDetermined:
        // Trigger permission prompt
        requestMicrophonePermission()
        return AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
    @unknown default:
        return false
    }
}

func checkAccessibilityPermission() -> Bool {
    return AXIsProcessTrusted()
}

func main() {
    var results: [String: Any] = [:]

    results["microphone"] = checkMicrophonePermission()
    results["accessibility"] = checkAccessibilityPermission()

    do {
        let jsonData = try JSONSerialization.data(withJSONObject: results, options: [])
        print(String(data: jsonData, encoding: .utf8) ?? "Failed to serialize results")
        exit(0)
    } catch {
        print("[permission-checker] Failed to serialize results")
        exit(1)
    }
}

main()