# Meteor Synced Cron

A simple cron system for [Meteor](http://meteor.com). It supports syncronizing jobs between multiple processes.

Updated with some extra features for `_id` on jobs, `list` and `remove` functions.

## Installation

``` sh
$ meteor add percolatestudio:synced-cron
```

## API

### Basics

To write a cron job, give it a unique name, a schedule an a function to run like below. SyncedCron uses the fantastic [later.js](http://bunkat.github.io/later/) library behind the scenes. A Later.js `parse` object is passed into the schedule call that gives you a huge amount of flexibility for scheduling your jobs, see the [documentation](http://bunkat.github.io/later/parsers.html#overview). 

``` javascript
var job_id = SyncedCron.add({
  _id: '*optional* Specify a custom Id for the job or it will generate one (used for removing job)',
  name: 'Crunch some important numbers for the marketing department',
  schedule: function(parser) {
    // parser is a later.parse object
    return parser.text('every 2 hours');
  }, 
  job: function() {
    var numbersCrunched = CrushSomeNumbers();
    return numbersCrunched;
  }
});
```

To start processing your jobs, somewhere in your project add: *(NOTE: If you have the `autoRun` flag set to true, you do not need this call, jobs will schedule as they are added.)*

``` javascript
Meteor.startup(function() {
  SyncedCron.start();
});
```

To get a current list of your jobs:

``` javascript
var cronJobs = SyncedCron.list();
```

To remove a job from the cron schedule:

``` javascript
SyncedCron.remove(jobNameOrId);
```

### Advanced

SyncedCron uses a collection called `cronHistory` to syncronize between processes. This also serves as a useful log of when jobs ran along with their output or error. A sample item looks like:

```
{ _id: 'wdYLPBZp5zzbwdfYj',
  intendedAt: Sun Apr 13 2014 17:34:00 GMT-0700 (MST),
  finishedAt: Sun Apr 13 2014 17:34:01 GMT-0700 (MST),
  name: 'Crunch some important numbers for the marketing department',
  startedAt: Sun Apr 13 2014 17:34:00 GMT-0700 (MST),
  result: '1982 numbers crunched'
}
```

If you want old entries in the log cleaned out, simply set the `purgeLogsAfterDays`
parameter on an entry to specify the number of days of logs to keep.

Call `SyncedCron.nextScheduledAtDate(jobNameOrId)` to find the date that the job
referenced by `jobNameOrId` will run next.

### Configuration

```
SyncedCron.options: {
  log: true, // log debug info to the console
  collectionName: 'cronHistory' // default name of the collection used to store job history,
  utc: false // use UTC for evaluating schedules (default: local time)
  autoStart: false // allow autostart cron jobs as added or wait for start function
}
```


## Contributing

Write some code. Write some tests. To run the tests, do:

``` sh
$ meteor test-packages percolatestudio:synced-cron
```

## License 

MIT. (c) Percolate Studio

Synced Cron was developed as part of the [Verso](http://versoapp.com) project.
