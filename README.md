# DASH Live Streaming

Hay varias tecnologías involucradas en la retransmisión de un directo usando DASH.

1. **MSE (Media Source Extensions)**: es la parte del navegador que permite realizar streaming de vídeo componiendo un buffer a partir de chunks o segmentos independientes de vídeo. Hay muchas opciones que podemos utilizar y que nos facilitan mucho ésta tarea, ejemplos: **dash.js** o **Shaka Player**.
2. **ISO BMFF (normalmente conocido como MPEG4), Matroska, x264, x265, vp8, vp9, Vorbis y Opus**: todas estas se pueden utilizar para generar los chunks o segmentos de vídeo que serán consumidos por el navegador pero hay formatos más compatibles que otros. Existen infinidad de herramientas que nos permiten generar este tipo de archivos: **ffmpeg**, **gstreamer**, **dashencoder**, **Shaka Packager**, **DashCast**, **MP4Box**, etc.
3. **MPD (Media Presentation Document)**: es parte de la especificación de DASH y permite describir el contenido que vamos a consumir con MSE.

Como se contempla en la sección 4 (página 49) de la [última especificación de DASH](http://dashif.org/wp-content/uploads/2017/09/DASH-IF-IOP-v4.1-clean.pdf) publicada hasta la fecha, existen tres posibles escenarios para la retransmisión en directo:

- **Distribución dinámica de contenido disponible**: en este caso el contenido es generado dinámicamente pero está disponible antes de comenzar la retransmisión.
- **Emisión en directo controlada desde MPD**: en este caso se contempla que toda la información de la retransmisión está controlada por el MPD.
- **Emisión en directo controlada desde MPD y desde los segmentos**: en este caso se contempla que toda la información de la retransmisión no sólo está controlada por el MPD si no que además se utilizarán los segmentos para extraer información relevante para la retransmisión.

Para cada uno de estos tres casos se contemplan tres posibles soluciones:

- **Dynamic Segment Download**: todo el contenido se genera con antelación pero su retransmisión es considerada _live_.
- **Simple Live Client**: el contenido es generado sobre la marcha pero sólo el **MPD** se utiliza como fuente fiable de los datos del _streaming_.
- **Main Live Client**: el contenido es generado sobre la marcha y se utilizan tanto los datos del **MPD** como los datos contenidos en los segmentos que se van retransmitiendo durante el _streaming_. Éste es el perfil más completo y permite obtener no sólo metadatos de los segmentos como duración o tiempo actual, sino que además permite añadir eventos (Inband Events) dentro de los `mp4`.

## ¿Qué es un MPD y cómo lo puedo servir?

Un MPD es un archivo XML que contiene información (metadatos) sobre los segmentos de vídeo, audio y las diferentes configuraciones y opciones que podemos encontrar a la hora de reproducir el _stream_ (idiomas, subtitulos, diferentes resoluciones y formatos, etc).

> IMPORTANTE: Para servir MPD correctamente es necesario que el servidor pueda servir los archivos `*.mpd` con el `Content-Type` como `application/dash+xml`.

Para _live streaming_ el valor `type` del MPD debe ser `dynamic` (incluso cuando no se incluyen parámetros como `minimumUpdatePeriod`).

> NOTA: Puede ocurrir que estemos viendo un segmento de vídeo de una cámara que no está grabando contenido nuevo, en este caso como el contenido ya está grabado y no existe un _live edge_ en vez de servir un MPD _live_ podemos servir un MPD _on-demand_ (sólo habría que cambiar los `profiles`, el `type` y eliminar el elemento `<UTCTiming>`).

> NOTA: Los parámetros más importantes con respecto al `<AdaptationSet>` son `timescale`, `mimeType` y `codecs`. En mi caso he usado `mp4info` para obtener muchos de estos parámetros.

### Ejemplo

```xml
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="dynamic" profiles="urn:mpeg:dash:profile:isoff-live:2011,urn:com:dashif:dash264" publishTime="2018-01-20T03:30:28.756Z" availabilityStartTime="2018-01-20T03:17:26.269Z" minBufferTime="PT10S" suggestedPresentationDelay="PT20S">
  <!-- Esto es muy importante a la hora de sincronizar un live streaming, se puede utilizar un endpoint propio que devuelva el timestamp actual del servidor en UTC -->
  <UTCTiming schemeIdUri="urn:mpeg:dash:utc:http-head:2014" value="https://vm2.dashif.org/dash/time.txt"/>
  <Period id="0" start="PT0S">
    <AdaptationSet id="0" mimeType="video/mp4" codecs="avc1.4D400D" segmentAlignment="true">
      <SegmentTemplate duration="5000" timescale="1000"/>
      <Representation id="0" width="320" height="240" bandwidth="763333">
        <SegmentTemplate startNumber="0" media="live_$Number$.mp4"/>
        <SegmentTimeline>
          <!-- Gracias a SegmentTimeline podemos dar más información al cliente sobre cuántos chunks hay disponibles `r`, su duración `d` y el tiempo recomendado del chunk más reciente `t` -->
          <S t="760000" d="5000" r="156"/>
          <!-- Otra ventaja de utilizar SegmentTimeline es que se pueden utilizar múltiples segmentos `S` para indicar discontinuidades en el stream -->
        </SegmentTimeline>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>
```

Para obtener algunos parámetros es posible utilizar una herramienta facilitada por el conjunto de herramientas [bento4](https://www.bento4.com/developers/dash/) llamada `mp4info`.

```sh
mp4info --format json media/live_0.mp4
```

> NOTA: No es necesario que el archivo esté completamente generado para hacer esta llamada, con que al menos las cabeceras `moov`, `mvhd`, `trak` y `moof` estén generados es suficiente. Eso sí, es totalmente necesario que sea un fragmented MP4.

Usando Node.JS:

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
  // Destructuring utilizado para obtener las partes claves necesarias
  // para generar el MP4.
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

  // Aquí tendremos las siguientes variables definidas:
  // bitrate, duration, codecsString, width, height, frameRate

  // NOTA: `duration` es realmente importante porque devuelve la duración
  // con los fragmentos y el timescale actual.

  // NOTA: A veces `frameRate` no está disponible porque es variable pero no hay problema
  // siempre y cuando la duración del segmento sea la misma. Esto se puede forzar usando
  // un GOP fijo en la codificación del h264.
```

Este ejemplo usa como plantilla `live_$Number$.mp4`, sin embargo como se comenta en el artículo [Stop numbering: The underappreciated power of DASH's SegmentTimeline](http://www.unified-streaming.com/blog/stop-numbering-underappreciated-power-dashs-segmenttimeline) una mejor alternativa a esto es utilizar como parámetro `media` del `SegmentTemplate` una versión con el tiempo: `live_$Time$.mp4`. Sin embargo `gstreamer` no ofrece la posibilidad de imprimir el tiempo en nuestros chunks directamente desde `gst-launch-1.0` pero aún así podemos utilizar la API que nos ofrecen para hacer un programa en C que lo haga por nosotros:

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

## ¿Cómo asignar parámetros en el MPD?

Hay tres parámetros clave a la hora de realizar una retransmisión en directo.

- **minBufferTime**: Indica cuál debe ser el tamaño de buffer mínimo para que la reproducción de la emisión sea continua.
- **suggestedPresentationDelay**: Indica cuál debe ser el desfase entre el _live edge_ y el tiempo mínimo que almacenamos en el buffer.
- **timeShiftBufferDepth**: Indica cuál es el máximo tiempo que podemos rebobinar en una emisión en directo. IMPORTANTE: No es necesario si se van a mantener los chunks almacenados permanentemente.

Siempre se deben asignar de esta manera:

```
minBufferTime < suggestedPresentationDelay < timeShiftBufferDepth
```

Una manera de establecer el **minBufferTime** es utilizar un valor al menos dos o tres veces mayor al tiempo medio que se tarda entre que se envía una petición para descargar un chunk y el tiempo que se tarda en recibir completamente ese chunk.

Por otra parte **suggestedPresentationDelay** siempre debería ser cómo mínimo **minBufferTime** más dos veces el tiempo medio que se tarda en **procesar** y **almacenar** un chunk.

## ¿Es necesario tener un `minimumUpdatePeriod` para la retransmisión en directo?

No, `minimumUpdatePeriod` es útil para actualizar el MPD sobre la marcha en el caso de que alguno de los parámetros de los chunks o segmentos cambie. Si éstos no cambian o el _streaming_ es continuo no es necesario actualizar este documento.

## ¿Por qué no se representa correctamente el tiempo en el _live streaming_?

Por defecto, cuando no se conoce la longitud de un _stream_, programas como `gstreamer` o `ffmpeg` escriben en la cabecera `mvhd` del contenedor que la duración es 0 (0x00000000) o 4294967295 (0xFFFFFFFF) para indicar que la duración es desconocida. Por lo que se indica en la documentación del W3C sobre Media Timelines, es posible que los segmentos puedan reescribir la duración de un _stream_ sobre la marcha provocando un evento `durationchange`. Sin embargo si ésto no es posible, Shaka Player posee una alternativa, podemos llamar a la función `getSegmentAvailabilityEnd` del `PresentationTimeline` del `Manifest`.

```js
const player = new shaka.Player(video);

player.addEventListener("streaming", () => {
  // Aquí tenemos la primera oportunidad para obtener el manifest (y cachearlo).
  player.getManifest();
});

video.addEventListener("timeupdate", (e) => {
  // Tiempo actual (relativo al comienzo de la reproducción).
  videoCurrentTime = e.target.currentTime;
  // Una manera mucho mejor de obtener el tiempo (y fecha) actual.
  videoCurrentDate = player.getPlayheadTimeAsDate();
  // Fecha en la que comenzó la reproducción.
  videoStartDate = player.getPresentationStartTimeAsDate();
  // Tiempo al que podemos avanzar y retroceder.
  videoSeekRange = player.seekRange();
  // Duración de nuestro stream.
  videoDuration = player.getManifest().getPresentationTimeline().getSegmentAvailabilityEnd();
});

// Cargamos el manifest.
player.load("http://localhost:4000/live.mpd");
```

## ¿Cómo representar el tiempo disponible al que podemos saltar para nuestro _live streaming_?

Shaka Player posee una función llamada `seekRange` que nos permite obtener desde qué punto a qué punto podemos realizar _seeking_ en el vídeo. Normalmente en una retransmisión en directo el campo `duration` de un elemento `<video>` es 0xFFFFFFFF o lo que es lo mismo, 4294967295. Si obtenemos este valor en la duración de un vídeo sabremos que éste es una retransmisión en directo y también sabremos que normalmente la duración de este vídeo será desde el inicio de la grabación hasta el momento actual.

## Cómo generar chunks válidos para MSE

Por defecto en todos estos comandos se utiliza como `speed-preset` el valor `ultrafast`, sin embargo se ha probado que hasta `medium` los vídeos generan un `codec string` válido para MSE.

| Resolución | Bitrate recomendado |
|:----------:|:-------------------:|
| 480p       | 1200 ~ 2000         |
| 720p       | 2400 ~ 4000         |
| 1080p      | 4800 ~ 8000         |

> NOTA: El parámetro `max-size-time` de `mp4mux` acepta valores en nanosegundos (1/1.000.000.000 segundos).

> NOTA: Todos estos comandos generan _fragmented MP4s_, totalmente necesarios para garantizar una mejor reproducción en MSE.

### Grabar de una fuente de pruebas

```sh
gst-launch-1.0 videotestsrc is-live=true ! queue ! x264enc tune=zerolatency speed-preset=ultrafast bitrate=1000 key-int-max=100 ! splitmuxsink muxer='mp4mux faststart=true streamable=true fragment-duration=1000 trak-timescale=1000 movie-timescale=1000 presentation-time=true' max-size-time=1000000000 location=media/live_%d.mp4
```

### Grabar de una webcam

```sh
gst-launch-1.0 v4l2src ! queue ! x264enc tune=zerolatency speed-preset=ultrafast bitrate=2400 key-int-max=100 ! splitmuxsink muxer='mp4mux faststart=true streamable=true fragment-duration=1000 trak-timescale=1000 movie-timescale=1000 presentation-time=true' max-size-time=1000000000 location=media/live_%d.mp4
```

### Grabar del escritorio

```sh
gst-launch-1.0 ximagesrc ! queue ! x264enc tune=zerolatency speed-preset=ultrafast bitrate=3600 key-int-max=100 ! splitmuxsink muxer='mp4mux faststart=true streamable=true fragment-duration=1000 trak-timescale=1000 movie-timescale=1000 presentation-time=true' max-size-time=1000000000 location=media/live_%d.mp4
```
