import fs from "fs";
import cp from "child_process";
import path from "path";
import util from "util";
import debug from "debug";
import chokidar from "chokidar";
import rimraf from "rimraf";
import mkdirp from "mkdirp";
import Koa from "koa";
import serve from "koa-static";
import route from "koa-route";
import options from "./config";

const rm = util.promisify(rimraf);
const mkdir = util.promisify(mkdirp);

const exec = util.promisify(cp.exec);

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

const log = debug("streaming:log");
const error = debug("streaming:err");

function seconds(time) {
  return {
    get milliseconds() { return time * 1000; },
    get microseconds() { return time * 1000000; },
    get nanoseconds() { return time * 1000000000; },
    get ms() { return time * 1000; },
    get μs() { return time * 1000000; },
    get ns() { return time * 1000000000; }
  };
}

function duration(time) {
  return `PT${time}S`;
}

function tag(name, attributes, children) {
  return [name, attributes, children];
}

function renderAttributes(attributes) {
  const list = [];
  for (const name in attributes) {
    const value = attributes[name];
    if (value !== undefined) {
      list.push(`${name}="${value}"`);
    }
  }
  if (list.length > 0) {
    return ` ${list.join(" ")}`;
  }
  return "";
}

function renderToString([name, attributes, children]) {
  if (!children) {
    return `<${name}${renderAttributes(attributes)}/>`;
  }
  return `<${name}${renderAttributes(attributes)}>${children.map(renderToString)}</${name}>`;
}

function watcher(template) {
  const pattern = `${path.dirname(template)}/*${path.extname(template)}`;
  return new Promise((resolve, reject) => {
    const watcher = chokidar.watch(pattern);
    watcher.on("add", (filePath) => {
      if (filePath === template.replace("%d", 10000)) {
        log(`File ${template.replace("%d", 0)} is ready`);
        watcher.close();
        resolve(template.replace("%d", 0));
      }
    });
    watcher.on("error", (err) => {
      error(err);
      watcher.close();
      reject(err);
    });
  });
}

function mp4info(filePath) {
  return exec(`mp4info ${filePath} --format json`).then(({ stdout, stderr }) => {
    return JSON.parse(stdout.toString("utf-8"));
  });
}

function gstparameters(parameters, sep = " ") {
  const list = [];
  for (const name in parameters) {
    const value = parameters[name];
    list.push(`${name}=${value}`);
  }
  return list.join(sep);
}

function gstcaps(name, parameters) {
  return `${name},${gstparameters(parameters, ",")}`;
}

function gstplugin(name, parameters) {
  return `${name} ${gstparameters(parameters)}`;
}

function gstreamer(pipeline, { appName } = { appName: "gst-launch-1.0" }) {
  const plugins = pipeline.join(" ! ");
  const command = `${appName} ${plugins}`;
  log(`GStreamer started with command ${command}`)
  const child = cp.exec(command);
  child.stdout.on("data", (data) => {
    log(data.toString("utf-8"));
  });
  child.stderr.on("data", (data) => {
    error(data.toString("utf-8"));
  });
  child.on("error", (err) => {
    error(err);
  });
  child.on("exit", (code, signal) => {
    log(`GStreamer exit with code ${code}`);
  });
  return Promise.resolve(child);
}

function live() {
  const command = `./live`;
  log(`Live started with command ${command}`)
  const child = cp.exec(command);
  child.stdout.on("data", (data) => {
    log(data.toString("utf-8"));
  });
  child.stderr.on("data", (data) => {
    error(data.toString("utf-8"));
  });
  child.on("error", (err) => {
    error(err);
  });
  child.on("exit", (code, signal) => {
    log(`GStreamer exit with code ${code}`);
  });
  return Promise.resolve(child);
}

function mpd(props) {
  const periods = props.mpd.periods.map((period) => {
    const adaptationSets = period.adaptationSets.map((adaptationSet) => {
      const representations = adaptationSet.representations.map((representation) => {
        const ss = representation.segmentTemplate.segmentTimeline.map((s) => {
          return (
            tag("S", { t: s.time, d: s.duration, r: s.quantity })
          );
        });
        return (
          tag("Representation", {
            id: representation.id,
            width: representation.width,
            height: representation.height,
            bandwidth: representation.bandwidth
          }, [
            tag("SegmentTemplate", {
              //startNumber: representation.segmentTemplate.startNumber,
              media: representation.segmentTemplate.media,
            }),
            tag("SegmentTimeline", {}, ss)
          ])
        );
      });
      return (
        tag("AdaptationSet", {
          id: adaptationSet.id,
          mimeType: adaptationSet.mimeType,
          codecs: adaptationSet.codecs,
          frameRate: adaptationSet.frameRate,
          segmentAlignment: adaptationSet.segmentAlignment,
        }, [
          tag("SegmentTemplate", {
            duration: adaptationSet.representations[0].segmentTemplate.duration,
            timescale: adaptationSet.representations[0].segmentTemplate.timescale,
          }),
          ...representations
        ])
      );
    });
    return (
      tag("Period", {
        id: period.id,
        start: duration(period.start),
      }, adaptationSets)
    );
  });
  return (
    tag("MPD", {
      xmlns: "urn:mpeg:dash:schema:mpd:2011",
      type: props.mpd.type,
      profiles: props.mpd.profiles.join(","),
      publishTime: props.mpd.publishTime.toISOString(),
      availabilityStartTime: props.mpd.availabilityStartTime.toISOString(),
      //minimumUpdatePeriod: duration(props.mpd.minimumUpdatePeriod),
      minBufferTime: duration(props.mpd.minBufferTime),
      suggestedPresentationDelay: duration(props.mpd.suggestedPresentationDelay),
    }, [
      tag("UTCTiming", {
        schemeIdUri: "urn:mpeg:dash:utc:http-head:2014",
        value: "https://vm2.dashif.org/dash/time.txt"
      }),
      ...periods
    ])
  );
}

function mpdwrite(options) {
  writeFile(options.mpd.output,renderToString(mpd(options)));
}

function mpdbuilder(options) {
  mpd.availabilityStartTime = new Date();

  if (options.mpd.type === "dynamic") {
    mpdwrite(options);
    return Promise.resolve(setInterval(() => {
      const {
        mpd,
        mpd: {
          availabilityStartTime,
          timeShiftBufferDepth,
          suggestedPresentationDelay,
          periods: [{
            adaptationSets: [{
              representations: [{
                segmentTemplate: {
                  segmentTimeline: [{
                    time, duration: segmentDuration
                  }]
                }
              }]
            }]
          }]
        }
      } = options;

      // updates
      mpd.publishTime = new Date();

      const currentTime = new Date();
      const deltaTime = currentTime.getTime() - mpd.availabilityStartTime.getTime();

      const startNumber = Math.max(0, Math.floor((deltaTime - seconds(timeShiftBufferDepth).ms) / segmentDuration));
      const initialNumber = Math.max(0, Math.floor((deltaTime - seconds(suggestedPresentationDelay).ms) / segmentDuration));
      const newQuantity = Math.floor(deltaTime / segmentDuration);
      const newTime = initialNumber * segmentDuration;

      mpd.periods[0].duration = deltaTime;
      mpd.periods[0].adaptationSets[0].representations[0].segmentTemplate.startNumber = startNumber;
      mpd.periods[0].adaptationSets[0].representations[0].segmentTemplate.segmentTimeline[0].time = newTime;
      mpd.periods[0].adaptationSets[0].representations[0].segmentTemplate.segmentTimeline[0].quantity = newQuantity;

      mpdwrite(options);
    }, seconds(options.mpd.minimumUpdatePeriod).ms));
  }
  mpdwrite(options);
  return Promise.resolve();
}


function httpserver() {
  return new Promise((resolve, reject) => {
    const app = new Koa();
    app.use(async function(ctx, next) {
      await next();
      if (ctx.url.toLowerCase().includes(".mpd")) {
        ctx.type = "application/dash+xml";
      }
    });
    app.use(serve(path.resolve(__dirname, "..", path.dirname(options.segment.template))));
    app.use(route.get("/", async (ctx) => {
      ctx.type = "text/html";
      ctx.body = await readFile("src/index.html");
    }));
    return app.listen(3000);
  });
}

function prepare() {
  if (options.serveOnly) {
    return Promise.resolve();
  }
  const pattern = `${path.dirname(options.segment.template)}/*.{${path.extname(options.segment.template).substr(1)},mpd}`;
  log(`Clearing ${pattern}`);
  return rm(pattern).then(() => {
    return mkdir(path.dirname(options.segment.template));
  });
}

prepare().then(() => {
  if (options.serveOnly) {
    return httpserver();
  }
  return live();
  return gstreamer([
    /*gstplugin("filesrc", {
      location: "movies/Sintel.2010.720p.mkv"
    }),*/
    gstplugin("videotestsrc", {
      "is-live": true
    }),
    //gstplugin("decodebin"),
    gstplugin("vtenc_h264"),
    /*gstplugin("x264enc", {
      "tune": "zerolatency",
      "speed-preset": "veryfast"
    }),*/
    gstplugin("splitmuxsink", {
      "muxer": gstplugin("mp4mux", {
        "faststart": true,
        "streamable": true,
        "fragment-duration": seconds(options.segment.duration).ms,
        "movie-timescale": options.timescale,
        "trak-timescale": options.timescale
      }).replace(/^|$/g, "'"),
      "max-size-time": seconds(options.segment.duration).ns,
      "location": options.segment.template
    })
  ])
}).then((gstreamer) => {
  log(`Watching media files ${options.segment.template}`);
  return watcher(options.segment.template);
}).then((filePath) => {
  log(`Extracting info form ${filePath}`);
  return mp4info(filePath);
}).then((videoInfo) => {
  const {
    tracks: [
      {
        media: {
          bitrate,
          duration_with_fragments: duration
        },
        sample_descriptions: [
          {
            codecs_string: codecsString,
            width,
            height,
            depth
          }
        ],
        frame_rate: frameRate
      }
    ]
  } = videoInfo;

  log("Data");
  log(`- Codecs: ${codecsString}`);
  log(`- Bitrate: ${bitrate}`);
  log(`- Width: ${width}`);
  log(`- Height: ${height}`);
  log(`- Frame rate: ${frameRate}`);
  options.mpd.periods.push({
    id: 0,
    start: 0,
    duration: 0,
    adaptationSets: [
      {
        id: 0,
        mimeType: "video/mp4",
        frameRate: frameRate,
        codecs: codecsString,
        segmentAlignment: options.segment.alignment,
        representations: [
          {
            id: 0,
            width: width,
            height: height,
            bandwidth: bitrate * 1000,
            segmentTemplate: {
              startNumber: 0,
              duration: duration,
              media: path.basename(options.segment.template.replace("%d", "$Time$")),
              timescale: options.timescale,
              segmentTimeline: [
                {
                  time: 0,
                  duration: duration,
                  quantity: 0
                }
              ]
            }
          }
        ]
      }
    ]
  });

  return mpdbuilder(options);
}).then(() => {
  return httpserver();
});
