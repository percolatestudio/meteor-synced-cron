Package.describe({
  summary: "Allows you to define and run scheduled jobs across multiple servers.",
  version: "1.4.0",
  name: "percolate:synced-cron",
  git: "https://github.com/percolatestudio/meteor-synced-cron.git"
});

Npm.depends({later: '1.1.6', timezone:'0.0.41'});

Package.onUse(function(api) {
  api.versionsFrom('METEOR@0.9.1.1');
  api.use(['underscore', 'check', 'mongo', 'logging'], 'server');
  api.addFiles(['synced-cron-server.js'], 'server');
  api.export(['SyncedCron'], 'server');
});

Package.onTest(function(api) {
  api.use(['percolate:synced-cron', 'tinytest']);
  api.addFiles('synced-cron-tests.js', ['server']);
});
