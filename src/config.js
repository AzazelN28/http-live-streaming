const Profiles = {
  FULL: "urn:mpeg:dash:profile:full:2011",
  LIVE: "urn:mpeg:dash:profile:isoff-live:2011",
  DASH264: "urn:com:dashif:dash264"
};

const Type = {
  STATIC: "static",
  DYNAMIC: "dynamic"
};

const options = {
  serveOnly: false,
  timescale: 1000,
  fragment: {
    duration: 1
  },
  segment: {
    alignment: false,
    duration: 5,
    template: "media/live_%d.mp4"
  },
  mpd: {
    output: "media/live.mpd",
    type: Type.DYNAMIC,
    profiles: [
      Profiles.LIVE,
      Profiles.DASH264
    ],
    publishTime: new Date(),
    availabilityStartTime: new Date(),
    timeShiftBufferDepth: 14400,
    minBufferTime: 10,
    minimumUpdatePeriod: 5,
    suggestedPresentationDelay: 20,
    periods: []
  }
};

export default options;
