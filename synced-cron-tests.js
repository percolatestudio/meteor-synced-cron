Later = Npm.require('later');

Later.date.localTime(); // corresponds to SyncedCron.options.utc: true;

var TestEntry = {
  name: 'Test Job',
  schedule: function(parser) {
    return parser.cron('15 10 * * ? *'); // not required
  },
  job: function() {
    return 'ran';
  }
};

Tinytest.addAsync('Syncing works', async function(test) {
  await SyncedCron._reset();
  const count = await SyncedCron._collection.find().countAsync()
  test.equal(count, 0);

  // added the entry ok
  SyncedCron.add(TestEntry);
  test.equal(_.keys(SyncedCron._entries).length, 1);

  var entry = SyncedCron._entries[TestEntry.name];
  var intendedAt = new Date(); //whatever

  // first run
  await SyncedCron._entryWrapper(entry)(intendedAt);
  const count2 = await SyncedCron._collection.find().countAsync();
  test.equal(count2, 1);
  var jobHistory1 = await SyncedCron._collection.findOneAsync();
  test.equal(jobHistory1.result, 'ran');

  // second run
  await SyncedCron._entryWrapper(entry)(intendedAt);
  const count3 = await SyncedCron._collection.find().countAsync();
  test.equal(count3, 1); // should still be 1
  var jobHistory2 = await SyncedCron._collection.findOneAsync();
  test.equal(jobHistory1._id, jobHistory2._id);
});

Tinytest.addAsync('Exceptions work', async function(test) {
  await SyncedCron._reset();
  SyncedCron.add(_.extend({}, TestEntry, {
      job: function() {
        throw new Meteor.Error('Haha, gotcha!');
      }
    })
  );

  var entry = SyncedCron._entries[TestEntry.name];
  var intendedAt = new Date(); //whatever

  // error without result
  await SyncedCron._entryWrapper(entry)(intendedAt);
  test.equal(await SyncedCron._collection.find().countAsync(), 1);
  var jobHistory1 = await SyncedCron._collection.findOneAsync();
  test.equal(jobHistory1.result, undefined);
  test.matches(jobHistory1.error, /Haha, gotcha/);
});

Tinytest.addAsync('SyncedCron.nextScheduledAtDate works', async function(test) {
  await SyncedCron._reset();
  test.equal(await SyncedCron._collection.find().countAsync(), 0);

  // addd 2 entries
  SyncedCron.add(TestEntry);

  var entry2 = _.extend({}, TestEntry, {
    name: 'Test Job2',
    schedule: function(parser) {
      return parser.cron('30 11 * * ? *');
    }
  });
  SyncedCron.add(entry2);

  test.equal(_.keys(SyncedCron._entries).length, 2);

  SyncedCron.start();

  var date = SyncedCron.nextScheduledAtDate(entry2.name);
  var correctDate = Later.schedule(entry2.schedule(Later.parse)).next(1);

  test.equal(date, correctDate);
});

// Tests SyncedCron.remove in the process
Tinytest.addAsync('SyncedCron.stop works', async function(test) {
  await SyncedCron._reset();
  const count = await SyncedCron._collection.find().countAsync();
  test.equal(count, 0);

  // addd 2 entries
  SyncedCron.add(TestEntry);

  var entry2 = _.extend({}, TestEntry, {
    name: 'Test Job2',
    schedule: function(parser) {
      return parser.cron('30 11 * * ? *');
    }
  });
  SyncedCron.add(entry2);

  SyncedCron.start();

  test.equal(_.keys(SyncedCron._entries).length, 2);

  SyncedCron.stop();

  test.equal(_.keys(SyncedCron._entries).length, 0);
});

Tinytest.addAsync('SyncedCron.pause works', async function(test) {
  await SyncedCron._reset();
  test.equal(await SyncedCron._collection.find().countAsync(), 0);

  // addd 2 entries
  SyncedCron.add(TestEntry);

  var entry2 = _.extend({}, TestEntry, {
    name: 'Test Job2',
    schedule: function(parser) {
      return parser.cron('30 11 * * ? *');
    }
  });
  SyncedCron.add(entry2);

  SyncedCron.start();

  test.equal(_.keys(SyncedCron._entries).length, 2);

  SyncedCron.pause();

  test.equal(_.keys(SyncedCron._entries).length, 2);
  test.isFalse(SyncedCron.running);

  SyncedCron.start();

  test.equal(_.keys(SyncedCron._entries).length, 2);
  test.isTrue(SyncedCron.running);

});

// Tests SyncedCron.remove in the process
Tinytest.addAsync('SyncedCron.add starts by it self when running', async function(test) {
  await SyncedCron._reset();

  test.equal(await SyncedCron._collection.find().countAsync(), 0);
  test.equal(SyncedCron.running, false);
  Log._intercept(2);

  SyncedCron.start();

  test.equal(SyncedCron.running, true);

  // addd 1 entries
  SyncedCron.add(TestEntry);

  test.equal(_.keys(SyncedCron._entries).length, 1);

  SyncedCron.stop();

  var intercepted = Log._intercepted();
  test.equal(intercepted.length, 2);

  test.equal(SyncedCron.running, false);
  test.equal(_.keys(SyncedCron._entries).length, 0);
});

Tinytest.addAsync('SyncedCron.config can customize the options object', async function(test) {
  await SyncedCron._reset();

  SyncedCron.config({
    log: false,
    collectionName: 'foo',
    utc: true,
    collectionTTL: 0
  });

  test.equal(SyncedCron.options.log, false);
  test.equal(SyncedCron.options.collectionName, 'foo');
  test.equal(SyncedCron.options.utc, true);
  test.equal(SyncedCron.options.collectionTTL, 0);
});

Tinytest.addAsync('SyncedCron can log to injected logger', async function(test, done) {
  await SyncedCron._reset();

  var logger = function() {
    test.isTrue(true);

    SyncedCron.stop();
    done();
  };

  SyncedCron.options.logger = logger;

  SyncedCron.add(TestEntry);
  SyncedCron.start();

  SyncedCron.options.logger = null;
});

Tinytest.addAsync('SyncedCron should pass correct arguments to logger', async function(test, done) {
  await SyncedCron._reset();

  var logger = function(opts) {
    test.include(opts, 'level');
    test.include(opts, 'message');
    test.include(opts, 'tag');
    test.equal(opts.tag, 'SyncedCron');

    SyncedCron.stop();
    done();
  };

  SyncedCron.options.logger = logger;

  SyncedCron.add(TestEntry);
  SyncedCron.start();

  SyncedCron.options.logger = null;

});

Tinytest.add('Single time schedules don\'t break', function(test) {
  // create a once off date 1 sec in the future
  var date = new Date(new Date().valueOf() + 1 * 1000);
  var schedule = Later.parse.recur().on(date).fullDate();

  // this would throw without our patch for #41
  SyncedCron._laterSetTimeout(_.identity, schedule);
});


Tinytest.addAsync('Do not persist when flag is set to false', async function (test) {
  await SyncedCron._reset();

  var testEntryNoPersist = _.extend({}, TestEntry, {persist: false});

  SyncedCron.add(testEntryNoPersist);

  const now = new Date();
  await SyncedCron._entryWrapper(testEntryNoPersist)(now);
  test.equal(await SyncedCron._collection.find().countAsync(), 0);
});
