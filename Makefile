main:
	mkdir -p bin
	gcc -Wall src/live.c -o bin/live `pkg-config --cflags --libs gstreamer-1.0`

.PHONY: clean
clean:
	rm live
