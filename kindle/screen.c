#include "screen.h"
#include "font8x8_basic.h"
#include <stdint.h>
#include <stdio.h>
#include <string.h>

enum { W = 600, H = 800, ROWS = 10, BLACK = 0, GRAY = 85, PALE = 221, WHITE = 255 };
/* One PNG filter byte (zero) before each row. */
static unsigned char pixels[H][W+1];
static unsigned char stream[sizeof pixels + 48];

static void rect(int x, int y, int w, int h, unsigned char ink) {
    if (x < 0 || y < 0 || w <= 0 || h <= 0 || x+w > W || y+h > H) return;
    for (int j = y; j < y+h; ++j) memset(&pixels[j][x+1], ink, (size_t)w);
}

static void text(int x, int y, int scale, int limit, int ink, const char *s) {
    int len = (int)strlen(s);
    for (int i = 0; i < len && i < limit; i++) {
        unsigned char c = (unsigned char)(len > limit && i >= limit-3 ? '.' : s[i]);
        if (c < 32 || c >= 127) c = '?';
        for (int row = 0; row < 8; row++) {
            unsigned char bits = (unsigned char)font8x8_basic[c][row];
            for (int bit = 0; bit < 8; bit++) {
                if (bits & (1u << bit)) rect(x+(i*8+bit)*scale, y+row*scale, scale, scale, ink);
            }
        }
    }
}

static void right(int x, int y, int scale, int limit, int ink, const char *s) {
    int len = (int)strlen(s);
    text(x-(len < limit ? len : limit)*8*scale, y, scale, limit, ink, s);
}

static void board_layout(const struct Board *b, int page, const char *notice) {
    char page_no[24];
    const int pages = 1 + (b->count > ROWS ? 2 : 1);
    for (int y = 0; y < H; y++) {
        pixels[y][0] = 0;
        memset(&pixels[y][1], WHITE, W);
    }
    rect(0, 0, W, 106, BLACK);
    text(28, 20, 5, 12, WHITE, "GAME DAY HQ");
    text(30, 72, 2, 33, WHITE, "FANTASY FOOTBALL");
    right(570, 73, 2, 6, WHITE, b->mode);
    text(28, 133, 3, 22, BLACK, b->week);
    rect(28, 180, 544, 3, BLACK);
    if (!page) {
        const char *names[2] = {b->home, b->away};
        const char *scores[2] = {b->home_score, b->away_score};
        for (int i = 0; i < 2; i++) {
            int y = 207 + 213*i;
            text(28, y, 2, 28, GRAY, i ? "OPPONENT" : "YOUR TEAM");
            text(28, y+33, 3, 22, BLACK, names[i]);
            text(24, y+78, strlen(scores[i]) > 6 ? 7 : 10, 8, BLACK, scores[i]);
            text(514, y+139, 2, 4, GRAY, "PTS");
            rect(28, y+178, 544, 2, BLACK);
        }
        text(28, 608, 2, 32, BLACK, "Right >  See starters");
    } else {
        text(28, 203, 3, 19, BLACK, "STARTERS");
        right(568, 209, 2, 4, BLACK, "PTS");
        const int first = (page-1)*ROWS;
        if (!b->count) text(28, 258, 2, 33, GRAY, "No starters posted yet.");
        for (int i = first; i < b->count && i < first+ROWS; i++) {
            const struct Player *p = &b->player[i];
            int y = 250 + (i-first)*39;
            text(28, y, 1, 9, GRAY, p->slot);
            text(112, y-2, 2, 21, BLACK, p->name);
            right(568, y-2, 2, 8, BLACK, p->points);
            rect(28, y+25, 544, 1, PALE);
        }
    }
    rect(0, 662, W, 138, PALE);
    text(28, 679, 2, 33, BLACK, notice && *notice ? notice : b->stamp);
    snprintf(page_no, sizeof page_no, "%d/%d", page+1, pages);
    text(28, 719, 2, 19, BLACK, "< >  Change page");
    right(572, 719, 2, 7, BLACK, page_no);
    text(28, 757, 2, 18, BLACK, "OK  Refresh");
    right(572, 757, 2, 13, BLACK, "BACK  Close");
}

static void be32(unsigned char p[4], uint32_t v) {
    p[0] = (unsigned char)(v>>24); p[1] = (unsigned char)(v>>16);
    p[2] = (unsigned char)(v>>8); p[3] = (unsigned char)v;
}

static uint32_t crc(uint32_t c, const unsigned char *p, size_t n) {
    while (n--) {
        c ^= *p++;
        for (int i = 0; i < 8; i++) c = (c>>1) ^ (0xedb88320U & (0U-(c&1)));
    }
    return c;
}

static void chunk(FILE *f, const char *type, const unsigned char *p, size_t n) {
    unsigned char num[4];
    be32(num, (uint32_t)n);
    fwrite(num, 1, 4, f); fwrite(type, 1, 4, f);
    if (n) fwrite(p, 1, n, f);
    be32(num, ~crc(crc(~0U, (const unsigned char *)type, 4), p, n));
    fwrite(num, 1, 4, f);
}

/* eips on the Kindle Keyboard expects an 8-bit grayscale PNG (color type 0). */
int screen_png(const char *filename, const struct Board *b, int page, const char *notice) {
    board_layout(b, page, notice);
    FILE *f = fopen(filename, "wb");
    if (!f) return -1;

    unsigned char ihdr[13] = {0};
    be32(ihdr, W); be32(ihdr+4, H); ihdr[8] = 8;
    fwrite("\x89PNG\r\n\x1a\n", 1, 8, f);
    chunk(f, "IHDR", ihdr, sizeof ihdr);
    const unsigned char *raw = (const unsigned char *)pixels;
    uint32_t a = 1, z = 0;
    size_t out = 0;
    stream[out++] = 0x78; stream[out++] = 0x01;
    for (size_t pos = 0; pos < sizeof pixels;) {
        size_t n = sizeof pixels - pos;
        if (n > 65535) n = 65535;
        unsigned nn = 65535u - (unsigned)n;
        stream[out++] = (pos+n == sizeof pixels);
        stream[out++] = (unsigned char)n; stream[out++] = (unsigned char)(n>>8);
        stream[out++] = (unsigned char)nn; stream[out++] = (unsigned char)(nn>>8);
        for (size_t k = 0; k < n; k++) { a = (a+raw[pos+k])%65521; z = (z+a)%65521; }
        memcpy(stream+out, raw+pos, n);
        pos += n; out += n;
    }
    be32(stream+out, (z<<16)|a); out += 4;
    chunk(f, "IDAT", stream, out);
    chunk(f, "IEND", NULL, 0);
    int bad = ferror(f);
    return fclose(f) || bad ? -1 : 0;
}
