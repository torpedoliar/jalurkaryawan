package expo.modules.bmsdatawedge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** DataWedge intent output, not keyboard emulation. Every decoded value is still validated by the server. */
class BmsDataWedgeModule : Module() {
  private var registered = false
  private var confirmed = false
  private var pending: Promise? = null
  private var commandId: String? = null
  private val handler = Handler(Looper.getMainLooper())
  private val timeout = Runnable {
    pending?.reject("DATAWEDGE_TIMEOUT", "DataWedge tidak mengonfirmasi profil. Gunakan kamera.", null)
    pending = null; confirmed = false
  }
  private val resultAction = "com.symbol.datawedge.api.RESULT_ACTION"
  private val action = "com.santosjayaabadi.bms.SCAN"
  private val receiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if (intent.action == resultAction) {
        if (intent.getStringExtra("COMMAND_IDENTIFIER") != commandId) return
        handler.removeCallbacks(timeout)
        val success = intent.getStringExtra("RESULT") == "SUCCESS"
        confirmed = success
        if (success) pending?.resolve(null)
        else pending?.reject("DATAWEDGE_CONFIG", "DataWedge menolak konfigurasi profil. Gunakan kamera.", null)
        pending = null
        return
      }
      if (intent.action != action || !confirmed) return
      val value = intent.getStringExtra("com.symbol.datawedge.data_string") ?: return
      if (value.isNotBlank() && value.length <= 8192) sendEvent("onScan", mapOf("data" to value))
    }
  }
  override fun definition() = ModuleDefinition {
    Name("BmsDataWedge")
    Events("onScan")
    AsyncFunction("start") { promise: Promise ->
      pending?.reject("DATAWEDGE_RESTART", "Pemindai dimulai ulang.", null)
      pending = promise; confirmed = false
      commandId = "bms-${System.nanoTime()}"
      val context = appContext.reactContext ?: error("React context unavailable")
      if (!registered) {
        val filter = IntentFilter(action).apply { addAction(resultAction); addCategory(Intent.CATEGORY_DEFAULT) }
        // DataWedge is a separate system app; RECEIVER_EXPORTED is required on Android 13+.
        if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
        else context.registerReceiver(receiver, filter)
        registered = true
      }
      val barcode = Bundle().apply {
        putString("PLUGIN_NAME", "BARCODE"); putString("RESET_CONFIG", "true")
        putBundle("PARAM_LIST", Bundle().apply { putString("scanner_input_enabled", "true") })
      }
      val output = Bundle().apply {
        putString("PLUGIN_NAME", "INTENT"); putString("RESET_CONFIG", "true")
        putBundle("PARAM_LIST", Bundle().apply {
          putString("intent_output_enabled", "true"); putString("intent_action", action)
          putString("intent_category", Intent.CATEGORY_DEFAULT); putString("intent_delivery", "2")
          // DataWedge 8+ targeted output prevents implicit broadcasts leaking ticket payloads.
          putParcelableArrayList("intent_component_info", arrayListOf(Bundle().apply {
            putString("PACKAGE_NAME", context.packageName)
            putString("COMPONENT_NAME", "")
            putString("SIGNATURE", "")
          }))
        })
      }
      val keyboard = Bundle().apply {
        putString("PLUGIN_NAME", "KEYSTROKE"); putString("RESET_CONFIG", "true")
        putBundle("PARAM_LIST", Bundle().apply { putString("keystroke_output_enabled", "false") })
      }
      val profile = Bundle().apply {
        putString("PROFILE_NAME", "BMS Driver"); putString("PROFILE_ENABLED", "true"); putString("CONFIG_MODE", "OVERWRITE")
        putParcelableArrayList("PLUGIN_CONFIG", arrayListOf(barcode, output, keyboard))
        putParcelableArray("APP_LIST", arrayOf(Bundle().apply {
          putString("PACKAGE_NAME", context.packageName); putStringArray("ACTIVITY_LIST", arrayOf("*"))
        }))
      }
      handler.removeCallbacks(timeout)
      handler.postDelayed(timeout, 5000)
      context.sendBroadcast(Intent("com.symbol.datawedge.api.ACTION").apply {
        setPackage("com.symbol.datawedge"); putExtra("com.symbol.datawedge.api.SET_CONFIG", profile)
        putExtra("SEND_RESULT", "LAST_RESULT")
        putExtra("COMMAND_IDENTIFIER", commandId)
      })
    }
    AsyncFunction("stop") { unregister() }
    OnDestroy { unregister() }
  }
  private fun unregister() {
    confirmed = false
    handler.removeCallbacks(timeout)
    pending?.reject("DATAWEDGE_STOPPED", "Pemindai dihentikan.", null)
    pending = null
    if (registered) { appContext.reactContext?.unregisterReceiver(receiver); registered = false }
  }
}
