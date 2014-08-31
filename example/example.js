if (Meteor.isClient) {
  Template.hello.greeting = function () {
    return "Welcome to example.";
  };

  Template.hello.events({
    'click input': function () {
      // template data, if any, is available in 'this'
      if (typeof console !== 'undefined')
        console.log("You pressed the button");
    }
  });
}

if (Meteor.isServer) {
  SyncedCron.add({
    name: 'Crunch some important numbers for the marketing department',
    schedule: function(parser) {
      // parser is a later.parse object
      return parser.text('every 5 seconds');
    }, 
    job: function() {
      console.log('crunching numbers')
    }
  });
  
  Meteor.startup(function () {
    // code to run on server at startup
    SyncedCron.start();
  });
}
