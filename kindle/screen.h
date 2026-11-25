#ifndef GDHQ_SCREEN_H
#define GDHQ_SCREEN_H

#define STARTERS 20
struct Player { char slot[12], name[48], points[20]; };
struct Board {
    char mode[6], week[48], home[64], home_score[20], away[64], away_score[20], stamp[60];
    struct Player player[STARTERS];
    int count;
};

int screen_png(const char *filename, const struct Board *b, int page, const char *notice);
#endif
