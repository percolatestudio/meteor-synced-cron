Package.describe({
  summary: "Allows you to define and run scheduled jobs across multiple servers."
});

Npm.depends({later: "1.1.6", sinon: "1.10.2"});

Package.onUse(function (api) {
  api.versionsFrom('METEOR@0.9.0.1');
  api.use(['underscore', 'check', 'mongo'], 'server');
  api.add_files(['synced-cron-server.js'], "server");
  api.export('SyncedCron', 'server');
});

Package.onTest(function (api) {
  api.use(['percolatestudio:synced-cron', 'tinytest']);
  api.add_files('synced-cron-tests.js', ['server']);
});
