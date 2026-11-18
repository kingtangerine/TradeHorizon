// The app module, plus the Capacitor modules listed in capacitor.settings.gradle.
// That file is written by `npx cap sync android` (run by `npm run android:sync`) and is not kept in git.
include(":app")
include(":capacitor-cordova-android-plugins")
project(":capacitor-cordova-android-plugins").projectDir = file("capacitor-cordova-android-plugins")

apply(from = "capacitor.settings.gradle")
