package com.sleepcastapp

import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import android.content.ComponentName
import android.util.Log
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.MoreExecutors
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.sleepcastapp.specs.NativeNightAudioSpec

/**
 * Playback for a sleep timer.
 *
 * ExoPlayer rather than MediaPlayer because it handles the streaming cases a
 * podcast feed will throw at it — redirects, chunked transfer, odd MIME types
 * — without special casing.
 *
 * Everything here runs on the main thread: ExoPlayer requires it, and the JS
 * side calls setVolume about once a second, which is nothing.
 *
 * There is no fade in this file on purpose. The fade curve lives in the shared
 * TypeScript so both platforms behave identically and it stays under test.
 *
 * The player itself lives in NightAudioService, a foreground MediaSessionService,
 * because that is the only way Android lets audio survive the screen going off —
 * and because the player must outlive any particular React context, so a JS
 * reload does not silence a night in progress. This module is a remote control.
 */
class NightAudioModule(reactContext: ReactApplicationContext) :
  NativeNightAudioSpec(reactContext) {

  init {
    Log.d("NightAudioMod", "constructed")
  }

  override fun getName(): String {
    Log.d("NightAudioMod", "getName() called")
    return NAME
  }

  private var controller: MediaController? = null

  private val player: Player?
    get() = controller

  /** Run [block] against a connected MediaController, connecting on first use.
   *
   *  Connecting is what starts the service, and it is deliberately NOT
   *  startForegroundService. That call arms an OS timer of about five seconds
   *  within which the service must call startForeground itself; media3 promotes
   *  on its own schedule, when playback begins and it has a notification to
   *  post, so the timer expired and Android killed the process with
   *  ForegroundServiceDidNotStartInTimeException. Letting the library own the
   *  lifecycle is the whole fix. */
  private fun withPlayer(block: (Player) -> Unit) {
    val existing = controller
    if (existing != null) {
      block(existing)
      return
    }
    val ctx = reactApplicationContext
    val token = SessionToken(ctx, ComponentName(ctx, NightAudioService::class.java))
    val future = MediaController.Builder(ctx, token).buildAsync()
    future.addListener({
      try {
        val c = future.get()
        controller = c
        block(c)
      } catch (e: Throwable) {
        Log.w("NightAudioMod", "controller connect failed", e)
      }
    }, MoreExecutors.directExecutor())
  }

  override fun play(url: String, startAtSeconds: Double, promise: Promise) {
    runOnMain {
      try {
        withPlayer { p ->
          p.setMediaItem(MediaItem.fromUri(url))
          p.prepare()
          if (startAtSeconds > 0) p.seekTo((startAtSeconds * 1000).toLong())
          p.playWhenReady = true
        }
        // Resolves once playback has been *requested*. Whether audio is
        // actually audible is a question for isPlaying(), not for this promise:
        // resolving on first frame would hang forever on a dead URL.
        promise.resolve(null)
      } catch (e: Throwable) {
        promise.reject("play_failed", e)
      }
    }
  }

  override fun pause() = runOnMain { player?.playWhenReady = false }

  override fun resume() = runOnMain { player?.playWhenReady = true }

  override fun stop() = runOnMain {
    // Releasing the last controller lets media3 stop the service, which drops
    // the notification. Leaving it up after a night ends would be a lie in the
    // shade.
    player?.stop()
    controller?.release()
    controller = null
  }

  override fun setVolume(volume: Double) = runOnMain {
    // Clamped here as well as in JS: a NaN from a fade divide would otherwise
    // reach ExoPlayer and throw on the main thread.
    val v = volume.toFloat()
    player?.volume = if (v.isNaN()) 0f else v.coerceIn(0f, 1f)
  }

  override fun getPosition(promise: Promise) = runOnMain {
    val p = player
    promise.resolve(if (p == null) -1.0 else p.currentPosition / 1000.0)
  }

  override fun getDuration(promise: Promise) = runOnMain {
    val p = player
    val d = p?.duration ?: -1L
    // A stream reports TIME_UNSET until it knows; -1 says "not yet" rather
    // than pretending a length.
    promise.resolve(if (p == null || d <= 0) -1.0 else d / 1000.0)
  }

  override fun isPlaying(promise: Promise) = runOnMain {
    promise.resolve(player?.isPlaying ?: false)
  }

  override fun setNowPlaying(
    title: String,
    artist: String,
    artworkUrl: String,
    durationSeconds: Double
  ) = runOnMain {
    val metadata = MediaMetadata.Builder()
      .setTitle(title)
      .setArtist(artist)
      .build()
    player?.let { p ->
      p.setMediaItem(
        p.currentMediaItem?.buildUpon()?.setMediaMetadata(metadata)?.build()
          ?: return@let
      )
    }
  }

  private fun runOnMain(block: () -> Unit) {
    if (reactApplicationContext.hasActiveReactInstance()) {
      reactApplicationContext.runOnUiQueueThread(block)
    } else {
      block()
    }
  }

  override fun invalidate() {
    // Deliberately does NOT stop the service. A React context teardown (a JS
    // reload, a dev refresh) must not end a night that is playing.
    super.invalidate()
  }

  companion object {
    const val NAME = "NightAudio"
  }
}
