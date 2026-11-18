import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// One version for the web app and the Android app: package.json is the source (see scripts/bump-version.ts).
val appVersion: String = (JsonSlurper().parse(rootProject.file("../package.json")) as Map<*, *>)["version"] as String

/** "1.4.2" -> 10402: Android needs a number that grows with every release. */
fun versionCodeOf(version: String): Int {
    val (major, minor, patch) = version.substringBefore('-').split('.').map(String::toInt)
    return major * 10_000 + minor * 100 + patch
}

android {
    namespace = "com.kollshai.tradehorizon"
    compileSdk = rootProject.extra["compileSdkVersion"] as Int

    defaultConfig {
        applicationId = "com.kollshai.tradehorizon"
        minSdk = rootProject.extra["minSdkVersion"] as Int
        targetSdk = rootProject.extra["targetSdkVersion"] as Int
        versionCode = versionCodeOf(appVersion)
        versionName = appVersion
    }

    androidResources {
        // Which files to leave out of the packaged web app. Android's default also drops names starting with "_",
        // which modern web bundles use; this keeps them.
        ignoreAssetsPattern = "!.svn:!.git:!.ds_store:!*.scc:.*:!CVS:!thumbs.db:!picasa.ini:!*~"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
}

kotlin {
    compilerOptions {
        // Matches the Java level Capacitor sets for the app (capacitor.build.gradle).
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21)
    }
}

repositories {
    flatDir {
        dirs("../capacitor-cordova-android-plugins/src/main/libs", "libs")
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:${rootProject.extra["androidxAppCompatVersion"]}")
    implementation("androidx.coordinatorlayout:coordinatorlayout:${rootProject.extra["androidxCoordinatorLayoutVersion"]}")
    implementation("androidx.core:core-splashscreen:${rootProject.extra["coreSplashScreenVersion"]}")
    implementation(project(":capacitor-android"))
    implementation(project(":capacitor-cordova-android-plugins"))
}

// The Capacitor plugins in use, written by `npx cap sync android` and not kept in git.
apply(from = "capacitor.build.gradle")
