package com.sleepcastapp

import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
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
 * NOT YET BACKGROUND-SAFE. Android will kill playback from a backgrounded app
 * without a foreground MediaSessionService, so this survives the screen going
 * off only briefly. That service is the next increment; until it lands, this
 * module proves the playback path and nothing about overnight behaviour.
 */
class NightAudioModule(reactContext: ReactApplicationContext) :
  NativeNightAudioSpec(reactContext) {

  private var player: ExoPlayer? = null

  override fun getName() = NAME

  private fun ensurePlayer(): ExoPlayer {
    val existing = player
    if (existing != null) return existing
    val created = ExoPlayer.Builder(reactApplicationContext).build()
    player = created
    return created
  }

  override fun play(url: String, startAtSeconds: Double, promise: Promise) {
    runOnMain {
      try {
        val p = ensurePlayer()
        p.setMediaItem(MediaItem.fromUri(url))
        p.prepare()
        if (startAtSeconds > 0) p.seekTo((startAtSeconds * 1000).toLong())
        p.playWhenReady = true
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
    player?.stop()
    player?.release()
    player = null
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
    runOnMain {
      player?.release()
      player = null
    }
    super.invalidate()
  }

  companion object {
    const val NAME = "NightAudio"
  }
}
