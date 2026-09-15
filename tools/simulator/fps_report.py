# fps_report.py <frametimes.txt> [start end]: frame rate per 0.25 s slice and every gap over 25 ms.
# The simulator only writes a video frame when the screen changes, so a still screen shows as a gap too;
# read the slices alongside stills from the same moments.
import sys

times = sorted(float(l) for l in open(sys.argv[1]) if l.strip())  # decode order is not display order (h264 B-frames)
start = float(sys.argv[2]) if len(sys.argv) > 2 else times[0]
end = float(sys.argv[3]) if len(sys.argv) > 3 else times[-1]
win = [t for t in times if start <= t <= end]
print(f"{len(times)} frames in video, {len(win)} between {start:.2f}s and {end:.2f}s")

SLICE = 0.25
t = start
print("\nslice      fps  bar")
while t < end:
    n = sum(1 for x in win if t <= x < t + SLICE)
    fps = n / SLICE
    print(f"{t:6.2f}s  {fps:5.0f}  {'#' * int(fps / 4)}")
    t += SLICE

gaps = [(win[i - 1], (win[i] - win[i - 1]) * 1000) for i in range(1, len(win))]
slow = [(at, ms) for at, ms in gaps if ms > 25]
if gaps:
    d = sorted(ms for _, ms in gaps)
    print(f"\nmedian frame {d[len(d) // 2]:.1f} ms, p95 {d[int(len(d) * 0.95)]:.1f} ms, worst {d[-1]:.1f} ms")
print(f"frames over 25 ms: {len(slow)}")
for at, ms in slow[:30]:
    print(f"  {ms:6.1f} ms after {at:.3f}s")
