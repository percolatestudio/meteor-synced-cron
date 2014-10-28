/**
 * A package for running jobs synchronized across multiple processes
 * =================================================================
 */

SyncedCron = {
    _entries: {},

    // a .json of all job functions
    _jobs: {},

    options: {
        //Log job run details to console
        log: true,

        //Name of collection to use for synchronisation and logging
        collectionName: 'cronHistory',

        //Name of collection to use for backups of scheduled jobs between server restarts
        collectionNameJobs: 'cronScheduled',

        //Default to using localTime
        utc: false,

        //TTL in seconds for history records in collection to expire
        //NOTE: Unset to remove expiry but ensure you remove the index from
        //mongo by hand
        collectionTTL: 172800
    }
}

Later = Meteor.npmRequire('later');

Meteor.startup(function() {
    var options = SyncedCron.options;

    // Don't allow TTL less than 5 minutes so we don't break synchronization
    var minTTL = 300;

    // Use UTC or localtime for evaluating schedules
    if (options.utc)
        Later.date.UTC();
    else
        Later.date.localTime();

    // collection holding the job history records
    SyncedCron._collection = new Mongo.Collection(options.collectionName);
    SyncedCron._collection._ensureIndex({intendedAt: 1, name: 1}, {unique: true});

    // collection holding the scheduled jobs between server restarts (never expire unless the job is removed)
    SyncedCron._collectionJobs = new Mongo.Collection(options.collectionNameJobs);
    SyncedCron._collectionJobs._ensureIndex({name: 1, schedule: 1, job: 1}, {unique: true});

    if (options.collectionTTL) {
        if (options.collectionTTL > minTTL)
            SyncedCron._collection._ensureIndex({startedAt: 1 },
                { expireAfterSeconds: options.collectionTTL } );
        else
            console.log('Warning: Not going to use a TTL that is shorter than:' + minTTL);
    }
});

var log = {
    info: function(message) {
        if (SyncedCron.options.log)
            console.log(message);
    }
}

/**
 * Add a scheduled job
 * SyncedCron.add({
 *   name: String, //*required* unique name of the job
 *   schedule: function(laterParser) {}, //*required* when to run the job
 *   job: function() {}, //*required* the code to run
 *   jobName: String, //*required* name of the job function
 *   runBack: Boolean, //*required* whether or not the job has to be run if one schedule was skipped
 * });
 * =====================================================================
 */
SyncedCron.add = function(entry) {
    var self = this;

    check(entry.name, String);
    check(entry.schedule, Function);
    check(entry.job, Function);
    check(entry.jobName, String);
    check(entry.runBack, Boolean);

    // check
    self._entries[entry.name] = entry;

    // Schedule the added job with later.js
    var schedule = entry.schedule(Later.parse);

    // Log when the job will run
    log.info('SyncedCron: scheduled "' + entry.name + '" next run @'
        + Later.schedule(schedule).next(1));

    entry._timer = self._laterSetInterval(self._entryWrapper(entry), entry, schedule);

    // New scheduled job => saved it in db for backup
    try {
        self._collectionJobs.insert({
            name: entry.name,
            schedule: schedule,
            jobName: entry.jobName,
            runBack: entry.runBack
        });
    } catch(e) {
        // http://www.mongodb.org/about/contributors/error-codes/
        // 11000 == duplicate key error
        if (e.name === 'MongoError' && e.code === 11000) {
            log.info('SyncedCron: Not saving "' + entry.name + '" in database again.');
            return;
        }
        throw e;
    }
};

/**
 * Check in DB if there already are some scheduled jobs and load them
 * ==================================================================
 */

SyncedCron.start = function(){
    var self = this;
    var entries = self._collectionJobs.find().fetch();

    // Add each entry saved in DB
    _.each(entries, function(entry){

        // Add the scheduled job
        SyncedCron.add({
            name: entry.name,
            schedule: function(parser) {
                // parser is a later.parse object
                return entry.schedule;
            },
            job: function() {
                self._jobs[entry.jobName]();
                return true;
            },
            jobName: entry.jobName,
            runBack: entry.runBack
        });

        // Run it back if needed
        if(entry.runBack){
            var intendedAt = new Date();
            var jobHistory = {
                intendedAt: intendedAt,
                name: entry.name,
                startedAt: intendedAt,
                runBack: true
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
            }

            // run and record the job
            try {
                log.info('SyncedCron: Starting run back "' + entry.name + '".');
                var output = self._jobs[entry.jobName](); // <- Run the actual job

                log.info('SyncedCron: Finished "' + entry.name + '".');
                self._collection.update({_id: jobHistory._id}, {
                    $set: {
                        finishedAt: new Date(),
                        result: output
                    }
                });
            } catch(e) {
                log.info('SyncedCron: Exception "' + entry.name +'" ' + e.stack);
                self._collection.update({_id: jobHistory._id}, {
                    $set: {
                        finishedAt: new Date(),
                        error: e.stack
                    }
                });
            }
        }
        return true;
    })
};

/**
 * Return the next scheduled date of the first matching entry or undefined
 * =======================================================================
 */
SyncedCron.nextScheduledAtDate = function(jobName) {
    var entry = this._entries[jobName];

    if (entry)
        return Later.schedule(entry.schedule(Later.parse)).next(1);
}

/**
 * Remove and stop the entry referenced by jobName
 * ===============================================
 */
SyncedCron.remove = function(jobName) {
    var entry = this._entries[jobName];

    if (entry) {
        if (entry._timer)
            entry._timer.clear();

        delete this._entries[jobName];
        this._collectionJobs.remove({name: jobName});
        log.info('SyncedCron: Removed "' + entry.name);
    }
}


/**
 * Stop processing and remove ALL jobs
 * ===================================
 */
SyncedCron.stop = function() {
    _.each(this._entries, function(entry, name) {
        SyncedCron.remove(name);
    });
    this._collectionJobs.remove({});
}

/**
 * The meat of our logic. Checks if the specified has already run. If not,
 * records that it's running the job, runs it, and records the output
 * =======================================================================
 */

SyncedCron._entryWrapper = function(entry) {
    var self = this;

    return function(intendedAt) {
        var jobHistory = {
            intendedAt: intendedAt,
            name: entry.name,
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

/**
 * For Tests
 * =========
 */
SyncedCron._reset = function() {
    this._entries = {};
    this._collection.remove({});
    this._collectionJobs.remove({});
}

/**
 * The following two functions are lifted from the later.js package, however
 * I've made the following changes:
 * - Use Meteor.setTimeout and Meteor.clearTimeout
 * - Added an 'intendedAt' parameter to the callback fn that specifies the precise
 * time the callback function *should* be run (so we can co-ordinate jobs)
 * between multiple, potentially laggy and unsynced machines
 * ===============================================================================
 */

/**
 * From: https://github.com/bunkat/later/blob/master/src/core/setinterval.js
 * ========================================================================
 */
SyncedCron._laterSetInterval = function(fn, entry, sched) {

    var t = SyncedCron._laterSetTimeout(scheduleTimeout, entry, sched),
        done = false;

    /**
     * Executes the specified function and then sets the timeout for the next
     * interval.
     */

    function scheduleTimeout(intendedAt) {
        if(!done) {
            fn(intendedAt);
            t = SyncedCron._laterSetTimeout(scheduleTimeout, entry, sched);
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

/**
 * From: https://github.com/bunkat/later/blob/master/src/core/settimeout.js
 * ========================================================================
 */
SyncedCron._laterSetTimeout = function(fn, entry, sched) {

    var s = Later.schedule(sched), t;
    scheduleTimeout(entry);

    /**
     * Schedules the timeout to occur. If the next occurrence is greater than the
     * max supported delay (2147483647 ms) than we delay for that amount before
     * attempting to schedule the timeout again.
     * ==========================================================================
     */
    function scheduleTimeout(entry) {
        var now = Date.now(),
            next = s.next(2, now),
            diff = next[0].getTime() - now,
            intendedAt = next[0];

        // minimum time to fire is one second, use next occurrence instead
        if(diff < 1000) {
            if(next[1]){
                diff = next[1].getTime() - now;
                intendedAt = next[1];

                console.log('SyncedCron: scheduled "' + entry.name + '" next run @'
                    + next[1]);
            }
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