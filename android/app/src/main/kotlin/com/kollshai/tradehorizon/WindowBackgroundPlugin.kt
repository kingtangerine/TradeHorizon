package com.kollshai.tradehorizon

import android.content.res.Configuration
import android.graphics.Color
import androidx.core.view.ViewCompat
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
            lastColor = color
            applyColor(color)
            call.resolve()
        }
    }

    /**
     * Turning the device (or resizing the window) makes Android paint the window in its theme colour again, so the
     * colour the page asked for is put back once that change has been applied.
     */
    override fun handleOnConfigurationChanged(newConfig: Configuration) {
        super.handleOnConfigurationChanged(newConfig)
        val color = lastColor ?: return
        activity.window.decorView.post { applyColor(color) }
    }

    private fun applyColor(color: Int) {
        val decorView = activity.window.decorView
        // Only the colour of the existing background is changed. Replacing the window's background drawable
        // (Window.setBackgroundDrawable) makes Android reset the decor view's padding, which is what Capacitor
        // uses to keep the page between the system bars: the page then slides under them until the next inset
        // pass, and stays there if that pass does not come.
        decorView.setBackgroundColor(color)
        // Safeguard: have the insets applied again, so the padding is right whatever touched it before.
        ViewCompat.requestApplyInsets(decorView)
    }

    /** The colour last asked for by the page; null until it asks. Only touched on the UI thread. */
    private var lastColor: Int? = null
}
