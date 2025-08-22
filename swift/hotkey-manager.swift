import Cocoa
import Foundation
import Carbon.HIToolbox

// ---- Modifier handling ----
let matchableModifierMask: CGEventFlags = [.maskCommand, .maskShift, .maskAlternate, .maskControl]
@inline(__always) func normalizedFlags(_ flags: CGEventFlags) -> CGEventFlags {
    flags.intersection(matchableModifierMask)
}

var targetKeyCode: CGKeyCode = 40 // default: K on many layouts, but it's just a number
var requiredFlags: CGEventFlags = [.maskCommand, .maskShift]
var isCapturing = false

// ---- Keyboard layout helpers ----

private func currentKeyboardLayout() -> UnsafePointer<UCKeyboardLayout>? {
    guard
        let src = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue(),
        let dataPtr = TISGetInputSourceProperty(src, kTISPropertyUnicodeKeyLayoutData)
    else { return nil }

    let data = unsafeBitCast(dataPtr, to: CFData.self) as Data
    return data.withUnsafeBytes { (rbp: UnsafeRawBufferPointer) -> UnsafePointer<UCKeyboardLayout>? in
        rbp.baseAddress?.assumingMemoryBound(to: UCKeyboardLayout.self)
    }
}

/// keycode -> visible string (respect Shift/Option only; useful for display/human output)
private func keycodeToString(_ keyCode: CGKeyCode, flags: CGEventFlags) -> String? {
    guard let layout = currentKeyboardLayout() else { return nil }

    var deadKeyState: UInt32 = 0
    var chars = [UniChar](repeating: 0, count: 8)
    var length: Int = 0

    // Carbon shift state from flags
    var shiftState: UInt32 = 0
    if flags.contains(.maskShift)     { shiftState |= UInt32(shiftKeyBit) }
    if flags.contains(.maskAlternate) { shiftState |= UInt32(optionKeyBit) }

    let status = UCKeyTranslate(
        layout,
        keyCode,
        UInt16(kUCKeyActionDown),
        shiftState,
        UInt32(LMGetKbdType()),
        OptionBits(kUCKeyTranslateNoDeadKeysBit),
        &deadKeyState,
        chars.count,
        &length,
        &chars
    )

    if status == noErr, length > 0 {
        return String(utf16CodeUnits: chars, count: length)
    }
    return nil
}

/// character -> keycode by scanning all plausible keycodes
/// We try unshifted first, then Shift, then Option (rarely desired, but can help on some layouts).
private func characterToKeycode(_ ch: Character) -> (CGKeyCode, CGEventFlags)? {
    guard currentKeyboardLayout() != nil else { return nil }

    // All keycodes 0...127 is sufficient for Apple keyboards; scanning is cheap.
    let range: ClosedRange<CGKeyCode> = 0...127
    let target = String(ch)

    func matches(_ kc: CGKeyCode, flags: CGEventFlags) -> Bool {
        return keycodeToString(kc, flags: flags) == target
    }

    // Try no modifiers
    for kc in range where matches(kc, flags: []) { return (kc, []) }
    // Try Shift
    for kc in range where matches(kc, flags: [.maskShift]) { return (kc, [.maskShift]) }
    // Try Option (last resort; you may choose to drop this if you don't want Alt-generated glyphs)
    for kc in range where matches(kc, flags: [.maskAlternate]) { return (kc, [.maskAlternate]) }

    return nil
}

// Pretty name for display; always fallback to raw numeric
private func prettyKeyName(for keycode: CGKeyCode, flags: CGEventFlags) -> String {
    if let s = keycodeToString(keycode, flags: flags), !s.isEmpty { return s }
    return "kc\(keycode)"
}

// ---- Parsing CLI ----

/// Parse modifiers like "cmd+shift" (empty string allowed)
private func parseModifiers(_ s: String) -> CGEventFlags? {
    var flags: CGEventFlags = []
    let trimmed = s.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return flags }
    for tok in trimmed.lowercased().split(separator: "+") {
        switch tok.trimmingCharacters(in: .whitespaces) {
        case "cmd", "command": flags.insert(.maskCommand)
        case "shift": flags.insert(.maskShift)
        case "alt", "option": flags.insert(.maskAlternate)
        case "ctrl", "control": flags.insert(.maskControl)
        case "": continue
        default: return nil
        }
    }
    return flags
}

/// Accept either a single grapheme (e.g., "k", ";") or a numeric keycode (e.g., "53")
private func parseKeyToken(_ token: String) -> (CGKeyCode, CGEventFlags)? {
    let t = token.trimmingCharacters(in: .whitespacesAndNewlines)

    // Numeric?
    if let n = UInt32(t), n <= UInt32(UInt16.max) {
        return (CGKeyCode(n), [])
    }

    // Single character?
    if t.count == 1, let ch = t.first {
        if let (kc, impliedFlags) = characterToKeycode(ch) {
            return (kc, impliedFlags)
        }
    }

    // Not resolvable
    return nil
}

func parseHotkey(_ modifiers: String, _ key: String) -> Bool {
    guard let mods = parseModifiers(modifiers) else { return false }
    // Resolve key
    guard let (kc, implied) = parseKeyToken(key) else { return false }

    // If resolving a character required Shift/Option, merge those into requiredFlags
    requiredFlags = mods.union(implied)
    targetKeyCode = kc
    return true
}

// ---- Event tap ----

func eventCallback(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    if type == .keyDown {
        let keycode = CGKeyCode(event.getIntegerValueField(.keyboardEventKeycode))
        let flags = normalizedFlags(event.flags)

        if isCapturing {
            var mods: [String] = []
            if flags.contains(.maskCommand)   { mods.append("cmd") }
            if flags.contains(.maskShift)     { mods.append("shift") }
            if flags.contains(.maskAlternate) { mods.append("alt") }
            if flags.contains(.maskControl)   { mods.append("ctrl") }

            let display = prettyKeyName(for: keycode, flags: flags)

            let payload: [String: Any] = [
                "modifiers": mods,
                "key": display,      // layout-aware string if any (e.g., ";", "k", "€")
                "keycode": keycode   // numeric, layout-agnostic
            ]

            if let jsonData = try? JSONSerialization.data(withJSONObject: payload),
               let jsonString = String(data: jsonData, encoding: .utf8) {
                print(jsonString)
                fflush(stdout)
            }
            exit(0)
        } else {
            if keycode == targetKeyCode && flags.contains(requiredFlags) {
                print("TRIGGERED")
                fflush(stdout)
            }
        }
    }
    return Unmanaged.passUnretained(event)
}

// ---- Main ----

func main() {
    let args = CommandLine.arguments
    if args.count == 1 {
        fputs("[hotkey-manager] Listening for CMD+; ...\n", stderr)
    } else if args.count == 2 && args[1] == "--capture" {
        isCapturing = true
        fputs("[hotkey-manager] Press any key combination to capture...\n", stderr)
    } else if args.count == 3 {
        let mods = args[1]
        let key  = args[2]
        guard parseHotkey(mods, key) else {
            fputs("[hotkey-manager] Invalid hotkey. Examples:\n", stderr)
            fputs("[hotkey-manager]   hotkey-manager cmd+shift k\n", stderr)
            fputs("[hotkey-manager]   hotkey-manager alt 53\n", stderr)
            exit(1)
        }
        fputs("[hotkey-manager] Listening for \(mods.uppercased()) + \(key.uppercased())...\n", stderr)
    } else {
        fputs("[hotkey-manager] Usage:\n", stderr)
        fputs("[hotkey-manager]   hotkey-manager                    - Listen for CMD+SHIFT+K (default)\n", stderr)
        fputs("[hotkey-manager]   hotkey-manager --capture          - Capture key combination\n", stderr)
        fputs("[hotkey-manager]   hotkey-manager <mods> <key>       - Mods: cmd|shift|alt|ctrl (e.g., cmd+shift)\n", stderr)
        fputs("[hotkey-manager]                                     - Key : single character (e.g., ;) or numeric keycode (e.g., 53)\n", stderr)
        exit(1)
    }

    guard let eventTap = CGEvent.tapCreate(
        tap: .cgSessionEventTap,
        place: .headInsertEventTap,
        options: .defaultTap,
        eventsOfInterest: CGEventMask(1 << CGEventType.keyDown.rawValue),
        callback: eventCallback,
        userInfo: nil
    ) else {
        fputs("[hotkey-manager] Failed to create event tap. Grant Accessibility permissions.\n", stderr)
        exit(1)
    }

    let src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
    CFRunLoopAddSource(CFRunLoopGetCurrent(), src, .commonModes)
    CGEvent.tapEnable(tap: eventTap, enable: true)

    signal(SIGINT, SIG_IGN)
    signal(SIGTERM, SIG_IGN)

    let sigQueue = DispatchQueue(label: "hotkey.signals")
    let sigInt  = DispatchSource.makeSignalSource(signal: SIGINT,  queue: sigQueue)
    let sigTerm = DispatchSource.makeSignalSource(signal: SIGTERM, queue: sigQueue)

    // Keep handlers async-signal-safe: no print/exit(); use _exit()
    sigInt.setEventHandler  { _exit(0) }
    sigTerm.setEventHandler { _exit(0) }

    sigInt.resume()
    sigTerm.resume()

    CFRunLoopRun()
}

main()
