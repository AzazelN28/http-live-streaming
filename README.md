# DASH Live Streaming

There are multiple technologies involved in live streaming using DASH (DASH stands for Dynamic Adaptive Streaming over HTTP).

1. **MSE (Media Source Extensions)**: this is the browser part that allows us to create an sliding window buffer from chunks of video. There are a lot of libraries that handle this part for us, for example: **dash.js** or **Shaka Player**.
2. **ISO BMFF (usually known just as MPEG4), Matroska, x264, x265, vp8, vp9, Vorbis y Opus**: All of these codecs can be used to encode/decode the video into chunks (but there are some incompatibilities between browsers). There are a lot of tools that allows us to create these chunks using these codecs: **ffmpeg**, **gstreamer**, **dashencoder**, **Shaka Packager**, **DashCast**, **MP4Box**, etc.
3. **MPD (Media Presentation Document)**: this part belongs to DASH and allows us to define how the chunks are, what they contain and how they can be consumed depending on network bandwidth, language or screen properties.

As you can see in the section 4 (page 49) of the [last specification of DASH](http://dashif.org/wp-content/uploads/2017/09/DASH-IF-IOP-v4.1-clean.pdf) published to date.
There are three possible live streaming scenearios:

- **Dynamic Distribution of Available Content**: Services, for which content is made available as dynamic content, but the content is entirely generated prior to distribution. In this case the details of the Media Presentation, especially the Segments (duration, URLs) are known and can be announced in a single MPD without MPD updates. This addresses use cases 2 and 3 in Annex B.
- **MPD-controlled Live Service**: Services for which the content is typically generated on the fly, and the MPD needs to be updated occasionally to reflect changes in the service offerings. For such a service, the DASH client operates solely on information in the MPD. This addresses the use cases 4 and 5 in Annex B.
- **MPD and Segment-controlled Live**: Services for which the content is typically generated on the fly, and the MPD may need to be updated on short notice to eflect changes in the service offerings. For such a service, the DASH client operates on information in the MPD and is expected to parse segments to extract relevant information for proper operation. This addresses the use cases 4 and 5, but also takes into account the advanced use cases.

For each of these three cases, three possible solutions are considered:

- **Dynamic Segment Download**: all content is generated in advance but is considered _live_.
- **Simple Live Client**: the content is generated on the fly but only the **MPD** is used as a reliable source of the _streaming_ data.
- **Main Live Client**: the content is generated on the fly and uses both the data from the **MPD** and the data contained in the segments that are streamed during the _streaming_. This is the most complete profile and allows to obtain not only metadata of the segments as duration or current time, but also to add events (Inband Events) within the `mp4`. This is the worst supported one.

## ¿What is an MPD and how I can serve it?

An MPD is an XML file that contains information (metadata) about the video and audio segments and the different configurations and options that can be found when playing the _stream_ (languages, subtitles, different resolutions and formats, etc).

> IMPORTANT: To serve MPD correctly it is necessary that the server can serve the files `*.mpd` with the `Content-Type` as `application/dash+xml`.

For _live streaming_ the `type` value of the MPD must be `dynamic` (even when parameters like `minimumUpdatePeriod` are not included).

> NOTE: It may happen that we are watching a video segment of a camera that is not recording new content, in this case as the content is already recorded and there is no _live edge_ instead of serving an MPD _live_ we can serve an MPD _on-demand_ (we only need to change the `profiles`, the `type` and delete the element ``<UTCTiming>`).

> NOTE: The most important parameters regarding the `<AdaptationSet>` are `timescale`, `mimeType` and `codecs`. In my case I used `mp4info` to get many of these parameters.

### Example

```xml
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="dynamic" profiles="urn:mpeg:dash:profile:isoff-live:2011,urn:com:dashif:dash264" publishTime="2018-01-20T03:30:28.756Z" availabilityStartTime="2018-01-20T03:17:26.269Z" minBufferTime="PT10S" suggestedPresentationDelay="PT20S">
  <!-- This is very important when synchronizing a live streaming, you can use your own endpoint to return the current server timestamp in UTC. -->
  <UTCTiming schemeIdUri="urn:mpeg:dash:utc:http-head:2014" value="https://vm2.dashif.org/dash/time.txt"/>
  <Period id="0" start="PT0S">
    <AdaptationSet id="0" mimeType="video/mp4" codecs="avc1.4D400D" segmentAlignment="true">
      <SegmentTemplate duration="5000" timescale="1000"/>
      <Representation id="0" width="320" height="240" bandwidth="763333">
        <SegmentTemplate startNumber="0" media="live_$Number$.mp4"/>
        <SegmentTimeline>
          <!-- Thanks to SegmentTimeline we can give more information to the client about how many chunks are available `r`, their duration `d` and the recommended time of the most recent `t` chunk. -->
          <S t="760000" d="5000" r="156"/>
          <!-- Another advantage of using SegmentTimeline is that multiple `S` segments can be used to indicate stream discontinuities -->
        </SegmentTimeline>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>
```

To obtain some parameters it is possible to use a tool provided by the [bento4 toolkit](https://www.bento4.com/developers/dash/) called `mp4info`.

```sh
mp4info --format json media/live_0.mp4
```

> NOTE: It is not necessary that the file is completely generated to make this call, with at least the `moov`, `mvhd`, `trak` and `moof` headers generated is sufficient. However, it must be a fragmented MP4.

Using Node.JS:

```js
const cp = require("child_process");
const util = require("util");

const exec = util.promisify(cp.exec);

function mp4info(filePath) {
  return exec(`mp4info --format json ${filePath}`).then(({ stdout, stderr }) => {
    return JSON.parse(stdout.toString("utf-8"));
  });
}

mp4info(filePath).then((videoInfo) => {
  // Destructuring used to obtain the necessary key parts
  // to generate the MP4.
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
            height
          }
        ],
        frame_rate: frameRate
      }
    ]
  } = videoInfo;

  // Here we will have the following variables defined:
  // bitrate, duration, codecsString, width, height, frameRate

  // NOTE: `duration` is really important because it returns the duration with the fragments and the current timescale.

  // NOTE: Sometimes `frameRate` is not available because it is variable but no problem as long as the duration of the segment is the same. This can be forced by using a fixed GOP in the h264 coding.
```

This example uses as a template `live_$Number$.mp4`, however as discussed in the article[Stop numbering: The underappreciated power of DASH's SegmentTimeline](http://www.unified-streaming.com/blog/stop-numbering-underappreciated-power-dashs-segmenttimeline) a better alternative to this is to use as an `average` parameter of the `SegmentTemplate` a version with time: `live_$Time$.mp4`. However `gstreamer` does not offer the possibility to print the time on our chunks directly from `gst-launch-1.0` but we can still use the API they offer to make a C program that does it for us:

```c
#include <gst/gst.h>
#include <glib.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>

#define SECOND_IN_NANOSECONDS(x) ((unsigned long)x * 1000000000)
#define SECOND_IN_MICROSECONDS(x) ((unsigned long)x * 1000000)
#define SECOND_IN_MILLISECONDS(x) ((unsigned long)x * 1000)

static unsigned long timescale = 90000;

static unsigned long start = 0;

static gboolean bus_call(GstBus* bus, GstMessage* msg, gpointer data) {
  GMainLoop* loop = (GMainLoop*)data;

  switch (GST_MESSAGE_TYPE (msg)) {
    case GST_MESSAGE_EOS:
      g_printerr("End of stream\n");
      g_main_loop_quit(loop);
      break;

    case GST_MESSAGE_ERROR: {
      gchar  *debug;
      GError *error;

      gst_message_parse_error (msg, &error, &debug);
      g_free (debug);

      g_printerr("Error %s\n", error->message);
      g_error_free(error);

      g_main_loop_quit(loop);
      break;
    }
    default:
      break;
  }

  return TRUE;
}

static gchar* on_format_location(GstElement* splitmux, guint fragment_id, gpointer user_data) {
  // NOTE: This is freed automatically by GST.
  gchar* fragment_name = (gchar*)malloc(1024);

  // This is automatically freed because it is a local variable.
  char cwd[1024];
  if (getcwd(cwd, sizeof(cwd)) != NULL) {
    unsigned long current = time(NULL);
    if (start == 0) {
      start = current;
    }
    unsigned long delta = (current - start) * timescale;
    sprintf(fragment_name, "%s/media/live_%lu.m4s", cwd, delta);
    g_printerr("Fragment: %s\n", fragment_name);
    g_print("%lu\n", delta);
    return fragment_name;
  }
  return NULL;
}

int main(int argc, char** argv) {
  GMainLoop* loop;

  GstElement *pipeline, *source, *encoder, *muxer, *muxsink;
  GstBus *bus;

  guint bus_watch_id;

  gst_init(&argc, &argv);

  loop = g_main_loop_new(NULL, FALSE);

  /*if (argc != 1) {
    g_printerr("Usage: %s\n", argv[0]);
    return -1;
  }*/

  pipeline = gst_pipeline_new ("dash");
  source = gst_element_factory_make ("v4l2src", "source");
  encoder = gst_element_factory_make ("x264enc", "encoder");
  muxer = gst_element_factory_make ("mp4mux", "muxer");
  muxsink = gst_element_factory_make ("splitmuxsink", "muxsink");

  if (!pipeline || !source || !encoder || !muxsink) {
    g_printerr("Error creating pipeline\n");
    return -1;
  }

  g_object_set(G_OBJECT(encoder), "tune", 0x00000004, NULL);
  g_object_set(G_OBJECT(encoder), "speed-preset", 0x00000001, NULL);
  g_object_set(G_OBJECT(encoder), "bitrate", 1000, NULL);

  g_object_set(G_OBJECT(muxer), "faststart", TRUE, NULL);
  g_object_set(G_OBJECT(muxer), "streamable", TRUE, NULL);
  g_object_set(G_OBJECT(muxer), "presentation-time", TRUE, NULL);
  g_object_set(G_OBJECT(muxer), "movie-timescale", timescale, NULL);
  g_object_set(G_OBJECT(muxer), "trak-timescale", timescale, NULL);
  g_object_set(G_OBJECT(muxer), "fragment-duration", SECOND_IN_MILLISECONDS(1), NULL);

  //g_object_set(G_OBJECT(muxsink), "location", "media/hello_%04d.m4s", NULL);
  g_object_set(G_OBJECT(muxsink), "muxer", muxer, NULL);
  g_object_set(G_OBJECT(muxsink), "max-size-time", SECOND_IN_NANOSECONDS(10), NULL);

  bus = gst_pipeline_get_bus (GST_PIPELINE(pipeline));
  bus_watch_id = gst_bus_add_watch(bus, bus_call, loop);
  gst_object_unref(bus);

  gst_bin_add_many(GST_BIN(pipeline), source, encoder, muxsink, NULL);

  gst_element_link_many(source, encoder, muxsink, NULL);
  g_signal_connect(muxsink, "format-location", G_CALLBACK(on_format_location), NULL);

  g_printerr("Now recording\n");
  gst_element_set_state(pipeline, GST_STATE_PLAYING);

  g_printerr("Running\n");
  g_main_loop_run(loop);

  g_printerr("Exited\n");
  gst_element_set_state(pipeline, GST_STATE_NULL);

  g_printerr("Clearing\n");
  gst_object_unref(GST_OBJECT(pipeline));
  g_source_remove(bus_watch_id);
  g_main_loop_unref(loop);

  return 0;
}
```

## ¿How to assign parameters to the MPD?

There are three key parameters for live streaming.

- **minBufferTime**: Indicates the minimum buffer size for continuous playback of the broadcast.
- **suggestedPresentationDelay**: Indicates what the offset between the _live edge_ and the minimum time we store in the buffer should be.
- **timeShiftBufferDepth**: Indicates the maximum amount of time we can rewind a live broadcast. IMPORTANT: Not necessary if chunks are to be kept permanently stored.

They should always be assigned this way:

```
minBufferTime < suggestedPresentationDelay < timeShiftBufferDepth
```

One way to set the **minBufferTime** is to use a value at least two or three times greater than the average time it takes between sending a request to download a chunk and the time it takes to fully receive that chunk.

Por otra parte **suggestedPresentationDelay** siempre debería ser cómo mínimo **minBufferTime** más dos veces el tiempo medio que se tarda en **procesar** y **almacenar** un chunk.

## Do I need to have a `minimumUpdatePeriod` for live streaming?

No, `minimumUpdatePeriod` is useful to update the MPD on the fly in case any of the chunks or segments parameters change. If these do not change or the _streaming_ is continuous, there is no need to update this document.

## Why isn't the time displayed correctly in _live streaming_?

By default, when the length of a _stream_ is not known, programs like `gstreamer` or `ffmpeg` write in the `mvhd` header of the container that the duration is 0 (0x000000000000) or 4294967295 (0xFFFFFFFFFF) to indicate that the duration is unknown. As indicated in the W3C documentation on Media Timelines, it is possible that segments may be able to rewrite the duration of a _stream_ on the fly causing a `durationchange` event. However, if this is not possible, Shaka Player has an alternative, we can call the `getSegmentAvailabilityEnd` function of `PresentationTimeline` of `Manifest`.

```js
const player = new shaka.Player(video);

player.addEventListener("streaming", () => {
  player.getManifest();
});

video.addEventListener("timeupdate", (e) => {
  // Current time (relative to the start of playback).
  videoCurrentTime = e.target.currentTime;
  // A much better way to get the current time (and date).
  videoCurrentDate = player.getPlayheadTimeAsDate();
  // Date on which playback began.
  videoStartDate = player.getPresentationStartTimeAsDate();
  // Time we can move forward and backward.
  videoSeekRange = player.seekRange();
  // Duration of our stream.
  videoDuration = player.getManifest().getPresentationTimeline().getSegmentAvailabilityEnd();
});

// We load the manifest.
player.load("http://localhost:4000/live.mpd");
```

## How to represent the available time we can jump to for our _live streaming_?

Shaka Player has a feature called `seekRange` that allows us to get from what point to what point we can perform _seeking_ in the video. Normally in a live broadcast the `duration` field of a `<video>` element is 0xFFFFFFFFFF or in other words, 4294967295. If we get this value in the duration of a video we will know that this is a live broadcast and we will also know that normally the duration of this video will be from the beginning of the recording to the present moment.

## Generating MSE-valid chunks

By default in all these commands the value `speed-preset` is used as `speed-preset`, however it has been proved that even `medium` videos generate a `codec string` valid for MSE. As you can see in the `x264enc` documentation for `gstreamer`, the `speed-preset` parameter can affect the `playback compatibility` (https://gstreamer.freedesktop.org/data/doc/gstreamer/head/gst-plugins-ugly-plugins/html/gst-plugins-ugly-plugins-x264enc.html#GstX264Enc--speed-preset)

| Resolution | Recommended bitrate |
|:----------:|:-------------------:|
| 480p       | 1200 ~ 2000         |
| 720p       | 2400 ~ 4000         |
| 1080p      | 4800 ~ 8000         |

> NOTE: The `max-size-time` parameter of `mp4mux` accepts values in nanoseconds (1/1.000.000.000.000 seconds).

> NOTE: All of these commands generate _fragmented MP4s_, which are fully necessary to ensure better MSE playback.

### Recording from a test source

```sh
gst-launch-1.0 videotestsrc is-live=true ! queue ! x264enc tune=zerolatency speed-preset=ultrafast bitrate=1000 key-int-max=100 ! splitmuxsink muxer='mp4mux faststart=true streamable=true fragment-duration=1000 trak-timescale=1000 movie-timescale=1000 presentation-time=true' max-size-time=1000000000 location=media/live_%d.mp4
```

### Recording from a webcam (Linux)

```sh
gst-launch-1.0 v4l2src ! queue ! x264enc tune=zerolatency speed-preset=ultrafast bitrate=2400 key-int-max=100 ! splitmuxsink muxer='mp4mux faststart=true streamable=true fragment-duration=1000 trak-timescale=1000 movie-timescale=1000 presentation-time=true' max-size-time=1000000000 location=media/live_%d.mp4
```

### Recording from the desktop (Linux)

```sh
gst-launch-1.0 ximagesrc ! queue ! x264enc tune=zerolatency speed-preset=ultrafast bitrate=3600 key-int-max=100 ! splitmuxsink muxer='mp4mux faststart=true streamable=true fragment-duration=1000 trak-timescale=1000 movie-timescale=1000 presentation-time=true' max-size-time=1000000000 location=media/live_%d.mp4
```

## Problems

### The MPD loads without problems, however when loading the first chunk I get a 3014 error (failed fetch and append: code=3014) What is the problem?

Versions older than `1.11.1` of `mp4mux` and `gstreamer` generate erroneous `mp4` files missing the _box_ `tfdt` inside the first `traf`. As indicated in the W3C recommendation[MSE ISO BMFF Byte Stream Format] (https://www.w3.org/TR/mse-byte-stream-format-isobmff/#iso-media-segments):

> The user agent must run the append error algorithm if any of the following conditions are met:
> ...
> 6. At least one Track Fragment Box does not contain a Track Fragment Decode Time Box (tfdt)
> ...

### When I try to play the stream I get a 3016 error

This error is usually related to codecs. Some[profiles](http://blog.mediacoderhq.com/h264-profiles-and-levels/) (like _Baseline_ or _Main_) are more compatible than others, h.264 is a really complex codec that has dozens of options and settings, some players can implement only some of these features, so profiles can be more or less compatible.

Try reducing the profile of _mp4_ to _Main_. With utilities like[h264bitstream](https://github.com/aizvorski/h264bitstream) you can analyze the NALUs of the h.264 stream and see what features are enabled or disabled. You can also use the PPS and SPS lines of utilities like[mp4info](https://www.bento4.com/developers/) to extract this information.

## Interesting articles

- [Transcoding assets for MSE](https://developer.mozilla.org/en-US/docs/Web/API/Media_Source_Extensions_API/Transcoding_assets_for_MSE)
- [MPEG-DASH Content Generation with MP4Box and x264](https://bitmovin.com/mp4box-dash-content-generation-x264/)
- [FFmpeg with hardware acceleration](https://trac.ffmpeg.org/wiki/HWAccelIntro)
- [HTTP Adaptive Streaming with GStreamer](https://coaxion.net/blog/2014/05/http-adaptive-streaming-with-gstreamer/)
- [HTML5 Live Streaming with MPEG-DASH](https://www.isrv.pw/html5-live-streaming-with-mpeg-dash)
- [Stream live WebM video to browser using Node.js and GStreamer](https://delog.wordpress.com/2011/04/26/stream-live-webm-video-to-browser-using-node-js-and-gstreamer/)
- [Stop numbering: The underappreciated power of DASH's SegmentTimeline](http://www.unified-streaming.com/blog/stop-numbering-underappreciated-power-dashs-segmenttimeline)
- [The Best MPEG-DASH Open Source Players & Tools](https://bitmovin.com/mpeg-dash-open-source-player-tools/)
- [How to encode multi-bitrate videos in MPEG-DASH for MSE based media players (1/2)](https://blog.streamroot.io/encode-multi-bitrate-videos-mpeg-dash-mse-based-media-players/)
- [How to encode multi-bitrate videos in MPEG-DASH for MSE based media players (2/2)](https://blog.streamroot.io/encode-multi-bitrate-videos-mpeg-dash-mse-based-media-players-22/)
- [Live DASH audio/video encoder: DashCast](https://gpac.wp.imt.fr/2013/04/23/live-dash-audiovideo-encoder-dashcast/)
- [Example GStreamer Pipelines](http://labs.isee.biz/index.php/Example_GStreamer_Pipelines#Decode_.MP4_Files)
- [GStreamer Basic Real Time Streaming Tutorial](http://www.einarsundgren.se/gstreamer-basic-real-time-streaming-tutorial/)
- [Texas Instruments - Example GStreamer Pipelines](http://processors.wiki.ti.com/index.php/Example_GStreamer_Pipelines)
- [Introduction to h264 NAL Unit](https://yumichan.net/video-processing/video-compression/introduction-to-h264-nal-unit/)
- [GStreamer cheatsheet](http://wiki.oz9aec.net/index.php/Gstreamer_cheat_sheet#Network_Streaming)
- [h.264 Profiles and levels](http://blog.mediacoderhq.com/h264-profiles-and-levels/)
- [Movie Atoms](https://developer.apple.com/library/content/documentation/QuickTime/QTFF/QTFFChap2/qtff2.html)

## Useful tools

- [Bento4](https://www.bento4.com/)
- [MP4Box](https://gpac.wp.imt.fr/mp4box/)
- [FFMPEG](https://www.ffmpeg.org/)
- [GStreamer](https://gstreamer.freedesktop.org/)
- [DashCast](https://gpac.wp.imt.fr/dashcast/)
- [DASHEncoder](https://github.com/slederer/DASHEncoder)
- [DASHencrypt](https://github.com/castlabs/dashencrypt)
- [DASHMe](https://github.com/canalplus/DashMe)
- [shaka-packager](https://github.com/google/shaka-packager)
- [MPD Validator](http://www-itec.uni-klu.ac.at/dash/?page_id=605)
- [Abrizer](https://github.com/jronallo/abrizer)

## Streaming servers

- [Nimble Streamer](https://es.wmspanel.com/nimble)
- [Unified Streaming](http://www.unified-streaming.com/)
- [Wowza Media Server](https://www.wowza.com/)
- [Live Media Streamer](http://livemediastreamer.i2cat.net/)

## Players

- [shaka-player](https://github.com/google/shaka-player)
- [dash.js](https://github.com/Dash-Industry-Forum/dash.js/wiki)

## Interesting repositories

- [Conformance and reference](https://raw.githubusercontent.com/Dash-Industry-Forum/Conformance-and-reference-source/)
- [nginx RTMP module](https://github.com/arut/nginx-rtmp-module)
- [Stream-M server](https://github.com/vbence/stream-m#fragments)
- [C++ ISOBMFF Library](https://github.com/DigiDNA/ISOBMFF)
- [DASHTranscoder](https://github.com/dazedsheep/DASHTranscoder)
- [libdash](https://github.com/bitmovin/libdash)
- [mp4parser](https://github.com/sannies/mp4parser/)
