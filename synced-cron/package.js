Package.describe({
  name: 'trever:synced-cron',
  version: '0.0.1',
  // Brief, one-line summary of the package.
  summary: '',
  // URL to the Git repository containing the source code for this package.
  git: '',
  // By default, Meteor will default to using README.md for documentation.
  // To avoid submitting documentation, set this field to null.
  documentation: 'README.md'
});

Package.onUse(function(api) {
  api.versionsFrom('1.1.0.2');
  api.addFiles('synced-cron.js');
});

Package.onTest(function(api) {
  api.use('tinytest');
  api.use('trever:synced-cron');
  api.addFiles('synced-cron-tests.js');
});
