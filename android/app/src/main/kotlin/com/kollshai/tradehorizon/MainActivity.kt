package com.kollshai.tradehorizon

import android.os.Bundle
import com.getcapacitor.BridgeActivity

/** The app's only screen: Capacitor's WebView showing the bundled TradeHorizon web app. */
class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Our own plugins must be registered before Capacitor starts the WebView.
        registerPlugin(WindowBackgroundPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
