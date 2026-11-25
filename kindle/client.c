#define _GNU_SOURCE
#include "screen.h"
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/input.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define PACKET 4096
#define PORT 8799
static volatile sig_atomic_t stop;
static void stop_now(int sig) { (void)sig; stop = 1; }

static int copy_text(char *dst, size_t size, const char *src) {
    if (!src || strlen(src) >= size) return -1;
    for (const unsigned char *p = (const unsigned char *)src; *p; ++p)
        if (*p < 32 || *p > 126) return -1;
    memcpy(dst, src, strlen(src)+1);
    return 0;
}

static int parse(const char *packet, struct Board *board) {
    char input[PACKET];
    if (strlen(packet) >= sizeof input) return -1;
    strcpy(input, packet);
    char *rest = input, *head = strsep(&rest, "\n");
    struct Board b = {0};
    if (strcmp(head, "GDHQ1")) return -1;
#define LINE(field) if (copy_text(b.field, sizeof b.field, strsep(&rest, "\n"))) return -1
    LINE(mode); LINE(week); LINE(home); LINE(home_score);
    LINE(away); LINE(away_score); LINE(stamp);
#undef LINE
    if (strcmp(b.mode, "DEMO") && strcmp(b.mode, "LIVE")) return -1;
    char *row;
    while ((row = strsep(&rest, "\n")) && *row) {
        if (b.count >= STARTERS) return -1;
        struct Player *p = &b.player[b.count++];
        if (copy_text(p->slot, sizeof p->slot, strsep(&row, "|")) ||
            copy_text(p->name, sizeof p->name, strsep(&row, "|")) ||
            copy_text(p->points, sizeof p->points, row)) return -1;
    }
    *board = b;
    return 0;
}

static int load_file(const char *file, struct Board *board) {
    FILE *f = fopen(file, "rb");
    if (!f) return -1;
    char packet[PACKET];
    size_t n = fread(packet, 1, sizeof packet-1, f);
    int bad = !feof(f) || ferror(f) || memchr(packet, '\0', n) != NULL;
    fclose(f);
    packet[n] = 0;
    return bad ? -1 : parse(packet, board);
}

static int relay_address(struct in_addr *ip) {
    FILE *f = fopen("host.txt", "r");
    if (!f) return -1;
    char line[24];
    int ok = fgets(line, sizeof line, f) != NULL;
    fclose(f);
    if (!ok) return -1;
    line[strcspn(line, "\r\n")] = 0;
    if (inet_pton(AF_INET, line, ip) != 1) return -1;
    uint32_t addr = ntohl(ip->s_addr);
    return (addr >> 24 == 10 || addr >> 20 == 0xac1 || addr >> 16 == 0xc0a8) ? 0 : -1;
}

static int connect_relay(void) {
    struct sockaddr_in addr = { .sin_family = AF_INET, .sin_port = htons(PORT) };
    if (relay_address(&addr.sin_addr)) return -1;
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return -1;
    int flags = fcntl(fd, F_GETFL);
    if (flags < 0 || fcntl(fd, F_SETFL, flags | O_NONBLOCK)) goto fail;
    if (connect(fd, (struct sockaddr *)&addr, sizeof addr)) {
        struct pollfd p = { .fd = fd, .events = POLLOUT };
        int err = 0;
        socklen_t size = sizeof err;
        if (errno != EINPROGRESS || poll(&p, 1, 3000) != 1 ||
            getsockopt(fd, SOL_SOCKET, SO_ERROR, &err, &size) || err) goto fail;
    }
    if (fcntl(fd, F_SETFL, flags)) goto fail;
    return fd;
fail:
    close(fd);
    return -1;
}

static int refresh(struct Board *board) {
    int fd = connect_relay();
    if (fd < 0) return -1;
    static const char request[] = "GET /score HTTP/1.0\r\nConnection: close\r\n\r\n";
    char data[PACKET+512];
    size_t n = 0, sent = 0;
    while (sent < sizeof request-1) {
        struct pollfd p = { .fd = fd, .events = POLLOUT };
        if (poll(&p, 1, 3000) != 1) goto bad;
        ssize_t bytes = send(fd, request+sent, sizeof request-1-sent, MSG_DONTWAIT);
        if (bytes <= 0) goto bad;
        sent += (size_t)bytes;
    }
    /* Bound the whole operation even if a network peer sends a slow response. */
    struct timespec begin, end;
    if (clock_gettime(CLOCK_MONOTONIC, &begin)) goto bad;
    while (n < sizeof data-1 && !stop) {
        if (clock_gettime(CLOCK_MONOTONIC, &end)) goto bad;
        long ms = (20 - (end.tv_sec-begin.tv_sec))*1000 - (end.tv_nsec-begin.tv_nsec)/1000000;
        struct pollfd p = { .fd = fd, .events = POLLIN };
        if (ms <= 0 || poll(&p, 1, (int)ms) != 1) goto bad;
        ssize_t bytes = recv(fd, data+n, sizeof data-1-n, MSG_DONTWAIT);
        if (bytes < 0) goto bad;
        if (!bytes) break;
        n += (size_t)bytes;
    }
    close(fd);
    if (stop || n == sizeof data-1 || memchr(data, '\0', n)) return -1;
    data[n] = 0;
    if (strncmp(data, "HTTP/1.1 200 ", 13) && strncmp(data, "HTTP/1.0 200 ", 13)) return -1;
    char *body = strstr(data, "\r\n\r\n");
    if (!body || parse(body+4, board)) return -1;
    FILE *f = fopen("last-score.tmp", "wb");
    if (f) {
        int wrote = fputs(body+4, f) >= 0;
        if (!fclose(f) && wrote) (void)rename("last-score.tmp", "last-score.txt");
        (void)unlink("last-score.tmp");
    }
    return 0;
bad:
    close(fd);
    return -1;
}

static int show(const char *file, const struct Board *b, int page, const char *note) {
    if (screen_png(file, b, page, note)) return -1;
    pid_t pid = fork();
    if (pid < 0) return -1;
    if (!pid) {
        execlp("eips", "eips", "-g", file, (char *)NULL);
        _exit(127);
    }
    int status;
    pid_t r;
    do { r = waitpid(pid, &status, 0); } while (r < 0 && errno == EINTR);
    return r == pid && WIFEXITED(status) && WEXITSTATUS(status) == 0 ? 0 : -1;
}

static int input_device(const char *path) {
    int fd = open(path, O_RDONLY | O_NONBLOCK | O_CLOEXEC);
    if (fd < 0) return -1;
    if (ioctl(fd, EVIOCGRAB, 1) == 0) return fd;
    close(fd);
    return -1;
}

/* Legacy 32-bit input_event from Kindle's 2.6 kernel, regardless of libc time_t. */
struct LegacyEvent { uint32_t sec, usec; uint16_t type, code; int32_t value; };
static int key(struct pollfd p[2]) {
    int ready = poll(p, 2, 180000);
    if (ready <= 0) return -1;
    for (int i = 0; i < 2; ++i) {
        if (p[i].revents & (POLLERR | POLLHUP | POLLNVAL)) return -1;
        if (!(p[i].revents & POLLIN)) continue;
        struct LegacyEvent e;
        while (read(p[i].fd, &e, sizeof e) == sizeof e) {
            if (e.type == EV_KEY && e.value == 1) return e.code;
        }
    }
    return 0;
}

static int last_page(const struct Board *b) { return b->count > 10 ? 2 : 1; }

int main(int argc, char **argv) {
    struct Board b;
    if (argc >= 4 && !strcmp(argv[1], "--preview")) {
        int page = argc > 4 ? atoi(argv[4]) : 0;
        if (load_file(argv[2], &b) || page < 0 || page > last_page(&b)) return 1;
        return screen_png(argv[3], &b, page, NULL) != 0;
    }
    if (argc == 2 && !strcmp(argv[1], "--fetch")) return refresh(&b) != 0;
    if (argc != 1) return 2;
    if (load_file("last-score.txt", &b) && load_file("demo-score.txt", &b)) return 1;
    int lock = open("/tmp/game-day-hq.lock", O_CREAT | O_NOFOLLOW | O_CLOEXEC | O_RDWR, 0600);
    if (lock < 0 || flock(lock, LOCK_EX | LOCK_NB)) return 1;
    struct sigaction sa = { .sa_handler = stop_now };
    sigaction(SIGINT, &sa, NULL); sigaction(SIGTERM, &sa, NULL);
    signal(SIGPIPE, SIG_IGN);
    struct pollfd keys[2] = {
        { .fd = input_device("/dev/input/event0"), .events = POLLIN },
        { .fd = input_device("/dev/input/event1"), .events = POLLIN },
    };
    /* If Launchpad has not released the keys yet, exit without drawing over the stock UI. */
    if (keys[0].fd < 0 || keys[1].fd < 0) return 1;
    char image[] = "/tmp/gdhq-XXXXXX.png";
    int fd = mkstemps(image, 4);
    if (fd < 0) return 1;
    close(fd);
    int page = 0;
    const char *note = "Checking for new scores...";
    if (!show(image, &b, page, note)) {
        note = refresh(&b) ? "Offline - showing saved data" : NULL;
        while (!stop && !show(image, &b, page, note)) {
            int k;
            do { k = key(keys); } while (!stop && !k);
            if (k < 0 || k == KEY_BACK || k == KEY_HOME || k == KEY_Q || k == KEY_ESC) break;
            if (k == KEY_RIGHT || k == KEY_DOWN || k == 191 || k == 104) page = page >= last_page(&b) ? 0 : page+1;
            else if (k == KEY_LEFT || k == KEY_UP || k == 193 || k == 109) page = page == 0 ? last_page(&b) : page-1;
            else if (k == KEY_ENTER || k == KEY_R || k == 194) {
                if (show(image, &b, page, "Refreshing...")) break;
                note = refresh(&b) ? "Offline - showing saved data" : NULL;
                if (page > last_page(&b)) page = 0;
            }
        }
    }
    close(keys[0].fd); close(keys[1].fd);
    unlink(image);
    close(lock);
    return 0;
}
