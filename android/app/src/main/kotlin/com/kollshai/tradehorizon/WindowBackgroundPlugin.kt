package com.kollshai.tradehorizon

import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Lets the web app set the colour of the window behind it.
 *
 * On phones whose WebView cannot draw under the status and navigation bars, Capacitor keeps the page between the
 * bars and the window colour shows behind them. The app has a dark and a light theme, so the page tells the window
 * which colour to use (see src/platform/systemBars.ts).
 */
@CapacitorPlugin(name = "WindowBackground")
class WindowBackgroundPlugin : Plugin() {
    /** Sets the window colour from a "#RRGGBB" string; rejects anything else. */
    @PluginMethod
    fun setColor(call: PluginCall) {
        val value = call.getString("color")
        val color = try {
            Color.parseColor(value)
        } catch (_: IllegalArgumentException) {
            call.reject("Expected a colour such as #080B10, got: $value")
            return
        }
        activity.runOnUiThread {
            activity.window.setBackgroundDrawable(ColorDrawable(color))
            activity.window.decorView.setBackgroundColor(color)
            call.resolve()
        }
    }
}
