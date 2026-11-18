// Top-level build file: build plugins and the versions shared by the app and the Capacitor modules.

buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.13.0")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.3.0")
    }
}

// Capacitor's own modules (under node_modules/@capacitor) read these names from `rootProject.ext`.
extra["minSdkVersion"] = 24
extra["compileSdkVersion"] = 36
extra["targetSdkVersion"] = 36
extra["androidxActivityVersion"] = "1.11.0"
extra["androidxAppCompatVersion"] = "1.7.1"
extra["androidxCoordinatorLayoutVersion"] = "1.3.0"
extra["androidxCoreVersion"] = "1.17.0"
extra["androidxFragmentVersion"] = "1.8.9"
extra["coreSplashScreenVersion"] = "1.2.0"
extra["androidxWebkitVersion"] = "1.14.0"
extra["junitVersion"] = "4.13.2"
extra["androidxJunitVersion"] = "1.3.0"
extra["androidxEspressoCoreVersion"] = "3.7.0"
extra["cordovaAndroidVersion"] = "14.0.1"

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
