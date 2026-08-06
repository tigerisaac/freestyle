/**
 * macOS Accessibility text helper
 *
 * Reads and drives the focused text element via the Accessibility API, which
 * is what lets Remix see a whole document (not just the selection) and place
 * the selection anywhere in it — in apps whose text fields cooperate with AX.
 * Canvas-rendered editors (Google Docs) expose nothing here; callers detect
 * exit 3 and fall back to keyboard-driven tiers.
 *
 * Usage:
 *   macos-ax read
 *     Prints JSON: {"text": ..., "selStart": n, "selLen": n, "settable": bool}
 *   macos-ax select <start> <len>
 *     Sets the focused element's selected range (UTF-16 offsets).
 *   macos-ax caps
 *     Prints JSON: {"settable": bool, "length": n, "selStart": n, "selLen": n}
 *     — whether the focused element's selection can be placed
 *     programmatically, its character count, and where the selection currently
 *     sits (selStart -1 when the element reports no range). Cheap: never reads
 *     the text itself, which is the point — it answers "is anything selected?"
 *     without the injected Copy that reading the selection would cost.
 *   macos-ax key <keycode>
 *     Posts a bare key press (no modifiers) by virtual keycode — e.g. 124 for
 *     Right Arrow, used to collapse a Select-All without Apple Events. Events
 *     carry the Freestyle synthetic marker so the key listener ignores them.
 *   macos-ax window
 *     Prints JSON: {"text": ..., "truncated": bool, "nodes": n}
 *     — the readable text of the whole focused WINDOW, not just the focused
 *     field. This is what lets Remix answer "reply to this email": the thing
 *     being replied to is never inside the compose box, so every read that
 *     targets the focused element sees an empty draft and nothing else.
 *
 * Exit codes:
 *   0 - success
 *   1 - bad arguments / AX call failed
 *   2 - no Accessibility permission
 *   3 - focused element has no readable text value
 */

import ApplicationServices
import Foundation

func jsonString(_ s: String) -> String {
    var out = "\""
    for ch in s.unicodeScalars {
        switch ch {
        case "\"": out += "\\\""
        case "\\": out += "\\\\"
        case "\n": out += "\\n"
        case "\r": out += "\\r"
        case "\t": out += "\\t"
        default:
            if ch.value < 0x20 {
                out += String(format: "\\u%04x", ch.value)
            } else {
                out.unicodeScalars.append(ch)
            }
        }
    }
    return out + "\""
}

if !AXIsProcessTrusted() {
    exit(2)
}

/// Same marker macos-fast-paste stamps on its events ('FSTY'), so the key
/// listener's synthetic-event filter ignores these too.
let freestyleSyntheticMarker: Int64 = 0x4653_5459

/// The focused UI element, or exit 3 — only the text commands need one.
func focusedElement() -> AXUIElement {
    let systemWide = AXUIElementCreateSystemWide()
    var focusedRef: CFTypeRef?
    let focusedErr = AXUIElementCopyAttributeValue(
        systemWide, kAXFocusedUIElementAttribute as CFString, &focusedRef)
    guard focusedErr == .success, let focusedAny = focusedRef else {
        exit(3)
    }
    // The systemwide focused element is always an AXUIElement.
    return focusedAny as! AXUIElement
}

/// Budgets for the window walk. A mail client's window is tens of thousands
/// of nodes once the browser's tree is built, and the caller pays for every
/// character twice — once over IPC, once in the model's context — so the walk
/// stops early rather than faithfully reproducing a whole inbox.
let maxNodes = 4000
let maxChars = 24000
let maxDepth = 64

/// The window containing an element.
///
/// `kAXWindowAttribute` answers directly for most apps. Web content in a
/// browser often does not carry it, so the parent chain is the fallback.
func enclosingWindow(of element: AXUIElement) -> AXUIElement? {
    for attribute in [kAXWindowAttribute, kAXTopLevelUIElementAttribute] {
        var ref: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, attribute as CFString, &ref) == .success,
            let found = ref
        {
            return (found as! AXUIElement)
        }
    }

    var current = element
    for _ in 0..<maxDepth {
        var roleRef: CFTypeRef?
        if AXUIElementCopyAttributeValue(current, kAXRoleAttribute as CFString, &roleRef)
            == .success, (roleRef as? String) == kAXWindowRole
        {
            return current
        }
        var parentRef: CFTypeRef?
        guard
            AXUIElementCopyAttributeValue(current, kAXParentAttribute as CFString, &parentRef)
                == .success, let parent = parentRef
        else { return nil }
        current = (parent as! AXUIElement)
    }
    return nil
}

/// A string attribute, if it is a non-blank string.
func stringAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
    var ref: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &ref) == .success,
        let value = ref as? String
    else { return nil }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
}

/// What this element contributes to a reading of the window.
///
/// Deliberately narrow. Walking every element and printing every attribute
/// produces a transcript of the interface — button labels, toolbar names,
/// ARIA scaffolding — in which the actual message is a minority of the text.
/// Only roles that carry content a person would read are taken, and each
/// contributes once.
func readableText(of element: AXUIElement) -> String? {
    guard let role = stringAttribute(element, kAXRoleAttribute as String) else { return nil }

    switch role {
    case kAXStaticTextRole, "AXHeading":
        return stringAttribute(element, kAXValueAttribute as String)
            ?? stringAttribute(element, kAXTitleAttribute as String)
            ?? stringAttribute(element, kAXDescriptionAttribute as String)

    case kAXTextAreaRole, kAXTextFieldRole:
        return stringAttribute(element, kAXValueAttribute as String)

    // A link's destination matters when the reply has to refer to it, and the
    // visible text ("RSVP Form for Camp 26-27") rarely contains the URL.
    case "AXLink":
        let label =
            stringAttribute(element, kAXTitleAttribute as String)
            ?? stringAttribute(element, kAXDescriptionAttribute as String)
            ?? stringAttribute(element, kAXValueAttribute as String)
        guard let label else { return nil }
        if let url = stringAttribute(element, kAXURLAttribute as String) {
            return "\(label) <\(url)>"
        }
        return label

    default:
        return nil
    }
}

/// Ask the owning application to build a full accessibility tree.
///
/// Browsers keep their web tree switched off until an assistive technology
/// asks for it, and answer with browser chrome — tab titles, toolbar buttons
/// — until they do. That is why reading a Gmail window used to come back with
/// forty tab names and none of the message: not a bug in the walk, an unbuilt
/// tree. Both keys are set because different Chromium versions honour
/// different ones, and neither is expensive when unsupported.
func warmAccessibilityTree(of element: AXUIElement) {
    var pid: pid_t = 0
    guard AXUIElementGetPid(element, &pid) == .success else { return }
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
}

struct WindowWalk {
    var text: String
    var truncated: Bool
    var nodes: Int
    /// A web area was present and contributed no text — the tree is still
    /// being built, and walking again in a moment will find the page.
    var sawEmptyWebArea: Bool
}

/// Collect the readable text of a window, breadth of interface and all.
func walkWindow(_ window: AXUIElement) -> WindowWalk {
    var collected: [String] = []
    var chars = 0
    var nodes = 0
    var truncated = false
    var sawEmptyWebArea = false

    // Iterative rather than recursive: a mail thread nests deeply enough not
    // to trust the stack with, and an explicit stack makes the budget easy to
    // enforce at every step rather than on the way out.
    var stack: [(element: AXUIElement, depth: Int)] = [(window, 0)]
    while let (element, depth) = stack.popLast() {
        if nodes >= maxNodes || chars >= maxChars {
            truncated = true
            break
        }
        nodes += 1

        if stringAttribute(element, kAXRoleAttribute as String) == "AXWebArea" {
            let before = chars
            let harvest = walkWindow(element)
            if harvest.text.isEmpty && !harvest.truncated {
                sawEmptyWebArea = true
            } else if !harvest.text.isEmpty && collected.last != harvest.text {
                collected.append(harvest.text)
                chars = before + harvest.text.count + 1
            }
            nodes += harvest.nodes
            truncated = truncated || harvest.truncated
            sawEmptyWebArea = sawEmptyWebArea || harvest.sawEmptyWebArea
            continue
        }

        if let text = readableText(of: element), !text.isEmpty {
            // Interfaces repeat themselves — a link's title is often also its
            // description, and toolbars restate button labels. Consecutive
            // duplicates are noise the model would have to read past.
            if collected.last != text {
                collected.append(text)
                chars += text.count + 1
            }
        }

        if depth >= maxDepth { continue }
        var childrenRef: CFTypeRef?
        guard
            AXUIElementCopyAttributeValue(
                element, kAXChildrenAttribute as CFString, &childrenRef) == .success,
            let children = childrenRef as? [AXUIElement]
        else { continue }
        // Reversed, because popLast walks the stack backwards and reading
        // order is the whole value of this text.
        for child in children.reversed() {
            stack.append((child, depth + 1))
        }
    }

    return WindowWalk(
        text: collected.joined(separator: "\n"), truncated: truncated, nodes: nodes,
        sawEmptyWebArea: sawEmptyWebArea)
}

let args = CommandLine.arguments.dropFirst()
let command = args.first ?? "read"

switch command {
case "read":
    let focused = focusedElement()
    var valueRef: CFTypeRef?
    let valueErr = AXUIElementCopyAttributeValue(
        focused, kAXValueAttribute as CFString, &valueRef)
    guard valueErr == .success, let text = valueRef as? String else {
        exit(3)
    }

    var selStart = -1
    var selLen = 0
    var rangeRef: CFTypeRef?
    if AXUIElementCopyAttributeValue(
        focused, kAXSelectedTextRangeAttribute as CFString, &rangeRef) == .success,
        let rangeAny = rangeRef, CFGetTypeID(rangeAny) == AXValueGetTypeID()
    {
        var range = CFRange(location: 0, length: 0)
        if AXValueGetValue(rangeAny as! AXValue, .cfRange, &range) {
            selStart = range.location
            selLen = range.length
        }
    }

    var settable = DarwinBoolean(false)
    _ = AXUIElementIsAttributeSettable(
        focused, kAXSelectedTextRangeAttribute as CFString, &settable)

    print(
        "{\"text\": \(jsonString(text)), \"selStart\": \(selStart), \"selLen\": \(selLen), \"settable\": \(settable.boolValue)}"
    )

case "caps":
    let focused = focusedElement()
    var settable = DarwinBoolean(false)
    _ = AXUIElementIsAttributeSettable(
        focused, kAXSelectedTextRangeAttribute as CFString, &settable)
    var length = -1
    var countRef: CFTypeRef?
    if AXUIElementCopyAttributeValue(
        focused, kAXNumberOfCharactersAttribute as CFString, &countRef) == .success,
        let count = countRef as? Int
    {
        length = count
    }

    var selStart = -1
    var selLen = 0
    var rangeRef: CFTypeRef?
    if AXUIElementCopyAttributeValue(
        focused, kAXSelectedTextRangeAttribute as CFString, &rangeRef) == .success,
        let rangeAny = rangeRef, CFGetTypeID(rangeAny) == AXValueGetTypeID()
    {
        var range = CFRange(location: 0, length: 0)
        if AXValueGetValue(rangeAny as! AXValue, .cfRange, &range) {
            selStart = range.location
            selLen = range.length
        }
    }

    print(
        "{\"settable\": \(settable.boolValue), \"length\": \(length), \"selStart\": \(selStart), \"selLen\": \(selLen)}"
    )

case "select":
    let focused = focusedElement()
    let rest = Array(args.dropFirst())
    guard rest.count == 2, let start = Int(rest[0]), let len = Int(rest[1]),
        start >= 0, len >= 0
    else {
        FileHandle.standardError.write("usage: macos-ax select <start> <len>\n".data(using: .utf8)!)
        exit(1)
    }
    var range = CFRange(location: start, length: len)
    guard let axRange = AXValueCreate(.cfRange, &range) else {
        exit(1)
    }
    let err = AXUIElementSetAttributeValue(
        focused, kAXSelectedTextRangeAttribute as CFString, axRange)
    if err != .success {
        exit(3)
    }

case "key":
    let rest = Array(args.dropFirst())
    guard rest.count == 1, let code = Int(rest[0]), code >= 0, code < 0x80 else {
        FileHandle.standardError.write("usage: macos-ax key <keycode>\n".data(using: .utf8)!)
        exit(1)
    }
    guard
        let keyDown = CGEvent(
            keyboardEventSource: nil, virtualKey: CGKeyCode(code), keyDown: true),
        let keyUp = CGEvent(
            keyboardEventSource: nil, virtualKey: CGKeyCode(code), keyDown: false)
    else {
        exit(1)
    }
    keyDown.setIntegerValueField(.eventSourceUserData, value: freestyleSyntheticMarker)
    keyUp.setIntegerValueField(.eventSourceUserData, value: freestyleSyntheticMarker)
    keyDown.post(tap: .cghidEventTap)
    usleep(8_000)
    keyUp.post(tap: .cghidEventTap)

case "warm":
    // Fire-and-forget from the hotkey path. The expensive part of reading a
    // browser window is not the walk, it is waiting for the browser to build
    // its tree the first time anything asks; doing that here overlaps it with
    // the user still saying what they want.
    warmAccessibilityTree(of: focusedElement())

case "window":
    let focused = focusedElement()
    warmAccessibilityTree(of: focused)
    guard let window = enclosingWindow(of: focused) else { exit(3) }

    var walk = walkWindow(window)
    // A web area with no text inside it is not an empty page — it is a tree
    // that has not been built yet. That is the only reliable cold signal:
    // measuring the text alone cannot tell "still building" from "a browser
    // window whose forty tab titles are all it has", and in a cold Gmail the
    // tab titles alone run to three thousand characters.
    if walk.sawEmptyWebArea {
        usleep(700_000)
        walk = walkWindow(window)
    }

    print(
        "{\"text\": \(jsonString(walk.text)), \"truncated\": \(walk.truncated), \"nodes\": \(walk.nodes)}"
    )

default:
    FileHandle.standardError.write("unknown command \"\(command)\"\n".data(using: .utf8)!)
    exit(1)
}
