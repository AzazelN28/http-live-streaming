main:
	gcc -Wall live.c -o live `pkg-config --cflags --libs gstreamer-1.0`

.PHONY: clean
clean:
	rm live
