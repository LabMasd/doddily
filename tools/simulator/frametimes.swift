// frametimes <video>: prints every video frame's presentation time in seconds, one per line.
import AVFoundation
let asset = AVURLAsset(url: URL(fileURLWithPath: CommandLine.arguments[1]))
let sema = DispatchSemaphore(value: 0)
Task {
  let track = try await asset.loadTracks(withMediaType: .video).first!
  let reader = try AVAssetReader(asset: asset)
  let out = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
  out.alwaysCopiesSampleData = false
  reader.add(out)
  reader.startReading()
  while let sample = out.copyNextSampleBuffer() {
    if CMSampleBufferGetNumSamples(sample) > 0 {
      print(String(format: "%.4f", CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample))))
    }
  }
  sema.signal()
}
sema.wait()
