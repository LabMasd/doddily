// swipe <fx1> <fy1> <fx2> <fy2>: drag across the Simulator's iPhone screen (fractions of its width/height).
import CoreGraphics
import Foundation
let a = CommandLine.arguments.dropFirst().map { Double($0)! }
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as! [[String: Any]]
guard let w = list.first(where: { ($0[kCGWindowOwnerName as String] as? String) == "Simulator" && !(($0[kCGWindowName as String] as? String) ?? "").isEmpty }) else { print("no simulator window"); exit(1) }
let b = w[kCGWindowBounds as String] as! [String: Double]
// Same insets as tap.swift (iPhone 16 window at default size).
let sx = b["X"]! + 27.5 * b["Width"]! / 447, sy = b["Y"]! + 80 * b["Height"]! / 950
let sw = 392.5 * b["Width"]! / 447, sh = 851 * b["Height"]! / 950
func pt(_ fx: Double, _ fy: Double) -> CGPoint { CGPoint(x: sx + fx * sw, y: sy + fy * sh) }
let from = pt(a[0], a[1]), to = pt(a[2], a[3])
let src = CGEventSource(stateID: .hidSystemState)
CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: from, mouseButton: .left)?.post(tap: .cghidEventTap)
for i in 1...20 {
  let t = Double(i) / 20
  let p = CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t)
  CGEvent(mouseEventSource: src, mouseType: .leftMouseDragged, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
  usleep(15_000)
}
CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: to, mouseButton: .left)?.post(tap: .cghidEventTap)
print("swiped \(from) -> \(to)")
