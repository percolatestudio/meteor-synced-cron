Package.describe({
  summary: "Define and run scheduled jobs across multiple servers.",
  version: "2.0.0",
  name: "percolate:synced-cron",
  git: "https://github.com/percolatestudio/meteor-synced-cron.git"
});

Npm.depends({later: "1.1.6"});

Package.onUse(function (api) {
  api.versionsFrom('METEOR@2.8.0');
  api.use("ecmascript");
  api.use(['underscore', 'check', 'mongo', 'logging'], 'server');
  api.addFiles(['synced-cron-server.js'], "server");
  api.export('SyncedCron', 'server');
});

Package.onTest(function (api) {
  api.use(['check', 'mongo'], 'server');
  api.use("ecmascript");
  api.use(['tinytest', 'underscore', 'logging']);
  api.addFiles(['synced-cron-server.js', 'synced-cron-tests.js'], ['server']);
});
