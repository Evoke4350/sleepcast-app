package com.sleepcastapp

import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

/**
 * Keeps playback alive once the screen goes off.
 *
 * This is the whole point of the app and it does not work without a service.
 * Android suspends a backgrounded process; a foreground service with type
 * `mediaPlayback` and a live MediaSession is the only sanctioned way to keep an
 * audio app running, and since Android 14 the session is not optional — the
 * type requires one.
 *
 * The service owns the ExoPlayer rather than the TurboModule, because the
 * player has to outlive any particular React context. A JS reload must not
 * silence a night in progress.
 */
class NightAudioService : MediaSessionService() {

  private var session: MediaSession? = null

  override fun onCreate() {
    super.onCreate()
    val player = ExoPlayer.Builder(this)
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(C.USAGE_MEDIA)
          .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
          .build(),
        // Handle audio focus: a phone call or an alarm should duck or pause us
        // rather than talk over someone who is trying to sleep.
        true,
      )
      // The screen is off and the phone is on a mattress. Keeping the CPU awake
      // is the difference between continuous audio and a stutter every time the
      // device tries to doze.
      .setWakeMode(C.WAKE_MODE_NETWORK)
      .build()

    session = MediaSession.Builder(this, player).build()
    instance = this
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

  /** The player, for the TurboModule to drive. Null before onCreate. */
  val player: ExoPlayer?
    get() = session?.player as? ExoPlayer

  override fun onTaskRemoved(rootIntent: android.content.Intent?) {
    // Swiping the app away should end the night rather than leave audio playing
    // with no way back to it.
    session?.player?.pause()
    stopSelf()
  }

  override fun onDestroy() {
    session?.run {
      player.release()
      release()
    }
    session = null
    if (instance === this) instance = null
    super.onDestroy()
  }

  companion object {
    /** Set in onCreate, cleared in onDestroy. The module waits for this rather
     *  than binding, because it only ever needs the player. */
    @Volatile
    var instance: NightAudioService? = null
      private set
  }
}
