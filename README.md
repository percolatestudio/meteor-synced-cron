# percolate:synced-cron

A simple cron system for [Meteor](http://meteor.com). It supports syncronizing jobs between multiple processes. In other words, if you add a job that runs every hour and your deployment consists of multiple app servers, only one of the app servers will execute the job each time (whichever tries first).

## Installation

``` sh
$ meteor add percolate:synced-cron
```

## API

### Basics

To write a cron job, give it a unique name, a schedule and a function to run like below. SyncedCron uses the fantastic [later.js](http://bunkat.github.io/later/) library behind the scenes. A Later.js `parse` object is passed into the schedule call that gives you a huge amount of flexibility for scheduling your jobs, see the [documentation](http://bunkat.github.io/later/parsers.html#overview).

``` js
SyncedCron.add({
  name: 'Crunch some important numbers for the marketing department',
  timezone: 'utc',
  // Optionally set a positive offset if you wish to 'snooze' a schedule
  offset: 30 * 60 * 100,
  // Optional context to pass in to the job function
  context: {
    // one or more key:value pairs. E.g.
    // userID: 'fad94af3q4ho65h4'
  },
  schedule: function(parser) {
    // Context will be available as 'this'
    console.log(this.userID);

    // parser is a later.parse object
    return parser.text('every 2 hours');
  },
  job: function() {
    // Context will be available as 'this'
    console.log(this.userID);

    // Perform one or more actions
    var numbersCrunched = CrushSomeNumbers();

    // Return the result
    return numbersCrunched;
  }
});
```

To start processing your jobs, somewhere in your project add:

``` js
SyncedCron.start();
```

### Advanced

SyncedCron uses a collection called `cronHistory` to syncronize between processes. This also serves as a useful log of when jobs ran along with their output or error. A sample item looks like:

``` js
{ _id: 'wdYLPBZp5zzbwdfYj',
  intendedAt: Sun Apr 13 2014 17:34:00 GMT-0700 (MST),
  finishedAt: Sun Apr 13 2014 17:34:01 GMT-0700 (MST),
  name: 'Crunch some important numbers for the marketing department',
  startedAt: Sun Apr 13 2014 17:34:00 GMT-0700 (MST),
  result: '1982 numbers crunched'
}
```

Call `SyncedCron.nextScheduledAtDate(jobName)` to find the date that the job
referenced by `jobName` will run next.

Call `SyncedCron.remove(jobName)` to remove and stop running the job referenced by jobName.

Call `SyncedCron.stop()` to remove and stop all jobs.

Call `SyncedCron.pause()` to stop all jobs without removing them.  The existing jobs can be rescheduled (i.e. restarted) with `SyncedCron.start()`.

To schedule a once off (i.e not recurring) event, create a job with a schedule like this `parser.recur().on(date).fullDate();`


### Configuration

You can configure SyncedCron with the `config` method. Defaults are:

``` js
  SyncedCron.config({
    // Log job run details to console
    log: true,

    // Use a custom logger function (defaults to Meteor's logging package)
    logger: null

    // Name of collection to use for synchronisation and logging
    collectionName: 'cronHistory',

    // Default to localTime
    // Options: 'utc', 'localtime', or specific timezones 'America/New_York'
    // Will be applied to jobs with no timezone defined
    timezone: 'utc',

    /*
      TTL in seconds for history records in collection to expire
      NOTE: Unset to remove expiry but ensure you remove the index from
      mongo by hand

      ALSO: SyncedCron can't use the `_ensureIndex` command to modify
      the TTL index. The best way to modify the default value of
      `collectionTTL` is to remove the index by hand (in the mongo shell
      run `db.cronHistory.dropIndex({startedAt: 1})`) and re-run your
      project. SyncedCron will recreate the index with the updated TTL.
    */
    collectionTTL: 172800
  });
```

### Timezone configuration
``` js
SyncedCron.add({
  name: 'User Defined Job',
  timezone: 'Australia/Sydney',
  ...
```

#### Getting user timezone

Automatically collect user timezone with [em0ney:jstz](https://atmospherejs.com/em0ney/jstz).

Allow users to select timezones with [joshowens:timezone-picker](https://atmospherejs.com/joshowens/timezone-picker).

For reference, read [Dealing with Timezones in JavaScript](http://joshowens.me/dealing-with-timezones-in-javascript/) by Josh Owens.

### Logging

SyncedCron uses Meteor's `logging` package by default. If you want to use your own logger (for sending to other consumers or similar) you can do so by configuring the `logger` option.

SyncedCron expects a function as `logger`, and will pass arguments to it for you to take action on.

```js
var MyLogger = function(opts) {
  console.log('Level', opts.level);
  console.log('Message', opts.message);
  console.log('Tag', opts.tag);
}

SyncedCron.config({
  logger: MyLogger
});

SyncedCron.add({ name: 'Test Job', ... });
SyncedCron.start();
```

The `opts` object passed to `MyLogger` above includes `level`, `message`, and `tag`.

- `level` will be one of `info`, `warn`, `error`, `debug`.
- `message` is something like `Scheduled "Test Job" next run @Fri Mar 13 2015 10:15:00 GMT+0100 (CET)`.
- `tag` will always be `"SyncedCron"` (handy for filtering).


## Caveats

Beware, SyncedCron probably won't work as expected on certain shared hosting providers that shutdown app instances when they aren't receiving requests (like Heroku's free dyno tier or Meteor free galaxy).

## Contributing

Write some code. Write some tests. To run the tests, do:

``` sh
$ meteor test-packages ./
```

## License

MIT. (c) Percolate Studio, maintained by Zoltan Olah (@zol).

Synced Cron was developed as part of the [Verso](http://versoapp.com) project.
