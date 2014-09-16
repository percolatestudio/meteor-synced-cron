// A package for running jobs synchronized across multiple processes
SyncedCron = {
  _entries: [],
  options: {
    log: true,
    collectionName: 'cronHistory',
    utc: false, //default to using localTime
    autoStart: false // allow autostart cron jobs as added
  }
}

Later = Npm.require('later');

// Use UTC or localtime for evaluating schedules
if (SyncedCron.options.utc)
  Later.date.UTC();
else
  Later.date.localTime();

// collection holding the job history records
SyncedCron._collection = 
  new Mongo.Collection(SyncedCron.options.collectionName);
SyncedCron._collection._ensureIndex({intendedAt: 1, name: 1}, {unique: true});

var log = {
  info: function(message) {
    if (SyncedCron.options.log)
      console.log(message);
  }
}

// add a scheduled job
// SyncedCron.add({
//   id: String, //*optional* id of job for reference
//   name: String, //*required* unique name of the job
//   schedule: function(laterParser) {},//*required* when to run the job
//   job: function() {}, //*required* the code to run
// });

SyncedCron.add = function(entry) {
  
  // add a reference ID to the cron job for management later, allow it to be custom
  // otherwise default to a UUID string.
  if (!entry._id)
    entry._id = Meteor.uuid();

  // check
  check(entry.name, String);
  check(entry.schedule, Function);
  check(entry.job, Function);

  // insert
  this._entries.push(entry);

  // if autoStart is set in flags, start the unstarted cron job
  if (this.options.autoStart)
    this.start(true);

  // return the ID of the scheduled task for future use
  return entry._id;

};

SyncedCron.list = function() {
 
  //return list of current entries in the cron list
  return _.map(this._entries, function(entry) {
    return _.omit(entry, ['_timer', 'job']);
  });

};

SyncedCron.remove = function(jobName) {

  // remove a cron job by its Id or Name fields
  for (var item in this._entries) {
    if (this._entries[item]._id === jobName || this._entries[item].name === jobName) {
      if (this._entries[item]._timer) {
        this._entries[item]._timer.clear();
        this._entries[item]._timer = null;
      }
      this._entries.splice(item, 1);
      return true;
    }
  }
  return false;
};

// Start processing added jobs
SyncedCron.start = function(onlyNew) {
  var self = this;
  
  // if onlyNew not set, set it to false
  if (!onlyNew)
    onlyNew = false

  // Schedule each job with later.js
  this._entries.forEach(function(entry) {
    // check if onlyNew set, only create timers for new items not existing
    if ((onlyNew && !entry._timer) || !onlyNew) {

      var schedule = entry.schedule(Later.parse);
      entry._timer = self._laterSetInterval(self._entryWrapper(entry), schedule);
      
      // simple flag to reference started and non started within list
      entry.active = true;

      log.info('SyncedCron: scheduled "' + entry.name + '" next run @' 
        + Later.schedule(schedule).next(1));
    }
  });
}

// Return the next scheduled date of the first matching entry or undefined
SyncedCron.nextScheduledAtDate = function (jobName) {
  var entry = _.find(this._entries, function(entry) {
    // allow for ID to be passed as job name for next scheduled date
    return entry.name === jobName || entry._id === jobName;
  });
  
  if (entry)
    return Later.schedule(entry.schedule(Later.parse)).next(1);
}

// Stop processing jobs
SyncedCron.stop = function() {
  if (this._timer) {
    this._timer.clear();
    this._timer = null;
  }
}

// The meat of our logic. Checks if the specified has already run. If not,
// records that it's running the job, runs it, and records the output
SyncedCron._entryWrapper = function(entry) {
  var self = this;

  return function(intendedAt) {
    var jobHistory = {
      intendedAt: intendedAt,
      name: entry.name,
      job_id: entry._id,
      startedAt: new Date()
    };

    // If we have a dup key error, another instance has already tried to run
    // this job.
    try {
      jobHistory._id = self._collection.insert(jobHistory);
    } catch(e) {
      // http://www.mongodb.org/about/contributors/error-codes/
      // 11000 == duplicate key error
      if (e.name === 'MongoError' && e.code === 11000) {
        log.info('SyncedCron: Not running "' + entry.name + '" again.');
        return;
      }

      throw e; 
    };

    // run and record the job
    try {
      log.info('SyncedCron: Starting "' + entry.name + '".');
      var output = entry.job(intendedAt); // <- Run the actual job
  
      log.info('SyncedCron: Finished "' + entry.name + '".');
      self._collection.update({_id: jobHistory._id}, {
        $set: {
          finishedAt: new Date(),
          result: output
        }
      });

      if (entry.purgeLogsAfterDays)
        SyncedCron._purgeEntries(entry.name, entry.purgeLogsAfterDays);
    } catch(e) {
      log.info('SyncedCron: Exception "' + entry.name +'" ' + e.stack);
      self._collection.update({_id: jobHistory._id}, {
        $set: {
          finishedAt: new Date(),
          error: e.stack
        }
      });
    }
  };
}

// remove entries that are older than daysBefore
SyncedCron._purgeEntries = function(name, daysBefore) {
  var beforeDate = new Date;
  beforeDate.setDate(beforeDate.getDate() - daysBefore);
  
  this._collection.remove({name: name, startedAt: {$lte: beforeDate}});
}

// for tests
SyncedCron._reset = function() {
  this._entries = [];
  this._collection.remove({});
}

// ---------------------------------------------------------------------------
// The following two functions are lifted from the later.js package, however
// I've made the following changes:
// - Use Meteor.setTimeout and Meteor.clearTimeout
// - Added an 'intendedAt' parameter to the callback fn that specifies the precise
//   time the callback function *should* be run (so we can co-ordinate jobs)
//   between multiple, potentially laggy and unsynced machines

// From: https://github.com/bunkat/later/blob/master/src/core/setinterval.js
SyncedCron._laterSetInterval = function(fn, sched) {

  var t = SyncedCron._laterSetTimeout(scheduleTimeout, sched),
      done = false;

  /**
  * Executes the specified function and then sets the timeout for the next
  * interval.
  */
  function scheduleTimeout(intendedAt) {
    if(!done) {
      fn(intendedAt);
      t = SyncedCron._laterSetTimeout(scheduleTimeout, sched);
    }
  }

  return {

    /**
    * Clears the timeout.
    */
    clear: function() {
      done = true;
      t.clear();
    }

  };

};

// From: https://github.com/bunkat/later/blob/master/src/core/settimeout.js
SyncedCron._laterSetTimeout = function(fn, sched) {

  var s = Later.schedule(sched), t;
  scheduleTimeout();

  /**
  * Schedules the timeout to occur. If the next occurrence is greater than the
  * max supported delay (2147483647 ms) than we delay for that amount before
  * attempting to schedule the timeout again.
  */
  function scheduleTimeout() {
    var now = Date.now(),
        next = s.next(2, now),
        diff = next[0].getTime() - now,
        intendedAt = next[0];

    // minimum time to fire is one second, use next occurrence instead
    if(diff < 1000) {
      diff = next[1].getTime() - now;
      intendedAt = next[1];
    }

    if(diff < 2147483647) {
      t = Meteor.setTimeout(function() { fn(intendedAt); }, diff);
    }
    else {
      t = Meteor.setTimeout(scheduleTimeout, 2147483647);
    }
  }

  return {

    /**
    * Clears the timeout.
    */
    clear: function() {
      Meteor.clearTimeout(t);
    }

  };

};
// ---------------------------------------------------------------------------