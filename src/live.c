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

#define DURATION 10

static unsigned long timescale = 1000;

//static unsigned long start = 0;

static gboolean bus_call(GstBus *bus, GstMessage *msg, gpointer data)
{
  GMainLoop *loop = (GMainLoop *)data;

  switch (GST_MESSAGE_TYPE(msg))
  {
  case GST_MESSAGE_EOS:
    g_printerr("End of stream\n");
    g_main_loop_quit(loop);
    break;

  case GST_MESSAGE_ERROR:
  {
    gchar *debug;
    GError *error;

    gst_message_parse_error(msg, &error, &debug);
    g_free(debug);

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

static gchar *on_format_location(GstElement *splitmux, guint fragment_id, gpointer user_data)
{
  // NOTE: This is freed automatically by GST.
  gchar *fragment_name = (gchar *)malloc(1024);

  // This is automatically freed because it is a local variable.
  char cwd[1024];
  if (getcwd(cwd, sizeof(cwd)) != NULL)
  {
    /*unsigned long current = time(NULL);
    if (start == 0)
    {
      start = current;
    }
    unsigned long delta = (current - start) > 0 ? (current - start) - 1 : 0;*/
    sprintf(fragment_name, "%s/media/live_%lu.mp4", cwd, fragment_id * DURATION * timescale);
    g_printerr("Fragment: %s\n", fragment_name);
    g_print("%u\n", fragment_id);
    return fragment_name;
  }
  return NULL;
}

int main(int argc, char **argv)
{
  GMainLoop *loop;

  GstCaps *caps;
  GstElement *pipeline, *source, *encoder, *muxer, *muxsink;
  GstBus *bus;

  guint bus_watch_id;

  gst_init(&argc, &argv);

  loop = g_main_loop_new(NULL, FALSE);

  /*if (argc != 1) {
    g_printerr("Usage: %s\n", argv[0]);
    return -1;
  }*/

  caps = gst_caps_new_simple("video/x-h264",
    "profile", G_TYPE_STRING, "main", NULL);

  pipeline = gst_pipeline_new("dash");
  source = gst_element_factory_make("videotestsrc", "source");
  #ifdef __APPLE__
    encoder = gst_element_factory_make("vtenc_h264", "encoder");
    muxer = gst_element_factory_make("qtmux", "muxer");
  #elif __linux__
    encoder = gst_element_factory_make("x264enc", "encoder");
    muxer = gst_element_factory_make("mp4mux", "muxer");
  #endif
  muxsink = gst_element_factory_make("splitmuxsink", "muxsink");

  if (!pipeline || !source || !encoder || !muxsink)
  {
    g_printerr("Error creating pipeline\n");
    return -1;
  }

  g_object_set(G_OBJECT(source), "is-live", TRUE, NULL);

  #ifdef __linux__
    //gst_util_set_object_arg(G_OBJECT(encoder), "profile", "baseline");
    gst_util_set_object_arg(G_OBJECT(encoder), "tune", "fastdecode");
    //g_object_set(G_OBJECT(encoder), "tune", , NULL);
    //gst_util_set_object_arg(G_OBJECT(encoder), "speed-preset", "ultrafast");
    //g_object_set(G_OBJECT(encoder), "speed-preset", gst_util_set_object_arg(G_OBJECT(encoder), "speed-preset", "ultrafast"), NULL);
    g_object_set(G_OBJECT(encoder), "bitrate", 768, NULL);
    g_object_set(G_OBJECT(encoder), "ref", 2, NULL);
    //g_object_set(G_OBJECT(encoder), "pass", 5, NULL);
    //g_object_set(G_OBJECT(encoder), "quantizer", 25, NULL);
    //g_object_set(G_OBJECT(encoder), "option-string", "--weightp 0 --me dia", NULL);
    //g_object_set(G_OBJECT(encoder), "byte-stream", TRUE, NULL);
    //g_object_set(G_OBJECT(encoder), "profile", 1, NULL);
    //g_object_set(G_OBJECT(encoder), "bitrate", 768, NULL);
  #endif

  g_object_set(G_OBJECT(muxer), "faststart", TRUE, NULL);
  g_object_set(G_OBJECT(muxer), "streamable", TRUE, NULL);
  g_object_set(G_OBJECT(muxer), "presentation-time", TRUE, NULL);
  g_object_set(G_OBJECT(muxer), "movie-timescale", timescale, NULL);
  g_object_set(G_OBJECT(muxer), "trak-timescale", timescale, NULL);
  g_object_set(G_OBJECT(muxer), "fragment-duration", SECOND_IN_MILLISECONDS(1), NULL);

  //g_object_set(G_OBJECT(muxsink), "location", "media/hello_%04d.m4s", NULL);
  g_object_set(G_OBJECT(muxsink), "muxer", muxer, NULL);
  g_object_set(G_OBJECT(muxsink), "max-size-time", SECOND_IN_NANOSECONDS(DURATION), NULL);

  bus = gst_pipeline_get_bus(GST_PIPELINE(pipeline));
  bus_watch_id = gst_bus_add_watch(bus, bus_call, loop);
  gst_object_unref(bus);

  gst_bin_add_many(GST_BIN(pipeline), source, encoder, muxsink, NULL);

  gst_element_link_many(source, encoder, NULL);
  gst_element_link_filtered(encoder, muxsink, caps);
  gst_caps_unref(caps);
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
