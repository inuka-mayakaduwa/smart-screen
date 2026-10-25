const { withAndroidManifest } = require("@expo/config-plugins");

const MEET = "com.google.android.apps.meetings";
const TEAMS = "com.microsoft.teams";

function withPanelQueries(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    manifest["uses-permission"] = manifest["uses-permission"] ?? [];
    const permissions = manifest["uses-permission"];
    const queryAll = "android.permission.QUERY_ALL_PACKAGES";
    const installPackages = "android.permission.REQUEST_INSTALL_PACKAGES";
    for (const name of [queryAll, installPackages]) {
      if (!permissions.some((item) => item.$["android:name"] === name)) {
        permissions.push({ $: { "android:name": name } });
      }
    }

    manifest.queries = [
      {
        package: [{ $: { "android:name": MEET } }, { $: { "android:name": TEAMS } }],
        intent: [
          {
            action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
            data: [{ $: { "android:scheme": "https" } }],
          },
        ],
      },
    ];
    return config;
  });
}

module.exports = withPanelQueries;
