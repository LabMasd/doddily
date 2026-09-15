// tap <fx> <fy>: tap the Simulator's iPhone screen at a fraction of its width/height.
import CoreGraphics
import Foundation
let a = CommandLine.arguments
let fx = Double(a[1])!, fy = Double(a[2])!
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as! [[String: Any]]
// Uses the frontmost Simulator window. Insets below were measured for an iPhone 16 window at default size.
guard let w = list.first(where: { ($0[kCGWindowOwnerName as String] as? String) == "Simulator" && !(($0[kCGWindowName as String] as? String) ?? "").isEmpty }) else { print("no simulator window"); exit(1) }
let b = w[kCGWindowBounds as String] as! [String: Double]
// Screen inside the window (measured from a window capture): left 27.5pt, top 80pt, 392.5 x 851pt for a 447 x 950 window.
let sx = b["X"]! + 27.5 * b["Width"]! / 447, sy = b["Y"]! + 80 * b["Height"]! / 950
let sw = 392.5 * b["Width"]! / 447, sh = 851 * b["Height"]! / 950
let p = CGPoint(x: sx + fx * sw, y: sy + fy * sh)
let src = CGEventSource(stateID: .hidSystemState)
for t in [CGEventType.mouseMoved, .leftMouseDown, .leftMouseUp] {
  CGEvent(mouseEventSource: src, mouseType: t, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
  usleep(90_000)
}
print("tapped \(fx),\(fy) at \(p)")
