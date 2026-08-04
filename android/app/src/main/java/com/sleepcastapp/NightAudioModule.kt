package com.sleepcastapp

import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import android.content.ComponentName
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.MoreExecutors
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.sleepcastapp.specs.NativeNightAudioSpec

/**
 * Kotlin port of the shared TypeScript fade curve. Must match EXACTLY:
 * remaining >= fade → 1.0, remaining <= 0 → 0.0, else remaining / fade.
 * Kept file-level and internal so the JUnit parity test can reach it.
 */
internal fun fadeVolume(remainingSeconds: Double, fadeSeconds: Double): Double =
  when {
    remainingSeconds >= fadeSeconds -> 1.0
    remainingSeconds <= 0.0 -> 0.0
    else -> remainingSeconds / fadeSeconds
  }

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
 * The fade curve's source of truth is the shared TypeScript (`fadeVolume` in
 * vendor/player). Android carries a verbatim port of it here (`fadeVolume`
 * below) because the native timer must fade with the screen off, when the JS
 * that used to drive it is suspended. FadeCurveTest pins the port to the shared
 * values so the two cannot drift.
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
  // Held so play() can attach it to the MediaItem. Metadata has to be on the
  // item when playback starts: pushing it afterwards would mean replacing the
  // item, which restarts the audio.
  private var pendingTitle: String = ""
  private var pendingArtist: String = "sleepcast"
  private var pendingArtwork: String = ""

  private val player: Player?
    get() = controller

  // Native sleep timer. Handler on the main looper because ExoPlayer demands
  // the main thread; SystemClock.elapsedRealtime() because it is monotonic —
  // wall-clock adjustments must not lengthen or shorten a night.
  private val timerHandler = Handler(Looper.getMainLooper())
  private var timerRunnable: Runnable? = null
  private var endAtElapsed = 0L
  private var fadeSeconds = 0.0
  private var startedAtElapsed = 0L
  private var timerEpisodeId = ""

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
          val metadata = MediaMetadata.Builder()
            .setTitle(pendingTitle.ifEmpty { "sleepcast" })
            .setArtist(pendingArtist)
            .apply {
              if (pendingArtwork.isNotEmpty()) {
                setArtworkUri(android.net.Uri.parse(pendingArtwork))
              }
            }
            .build()
          p.setMediaItem(
            MediaItem.Builder().setUri(url).setMediaMetadata(metadata).build()
          )
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

  override fun scheduleFadeAndStop(episodeId: String, durationSeconds: Double, fadeSecs: Double) = runOnMain {
    cancelTimerInternal()
    timerEpisodeId = episodeId
    fadeSeconds = fadeSecs
    startedAtElapsed = SystemClock.elapsedRealtime()
    endAtElapsed = startedAtElapsed + (durationSeconds * 1000).toLong()
    val tick = object : Runnable {
      override fun run() {
        val remaining = (endAtElapsed - SystemClock.elapsedRealtime()) / 1000.0
        if (remaining <= 0.0) {
          player?.volume = 0f
          player?.stop()
          val heard = Math.round((SystemClock.elapsedRealtime() - startedAtElapsed) / 1000.0).toInt()
          emitNightEnded(timerEpisodeId, heard)
          cancelTimerInternal()
          return
        }
        player?.volume = fadeVolume(remaining, fadeSeconds).toFloat()
        timerHandler.postDelayed(this, 500)
      }
    }
    timerRunnable = tick
    timerHandler.post(tick)
  }

  override fun cancelTimer() = runOnMain { cancelTimerInternal() }

  private fun cancelTimerInternal() {
    timerRunnable?.let { timerHandler.removeCallbacks(it) }
    timerRunnable = null
  }

  private fun emitNightEnded(episodeId: String, heardSeconds: Int) {
    val map = Arguments.createMap().apply {
      putString("episodeId", episodeId)
      putInt("heardSeconds", heardSeconds)
    }
    // Codegen (from the spec's EventEmitter<NightEndedEvent>) generates
    // emitOnNightEnded(ReadableMap) on NativeNightAudioSpec.
    emitOnNightEnded(map)
  }

  override fun stop() = runOnMain {
    cancelTimerInternal()
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

  /** Call BEFORE play(). The lock screen reads what is on the MediaItem, and
   *  swapping the item after playback starts would restart the audio. */
  override fun setNowPlaying(
    title: String,
    artist: String,
    artworkUrl: String,
    durationSeconds: Double
  ) = runOnMain {
    pendingTitle = title
    pendingArtist = artist
    pendingArtwork = artworkUrl
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
