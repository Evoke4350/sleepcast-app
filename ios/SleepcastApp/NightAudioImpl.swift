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
/// There is no fade in this file on purpose. The fade curve lives in the shared
/// TypeScript (`fadeVolume`), so both platforms fade identically and the curve
/// stays under test. This class only obeys `setVolume`.
@objc(NightAudioImpl)
public class NightAudioImpl: NSObject {

  private var player: AVPlayer?
  private var endObserver: NSObjectProtocol?

  @objc public static let shared = NightAudioImpl()

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

  @objc public func stop() {
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
