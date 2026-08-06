import AVFoundation
import Foundation
import MediaPlayer

/// Playback for a sleep timer.
///
/// Deliberately small: play a URL, set a volume, keep playing while the screen
/// is off, and publish Now Playing information. No queue, no gapless, no
/// crossfade, no casting — the surface a general-purpose audio library carries
/// and that we would then depend on someone else to maintain.
///
/// The fade curve's source of truth is the shared TypeScript (`fadeVolume` in
/// vendor/player). This file carries a verbatim port of it (`fadeVolume` below)
/// because the native timer must fade with the screen locked, when the JS that
/// used to drive it is suspended. The Kotlin side ports the same curve, pinned
/// by FadeCurveTest; the Swift port is verified against the same sample points.
@objc(NightAudioImpl)
public class NightAudioImpl: NSObject {

  private var player: AVPlayer?
  private var endObserver: NSObjectProtocol?

  // Sleep-timer state. The timer lives on the main queue; with the .playback
  // session active and UIBackgroundModes: audio set, the app stays running
  // while the screen is locked, so the timer keeps firing.
  private var timer: DispatchSourceTimer?
  private var endAt: DispatchTime = .now()
  private var fadeSecs: Double = 0
  private var fadeTrim: Double = 1
  private var startedAt: DispatchTime = .now()
  private var timerEpisodeId = ""
  // Best-known id of the loaded episode, echoed back in onTrackEnded. JS ignores
  // it (it advances from its own nowRef); kept only for symmetry/debugging.
  private var currentEpisodeId = ""

  /// Set by NightAudio.mm; fired once when the timer reaches zero, after
  /// playback has been stopped. Arguments: (episodeId, heardSeconds).
  @objc public var onNightEnded: ((String, Int) -> Void)?

  /// Set by NightAudio.mm; fired when the current item plays to its end on its
  /// own (not a timer stop). Drives the all-night auto-advance.
  @objc public var onTrackEnded: ((String) -> Void)?

  @objc public static let shared = NightAudioImpl()

  /// Swift port of the shared fade curve (`fadeVolume` in
  /// vendor/player/src/lib/engine.ts). Must match it EXACTLY:
  ///   remaining >= fade -> 1, remaining <= 0 -> 0, else remaining / fade.
  /// FadeCurveTests asserts parity against the same sample points as the
  /// shared TypeScript tests.
  @objc public func fadeVolume(_ remainingSeconds: Double, _ fadeSeconds: Double) -> Double {
    if remainingSeconds >= fadeSeconds { return 1 }
    if remainingSeconds <= 0 { return 0 }
    return remainingSeconds / fadeSeconds
  }

  /// Swift port of `effectiveVolume` in vendor/player/src/lib/engine.ts. Must
  /// match it EXACTLY: `min(1, max(0, fadeVolume(remaining, fade) * trim))`.
  /// The per-feed trim scales the whole fade curve; the clamp keeps a bad trim
  /// (negative, or > 1) from ever reaching AVPlayer.
  @objc public func effectiveVolume(_ remainingSeconds: Double, _ fadeSeconds: Double,
                                    _ trim: Double) -> Double {
    let v = fadeVolume(remainingSeconds, fadeSeconds) * trim
    return min(1, max(0, v))
  }

  /// Must be called before playback, and it is the single most important line
  /// in the iOS half of this app. `.playback` is what lets audio continue when
  /// the screen locks and what ignores the ringer switch. Without it — or
  /// without `UIBackgroundModes: audio` in Info.plist — iOS suspends the app on
  /// lock and the night silently stops, which is the whole product failing.
  private func activateSession() {
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(.playback, mode: .default, options: [])
      try session.setActive(true)
    } catch {
      // Nothing useful to do here: playback will simply be quieter about
      // failing than the app would be about crashing.
      NSLog("NightAudio: audio session activation failed: \(error)")
    }
  }

  @objc public func play(_ url: String, startAt: Double, resolve: @escaping (Any?) -> Void,
                         reject: @escaping (String, String) -> Void) {
    guard let parsed = URL(string: url) else {
      reject("bad_url", "not a URL: \(url)")
      return
    }
    activateSession()

    let item = AVPlayerItem(url: parsed)
    let created = AVPlayer(playerItem: item)
    created.automaticallyWaitsToMinimizeStalling = true
    player = created

    // Natural end-of-track → onTrackEnded (all-night auto-advance). Drop any
    // prior observer first so a reused impl doesn't fire for a stale item. A
    // timer fade calls stop() (pause, not play-to-end), so this won't fire then.
    if let prev = endObserver { NotificationCenter.default.removeObserver(prev) }
    endObserver = NotificationCenter.default.addObserver(
      forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
    ) { [weak self] _ in
      guard let self = self else { return }
      self.onTrackEnded?(self.currentEpisodeId)
    }

    if startAt > 0 {
      created.seek(to: CMTime(seconds: startAt, preferredTimescale: 600))
    }
    created.play()

    // Resolves once playback has been *requested*, not once it is audible.
    // Waiting for real output would hang forever on a dead enclosure; whether
    // sound is actually happening is what isPlaying() is for.
    resolve(nil)
  }

  @objc public func pause() { player?.pause() }

  @objc public func resume() {
    activateSession()
    player?.play()
  }

  /// Start (or restart) the authoritative sleep timer. Fades the player's
  /// volume over the final `fadeSeconds`, then stops playback and fires
  /// `onNightEnded` with how long the night actually ran.
  @objc public func scheduleFadeAndStop(_ episodeId: String, durationSeconds: Double,
                                        fadeSeconds: Double, trim: Double) {
    cancelTimer()
    timerEpisodeId = episodeId
    currentEpisodeId = episodeId
    fadeSecs = fadeSeconds
    fadeTrim = trim
    startedAt = .now()
    endAt = .now() + durationSeconds
    // Apply the trim immediately: the first timer tick is up to 0.5s away, and
    // the ceiling should hold from the first audible moment, not after it.
    player?.volume = Float(min(1, max(0, trim)))
    let t = DispatchSource.makeTimerSource(queue: .main)
    t.schedule(deadline: .now(), repeating: 0.5)
    t.setEventHandler { [weak self] in
      guard let self = self else { return }
      let remaining = (self.endAt.uptimeNanoseconds > DispatchTime.now().uptimeNanoseconds)
        ? Double(self.endAt.uptimeNanoseconds - DispatchTime.now().uptimeNanoseconds) / 1_000_000_000
        : 0
      if remaining <= 0 {
        self.player?.volume = 0
        self.stop()
        // Rounded, not truncated, to match Android's Math.round — ±1s at the
        // HEARD_SEC boundary otherwise.
        let heard = Int((Double(DispatchTime.now().uptimeNanoseconds - self.startedAt.uptimeNanoseconds) / 1_000_000_000).rounded())
        self.onNightEnded?(self.timerEpisodeId, heard)
        return // self.stop() above already cancelled this timer
      }
      self.player?.volume = Float(self.effectiveVolume(remaining, self.fadeSecs, self.fadeTrim))
    }
    timer = t
    t.resume()
  }

  @objc public func cancelTimer() {
    timer?.cancel()
    timer = nil
  }

  @objc public func stop() {
    cancelTimer()
    if let prev = endObserver { NotificationCenter.default.removeObserver(prev); endObserver = nil }
    player?.pause()
    player = nil
    MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    // Deactivating tells the OS we are done, so other audio can resume without
    // waiting for the app to be killed.
    try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
  }

  @objc public func setVolume(_ volume: Double) {
    // Clamped here as well as in JS: a NaN out of a fade divide would otherwise
    // reach AVPlayer, and NaN volume is silence with no error.
    let v = Float(volume)
    player?.volume = v.isNaN ? 0 : min(1, max(0, v))
  }

  @objc public func getPosition() -> Double {
    guard let p = player else { return -1 }
    let t = p.currentTime().seconds
    return t.isFinite ? t : -1
  }

  @objc public func getDuration() -> Double {
    guard let d = player?.currentItem?.duration.seconds, d.isFinite, d > 0 else {
      // A stream reports an indefinite duration until it knows. -1 says "not
      // yet" rather than inventing a length.
      return -1
    }
    return d
  }

  @objc public func isPlaying() -> Bool {
    guard let p = player else { return false }
    return p.timeControlStatus == .playing
  }

  @objc public func setNowPlaying(_ title: String, artist: String, artworkUrl: String,
                                  duration: Double) {
    var info: [String: Any] = [
      MPMediaItemPropertyTitle: title,
      MPMediaItemPropertyArtist: artist,
    ]
    if duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
    info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = getPosition()
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
  }
}
