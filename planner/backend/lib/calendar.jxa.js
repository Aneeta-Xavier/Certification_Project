// JXA script run via `osascript -l JavaScript`. Reads Calendar.app events in a
// date range and prints them as JSON. Args: <from ISO date> <to ISO date>.
// The first run triggers the macOS "wants access to control Calendar" prompt;
// once granted to this node/osascript, later runs are silent.
function run(argv) {
  var fromStr = argv[0], toStr = argv[1];
  var from = new Date(fromStr + "T00:00:00");
  var to = new Date(toStr + "T23:59:59");
  var Cal = Application("Calendar");
  var out = [];
  var cals = Cal.calendars();
  for (var c = 0; c < cals.length; c++) {
    var cal = cals[c];
    var name;
    try { name = cal.name(); } catch (e) { name = ""; }
    var evs;
    try {
      evs = cal.events.whose({
        _and: [
          { startDate: { _greaterThan: from } },
          { startDate: { _lessThan: to } }
        ]
      })();
    } catch (e) { continue; }
    for (var i = 0; i < evs.length; i++) {
      try {
        out.push({
          title: evs[i].summary(),
          start: evs[i].startDate().toISOString(),
          end: evs[i].endDate().toISOString(),
          allday: evs[i].alldayEvent(),
          calendar: name
        });
      } catch (e) {}
    }
  }
  out.sort(function (a, b) { return a.start < b.start ? -1 : 1; });
  return JSON.stringify(out);
}
