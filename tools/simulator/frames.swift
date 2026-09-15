// frames <video> <outdir> <seconds...>: saves a PNG of the video at each time (exact frames, no tolerance).
import AVFoundation
import AppKit
let a = CommandLine.arguments
let asset = AVURLAsset(url: URL(fileURLWithPath: a[1]))
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = .zero
gen.requestedTimeToleranceAfter = .zero
gen.maximumSize = CGSize(width: 460, height: 1000)
print("duration: \(String(format: "%.2f", CMTimeGetSeconds(asset.duration)))s")
for s in a.dropFirst(3) {
  let t = CMTime(seconds: Double(s)!, preferredTimescale: 600)
  guard let img = try? gen.copyCGImage(at: t, actualTime: nil) else { print("no frame at \(s)s"); continue }
  let rep = NSBitmapImageRep(cgImage: img)
  let path = "\(a[2])/f-\(s)s.png"
  try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))
  print("saved \(path)")
}
