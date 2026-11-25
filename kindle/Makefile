CC ?= cc
ZIG ?= zig
FLAGS := -Os -Wall -Wextra -Werror -std=c11
SRC := client.c screen.c
HEADERS := screen.h font8x8_basic.h

.PHONY: kindle preview
kindle: build/gameday build/demo-score.txt
preview: build/gameday-host build/demo-score.txt
	build/gameday-host --preview build/demo-score.txt build/score.png
	build/gameday-host --preview build/demo-score.txt build/lineup.png 1

build:
	mkdir -p $@

build/gameday: $(SRC) $(HEADERS) | build
	$(ZIG) cc -target arm-linux-musleabi -mcpu=arm1136jf_s -static -s $(FLAGS) $(SRC) -o $@

build/gameday-host: $(SRC) $(HEADERS) | build
	$(CC) $(FLAGS) $(SRC) -o $@

build/demo-score.txt: relay.mjs ../public/demo.js | build
	node relay.mjs --demo-packet > $@
