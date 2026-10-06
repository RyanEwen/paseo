const { withAppBuildGradle } = require("expo/config-plugins");

/** Wire release signing to CI secrets without embedding credentials in generated source. */
function configureAndroidReleaseSigning(source) {
  const releasePattern = /(release\s*\{[^{}]*?)signingConfig signingConfigs.debug/;
  if (!releasePattern.test(source) || !source.includes("signingConfigs {")) {
    throw new Error("Expo's Android signing layout changed; review the release signing plugin");
  }

  const signingConfig = `signingConfigs {
        preview {
            storeFile file(System.getenv("PASEO_ANDROID_KEYSTORE"))
            storePassword System.getenv("PASEO_ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("PASEO_ANDROID_KEY_ALIAS")
            keyPassword System.getenv("PASEO_ANDROID_KEY_PASSWORD")
        }`;

  return source
    .replace("signingConfigs {", signingConfig)
    .replace(releasePattern, "$1signingConfig signingConfigs.preview");
}

function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (modConfig) => {
    if (modConfig.modResults.language !== "groovy") {
      throw new Error("Preview release signing requires Expo's Groovy Gradle template");
    }
    modConfig.modResults.contents = configureAndroidReleaseSigning(modConfig.modResults.contents);
    return modConfig;
  });
}

module.exports = withAndroidReleaseSigning;
module.exports.configureAndroidReleaseSigning = configureAndroidReleaseSigning;
