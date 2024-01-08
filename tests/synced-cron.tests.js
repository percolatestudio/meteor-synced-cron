import expect from 'expect';
import Later from "@breejs/later";
import 'meteor/aldeed:collection2/dynamic'

Collection2.load();

Later.date.localTime(); // corresponds to SyncedCron.options.utc: true;

const TestEntry = {
  name: "Test Job",
  schedule: function (parser) {
    return parser.cron("15 10 * * ? *"); // not required
  },
  job: function () {
    return "ran";
  },
};

describe("Synced-Cron", function() {

  before(async function() {
    await SyncedCron._collection.removeAsync({})
  })

  it("Syncing works", async function () {
    await SyncedCron._reset();
    expect(await SyncedCron._collection.find().countAsync()).toEqual(0);
  
    // added the entry ok
    SyncedCron.add(TestEntry);
    expect(Object.keys(SyncedCron._entries).length).toEqual(1);
  
    const entry = SyncedCron._entries[TestEntry.name];
    const intendedAt = new Date(); //whatever
  
    // first run
    await SyncedCron._entryWrapper(entry)(intendedAt);
    expect(await SyncedCron._collection.find().countAsync()).toEqual(1);
    const jobHistory1 = await SyncedCron._collection.findOneAsync();
    expect(jobHistory1.result).toEqual("ran");
  
    // second run
    await SyncedCron._entryWrapper(entry)(intendedAt);
    expect(await SyncedCron._collection.find().countAsync()).toEqual(1); // should still be 1
    const jobHistory2 = await SyncedCron._collection.findOneAsync();
    expect(jobHistory1._id).toEqual(jobHistory2._id);
  });
  
  it("Exceptions work", async function () {
    await SyncedCron._reset();
    SyncedCron.add(
      Object.assign({}, TestEntry, {
        job: function () {
          throw new Meteor.Error("Haha, gotcha!");
        },
      }),
    );
  
    const entry = SyncedCron._entries[TestEntry.name];
    const intendedAt = new Date(); //whatever
  
    // error without result
    await SyncedCron._entryWrapper(entry)(intendedAt);
    expect(await SyncedCron._collection.find().countAsync()).toEqual(1);
    const jobHistory1 = await SyncedCron._collection.findOneAsync();
    expect(jobHistory1.result).toEqual(undefined);
    expect(jobHistory1.error).toMatch(/Haha, gotcha/);
  });
  
  it(
    "SyncedCron.nextScheduledAtDate works",
    async function () {
      await SyncedCron._reset();
      expect(await SyncedCron._collection.find().countAsync()).toEqual(0);
  
      // addd 2 entries
      SyncedCron.add(TestEntry);
  
      const entry2 = Object.assign({}, TestEntry, {
        name: "Test Job2",
        schedule: function (parser) {
          return parser.cron("30 11 * * ? *");
        },
      });
      SyncedCron.add(entry2);
  
      expect(Object.keys(SyncedCron._entries).length).toEqual(2);
  
      SyncedCron.start();
  
      const date = SyncedCron.nextScheduledAtDate(entry2.name);
      const correctDate = Later.schedule(entry2.schedule(Later.parse)).next(1);
  
      expect(date).toEqual(correctDate);
    },
  );
  
  // Tests SyncedCron.remove in the process
  it("SyncedCron.stop works", async function () {
    await SyncedCron._reset();
    expect(await SyncedCron._collection.find().countAsync()).toEqual(0);
  
    // addd 2 entries
    SyncedCron.add(TestEntry);
  
    const entry2 = Object.assign({}, TestEntry, {
      name: "Test Job2",
      schedule: function (parser) {
        return parser.cron("30 11 * * ? *");
      },
    });
    SyncedCron.add(entry2);
  
    SyncedCron.start();
  
    expect(Object.keys(SyncedCron._entries).length).toEqual(2);
  
    SyncedCron.stop();
  
    expect(Object.keys(SyncedCron._entries).length).toEqual(0);
  });
  
  it("SyncedCron.pause works", async function () {
    await SyncedCron._reset();
    expect(await SyncedCron._collection.find().countAsync()).toEqual(0);
  
    // addd 2 entries
    SyncedCron.add(TestEntry);
  
    const entry2 = Object.assign({}, TestEntry, {
      name: "Test Job2",
      schedule: function (parser) {
        return parser.cron("30 11 * * ? *");
      },
    });
    SyncedCron.add(entry2);
  
    SyncedCron.start();
  
    expect(Object.keys(SyncedCron._entries).length).toEqual(2);
  
    SyncedCron.pause();
  
    expect(Object.keys(SyncedCron._entries).length).toEqual(2);
    expect(SyncedCron.running).toBeFalsy();
  
    SyncedCron.start();
  
    expect(Object.keys(SyncedCron._entries).length).toEqual(2);
    expect(SyncedCron.running).toBeTruthy();
  });
  
  // Tests SyncedCron.remove in the process
  it(
    "SyncedCron.add starts by it self when running",
    async function () {
      await SyncedCron._reset();
  
      expect(await SyncedCron._collection.find().countAsync()).toEqual(0);
      expect(SyncedCron.running).toEqual(false);
      Log._intercept(2);
  
      SyncedCron.start();
  
      expect(SyncedCron.running).toEqual(true);
  
      // addd 1 entries
      SyncedCron.add(TestEntry);
  
      expect(Object.keys(SyncedCron._entries).length).toEqual(1);
  
      SyncedCron.stop();
  
      const intercepted = Log._intercepted();
      expect(intercepted.length).toEqual(2);
  
      expect(SyncedCron.running).toEqual(false);
      expect(Object.keys(SyncedCron._entries).length).toEqual(0);
    },
  );
  
  it(
    "SyncedCron.config can customize the options object",
    async function () {
      await SyncedCron._reset();
  
      SyncedCron.config({
        log: false,
        collectionName: "foo",
        utc: true,
        collectionTTL: 0,
      });
  
      expect(SyncedCron.options.log).toEqual(false);
      expect(SyncedCron.options.collectionName).toEqual("foo");
      expect(SyncedCron.options.utc).toEqual(true);
      expect(SyncedCron.options.collectionTTL).toEqual(0);
    },
  );
  
  it(
    "SyncedCron can log to injected logger",
    async function () {
      await SyncedCron._reset();
  
      const logger = function () {
        SyncedCron.stop();
      };
  
      SyncedCron.options.logger = logger;
  
      SyncedCron.add(TestEntry);
      SyncedCron.start();
  
      SyncedCron.options.logger = null;
    },
  );
  
  it("SyncedCron should pass correct arguments to logger",
    async function () {
      await SyncedCron._reset();
  
      const logger = function (opts) {
        expect(opts).toHaveProperty("level");
        expect(opts).toHaveProperty("message");
        expect(opts).toHaveProperty("tag");
        expect(opts.tag).toEqual("SyncedCron");
  
        SyncedCron.stop();
      };
  
      SyncedCron.options.logger = logger;
  
      SyncedCron.add(TestEntry);
      SyncedCron.start();
  
      SyncedCron.options.logger = null;
    },
  );
  
  it("Single time schedules don't break", async function () {
    // create a once off date 1 sec in the future
    const date = new Date(new Date().valueOf() + 1000);
    const schedule = Later.parse.recur().on(date).fullDate();
  
    // this would throw without our patch for #41
    SyncedCron._laterSetTimeout(() => {}, schedule);
  });
  
  it(
    "Do not persist when flag is set to false",
    async function () {
      await SyncedCron._reset();
  
      const testEntryNoPersist = Object.assign({}, TestEntry, { persist: false });
  
      SyncedCron.add(testEntryNoPersist);
  
      const now = new Date();
      await SyncedCron._entryWrapper(testEntryNoPersist)(now);
      const count = await SyncedCron._collection.find().countAsync();
      expect(count).toEqual(0);
    },
  );
  

})

