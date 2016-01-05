// A package for running jobs synchronized across multiple processes
SyncedCron = {
  _entries: {},
  running: false,
  options: {
    //Log job run details to console
    log: true,

    logger: null,

    //Name of collection to use for synchronisation and logging
    collectionName: 'cronHistory',

    //Default to using UTC
    timezone: 'utc',

    //TTL in seconds for history records in collection to expire
    //NOTE: Unset to remove expiry but ensure you remove the index from
    //mongo by hand
    collectionTTL: 172800
  },
  config: function(opts) {
    this.options = _.extend({}, this.options, opts);
  }
}

Later = Npm.require('later');
tz = Npm.require('timezone');
Later.date.timezone = function(timezone) {
  var _tz;

  // Workaround for UTC which is false
  if (!timezone) {
    timezone = 'Etc/UTC';
  }

  _tz = Npm.require('timezone/' + timezone);
  Later.date.build = function(Y, M, D, h, m, s) {
    return new Date(tz([Y, M + 1, D, h, m, s], _tz, timezone));
  };

  Later.date.getYear = function() {
    return +tz(this, '%Y', _tz, timezone);
  };

  Later.date.getMonth = function() {
    return +tz(this, '%-m', _tz, timezone) - 1;
  };

  Later.date.getDate = function() {
    return +tz(this, '%-d', _tz, timezone);
  };

  Later.date.getDay = function() {
    return +tz(this, '%-w', _tz, timezone);
  };

  Later.date.getHour = function() {
    return +tz(this, '%-H', _tz, timezone);
  };

  Later.date.getMin = function() {
    return +tz(this, '%-M', _tz, timezone);
  };

  Later.date.getSec = function() {
    return +tz(this, '%-S', _tz, timezone);
  };

  return Later.date.isUTC = false;
};

/*
  Logger factory function. Takes a prefix string and options object
  and uses an injected `logger` if provided, else falls back to
  Meteor's `Log` package.

  Will send a log object to the injected logger, on the following form:

    message: String
    level: String (info, warn, error, debug)
    tag: 'SyncedCron'
*/
function createLogger(prefix) {
  check(prefix, String);

  // Return noop if logging is disabled.
  if (SyncedCron.options.log === false) {
    return function() {};
  }

  return function(level, message) {
    check(level, Match.OneOf('info', 'error', 'warn', 'debug'));
    check(message, String);

    var logger = SyncedCron.options && SyncedCron.options.logger;

    if (logger && _.isFunction(logger)) {

      logger({
        level: level,
        message: message,
        tag: prefix
      });

    } else {
      Log[level]({ message: prefix + ': ' + message });
    }
  }
}

var log;

Meteor.startup(function() {
  var options = SyncedCron.options;

  log = createLogger('SyncedCron');

  ['info', 'warn', 'error', 'debug'].forEach(function(level) {
    log[level] = _.partial(log, level);
  });

  // Don't allow TTL less than 5 minutes so we don't break synchronization
  var minTTL = 300;

  // Use UTC or localtime for evaluating schedules
  if (options.timezone === 'utc')
    Later.date.UTC();
  else if (options.timezone === 'localtime') {
    Later.date.localTime();
  } else if (typeof options.timezone === 'function') {
    Later.date.timezone(options.timezone.apply(options))
  } else if (typeof options.timezone === 'string') {
    Later.date.timezone(options.timezone);
  } else {
    Later.date.localTime();
  };

  // collection holding the job history records
  SyncedCron._collection = new Mongo.Collection(options.collectionName);
  SyncedCron._collection._ensureIndex({intendedAt: 1, name: 1}, {unique: true});

  if (options.collectionTTL) {
    if (options.collectionTTL > minTTL)
      SyncedCron._collection._ensureIndex({startedAt: 1 },
        { expireAfterSeconds: options.collectionTTL });
    else
      log.warn('Not going to use a TTL that is shorter than:' + minTTL);
  }
});

var scheduleEntry = function(entry) {
  if (!entry.timezone) {
    // Default timezone to UTC, if not set
    entry.timezone = SyncedCron.options.timezone || 'utc';
  }

  SyncedCron._setTimezone(entry.timezone, entry);
  var schedule = entry.schedule.call(entry.context, Later.parse);
  var scheduleOffset = entry.scheduleOffset || 0;
  entry._timer = SyncedCron._laterSetInterval(SyncedCron._entryWrapper(entry), schedule, scheduleOffset);

  log.info('Scheduled "' + entry.name + '" next run @'
    + new Date(Later.schedule(schedule).next(1).getTime() + scheduleOffset));
}

// add a scheduled job
// SyncedCron.add({
//   name: String, //*required* unique name of the job
//   schedule: function(laterParser) {},//*required* when to run the job
//   job: function() {}, //*required* the code to run
// });
SyncedCron.add = function(entry) {
  check(entry.name, String);
  check(entry.schedule, Function);
  check(entry.job, Function);
  entry.context = typeof entry.context === 'object' ? entry.context : {};
  entry.timezone = typeof entry.timezone === 'string' || typeof entry.timezone === 'function' ? entry.timezone : null;

  // check
  if (!this._entries[entry.name]) {
    this._entries[entry.name] = entry;

    // If cron is already running, start directly.
    if (this.running) {
      scheduleEntry(entry);
    }
  }
}

// Start processing added jobs
SyncedCron.start = function() {
  var self = this;

  Meteor.startup(function() {
    // Schedule each job with later.js
    _.each(self._entries, function(entry) {
      scheduleEntry(entry);
    });

    self.running = true;
  });
}

// Return the next scheduled date of the first matching entry or undefined
SyncedCron.nextScheduledAtDate = function(jobName) {
  var entry = this._entries[jobName];
  var scheduleOffset = entry.scheduleOffset || 0;
  if (entry)
    this._setTimezone(entry.timezone, entry);
  return new Date(Later.schedule(entry.schedule(Later.parse)).next(1).getTime() + scheduleOffset);
}

// Remove and stop the entry referenced by jobName
SyncedCron.remove = function(jobName) {
  var entry = this._entries[jobName];

  if (entry) {
    if (entry._timer)
      entry._timer.clear();

    delete this._entries[jobName];
    log.info('Removed "' + entry.name + '"');
  }
}

// Pause processing, but do not remove jobs so that the start method will
// restart existing jobs
SyncedCron.pause = function() {
  if (this.running) {
    _.each(this._entries, function(entry) {
      entry._timer.clear();
    });

    this.running = false;
  }
}

// Stop processing and remove ALL jobs
SyncedCron.stop = function() {
  _.each(this._entries, function(entry, name) {
    SyncedCron.remove(name);
  });

  this.running = false;
}

SyncedCron._setTimezone = function(timezone, entry) {
  if (timezone === 'utc')
    Later.date.UTC();
  else if (timezone === 'localtime') {
    Later.date.localTime();
  } else if (typeof timezone === 'function'){
    Later.date.timezone(timezone.apply(entry.context))
  } else if (typeof timezone === 'string') {
    Later.date.timezone(timezone);
  } else {
    Later.date.localTime();
  };
};

// The meat of our logic. Checks if the specified has already run. If not,
// records that it's running the job, runs it, and records the output
SyncedCron._entryWrapper = function(entry) {
  var self = this;

  return function(intendedAt) {
    intendedAt = new Date(intendedAt.getTime());
    intendedAt.setMilliseconds(0);

    var jobHistory = {
      intendedAt: intendedAt,
      name: entry.name,
      startedAt: new Date()
    };

    // If we have a dup key error, another instance has already tried to run
    // this job.
    try {
      jobHistory._id = self._collection.insert(jobHistory);
    } catch (e) {
      // http://www.mongodb.org/about/contributors/error-codes/
      // 11000 == duplicate key error
      if (e.name === 'MongoError' && e.code === 11000) {
        log.info('Not running "' + entry.name + '" again.');
        return;
      }

      throw e;
    };

    // run and record the job
    try {
      log.info('Starting "' + entry.name + '".');
      var output = entry.job.call(entry.context, intendedAt); // <- Run the actual job

      log.info('Finished "' + entry.name + '".');
      self._collection.update({_id: jobHistory._id}, {
        $set: {
          finishedAt: new Date(),
          result: output
        }
      });
    } catch (e) {
      log.info('Exception "' + entry.name +'" ' + e.stack);
      self._collection.update({_id: jobHistory._id}, {
        $set: {
          finishedAt: new Date(),
          error: e.stack
        }
      });
    }
  };
}

// for tests
SyncedCron._reset = function() {
  this._entries = {};
  this._collection.remove({});
  this.running = false;
}

// ---------------------------------------------------------------------------
// The following two functions are lifted from the later.js package, however
// I've made the following changes:
// - Use Meteor.setTimeout and Meteor.clearTimeout
// - Added an 'intendedAt' parameter to the callback fn that specifies the precise
//   time the callback function *should* be run (so we can co-ordinate jobs)
//   between multiple, potentially laggy and unsynced machines

// From: https://github.com/bunkat/later/blob/master/src/core/setinterval.js
SyncedCron._laterSetInterval = function(fn, sched, scheduleOffset) {

  var t = SyncedCron._laterSetTimeout(scheduleTimeout, sched, scheduleOffset),
      done = false;

  /**
  * Executes the specified function and then sets the timeout for the next
  * interval.
  */
  function scheduleTimeout(intendedAt) {
    if (!done) {
      fn(intendedAt);
      t = SyncedCron._laterSetTimeout(scheduleTimeout, sched, scheduleOffset);
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
SyncedCron._laterSetTimeout = function(fn, sched, scheduleOffset) {

  var s = Later.schedule(sched), t;
  scheduleTimeout();

  /**
  * Schedules the timeout to occur. If the next occurrence is greater than the
  * max supported delay (2147483647 ms) than we delay for that amount before
  * attempting to schedule the timeout again.
  */
  function scheduleTimeout() {
    // Get current Date, adjusting for timezone offset
    var now = Date.now() - scheduleOffset,
        next = s.next(2, now);

    // don't schedlue another occurence if no more exist synced-cron#41
    if (! next[0])
      return;

    var diff = next[0].getTime() - now,
        intendedAt = next[0];

    // minimum time to fire is one second, use next occurrence instead
    if (diff < 1000) {
      diff = next[1].getTime() - now;
      intendedAt = next[1];
    }

    if (diff < 2147483647) {
      t = Meteor.setTimeout(function() { fn(intendedAt); }, diff);
    } else {
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
