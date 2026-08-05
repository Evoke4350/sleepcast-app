package com.sleepcastapp

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Parity test: the Kotlin fadeVolume port must match the shared TypeScript
 * curve exactly — remaining >= fade → 1.0, remaining <= 0 → 0.0, else
 * remaining / fade.
 */
class FadeCurveTest {
  @Test fun matchesSharedCurve() {
    assertEquals(1.0, fadeVolume(120.0, 60.0), 1e-9) // remaining >= fade
    assertEquals(1.0, fadeVolume(60.0, 60.0), 1e-9)
    assertEquals(0.5, fadeVolume(30.0, 60.0), 1e-9)  // linear ramp
    assertEquals(0.0, fadeVolume(0.0, 60.0), 1e-9)
    assertEquals(0.0, fadeVolume(-5.0, 60.0), 1e-9)
  }
}
