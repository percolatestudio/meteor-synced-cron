Package.describe({
  summary: "Allows you to define and run scheduled jobs across multiple servers.",
  version: "0.1.1"
});

Npm.depends({later: "1.1.6"});

Package.on_use(function (api) {
  api.use(['underscore', 'check'], 'server');
  api.add_files(['synced-cron-server.js'], "server");
  api.export('SyncedCron', 'server');
});

Package.on_test(function (api) {
  api.use(['percolatestudio:synced-cron', 'tinytest']);
  api.add_files('synced-cron-tests.js', ['server']);
});
