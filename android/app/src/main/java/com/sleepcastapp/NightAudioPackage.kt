package com.sleepcastapp

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class NightAudioPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == NightAudioModule.NAME) NightAudioModule(reactContext) else null

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      NightAudioModule.NAME to ReactModuleInfo(
        NightAudioModule.NAME,
        // The CLASS name, not the module name. Passing the module name here
        // compiles, registers, and then fails at runtime with "could not be
        // found in the native binary" — the class is in the APK, it just can
        // never be resolved.
        NightAudioModule::class.java.name,
        false, // canOverrideExistingModule
        false, // needsEagerInit
        false, // isCxxModule
        true,  // isTurboModule
      )
    )
  }
}
