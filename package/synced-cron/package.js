Package.describe({
  summary:
    "Allows you to define and run scheduled jobs across multiple servers.",
  version: "2.0.2",
  name: "quave:synced-cron",
  git: "https://github.com/quavedev/meteor-synced-cron.git",
});

Npm.depends({ "@breejs/later": "4.1.0" });

Package.onUse(function (api) {
  api.versionsFrom("3.0-beta.0");

  api.use('ecmascript@0.16.7||0.16.8-alpha300.17');
  
  api.use(
    ["check@1.3.2||1.3.3-alpha300.17", "mongo@1.0.0||2.0.0||2.0.0-alpha300.17", "logging@1.3.2||1.3.3-alpha300.17"],
    "server",
  );

  api.addFiles(["synced-cron-server.js"], "server");

  api.export("SyncedCron", "server");
});

Package.onTest(function (api) {
  api.use([
    // 'meteortesting:mocha@3.1.0-beta300.0',
    'quave:synced-cron@2.0.2'
  ])
});
