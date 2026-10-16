/* Diagnostic X11 native attachment bridge. Never operates outside an explicitly
 * authenticated private fixture display. No image is delivered to the host UI. */
#include <X11/Xlib.h>
#include <X11/Xatom.h>
#include <X11/Xutil.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static Display *display;
static int hide_matches = 0, hidden_count = 0;
static int x_error(Display *d, XErrorEvent *event) { (void)d; fprintf(stderr, "X11 diagnostic error: %d request: %d\n", event->error_code, event->request_code); return 0; }
/* Find the owned browser's native window, using process identity rather than title. */
static Window find(Window window, unsigned long pid) {
  Atom actual; int format; unsigned long count, remaining; unsigned char *data = NULL;
  Atom property = XInternAtom(display, "_NET_WM_PID", False);
  if (XGetWindowProperty(display, window, property, 0, 1, False, XA_CARDINAL,
      &actual, &format, &count, &remaining, &data) == Success && data) {
    int matches = count == 1 && format == 32 && *(unsigned long *)data == pid;
    XFree(data);
    XWindowAttributes attrs;
    XGetWindowAttributes(display, window, &attrs);
    if (matches && attrs.width > 100 && attrs.height > 100) {
      if (hide_matches) { XUnmapWindow(display, window); hidden_count++; }
      else return window;
    }
  }
  Window root, parent, *children = NULL; unsigned int length = 0;
  if (!XQueryTree(display, window, &root, &parent, &children, &length)) return 0;
  Window result = 0;
  for (unsigned int i = 0; i < length && !result; i++) result = find(children[i], pid);
  if (children) XFree(children);
  return result;
}
/* Query parent, geometry, focus, and painted native pixels after server synchronization. */
static void inspect(Window window) {
  Window root, parent, *children = NULL, focused; unsigned int count; int revert;
  XWindowAttributes attributes;
  XQueryTree(display, window, &root, &parent, &children, &count);
  if (children) XFree(children);
  XGetWindowAttributes(display, window, &attributes);
  XGetInputFocus(display, &focused, &revert);
  char *name = NULL; XFetchName(display, window, &name);
  if (name) {fprintf(stderr,"Native window name: %s\n",name); XFree(name); }
  printf("{\"window\":%lu,\"root\":%lu,\"parent\":%lu,\"width\":%d,\"height\":%d,\"mapState\":%d,\"focus\":%lu", window, root, parent, attributes.width, attributes.height, attributes.map_state, focused);
  if (attributes.map_state == IsViewable) {
    int x, y; Window child;
    XTranslateCoordinates(display, window, root, 20, 20, &x, &y, &child);
    printf(",\"rootX\":%d,\"rootY\":%d", x, y);
    XImage *image = XGetImage(display, root, x, y, 1, 1, AllPlanes, ZPixmap);
    if (image) {
      printf(",\"topPixel\":%lu", XGetPixel(image, 0, 0));
      XDestroyImage(image);
    }
  }
  puts("}");
}
int main(int argc, char **argv) {
  if (!getenv("PASEO_BROWSER_FIXTURE_PRIVATE_DISPLAY") || argc < 3) return 2;
  XSetErrorHandler(x_error);
  display = XOpenDisplay(NULL);
  if (!display) return 3;
  Window window = strtoul(argv[2], NULL, 10);
  if (!strcmp(argv[1], "wm")) {
    Atom actual; int format; unsigned long count, remaining; unsigned char *data = NULL;
    XGetWindowProperty(display, DefaultRootWindow(display), XInternAtom(display,"_NET_SUPPORTING_WM_CHECK",False),0,1,False,XA_WINDOW,&actual,&format,&count,&remaining,&data);
    printf("%d\n", data && count == 1); if(data) XFree(data);
  } else if (!strcmp(argv[1], "hide-process")) {
    hide_matches = 1; find(DefaultRootWindow(display), window); XSync(display, False);
    printf("{\"hiddenWindows\":%d}\n", hidden_count);
  } else if (!strcmp(argv[1], "find")) {
    printf("%lu\n", find(DefaultRootWindow(display), window));
  } else {
    if (!strcmp(argv[1], "attach") && argc == 7) {
      XSetWindowAttributes embedded; embedded.override_redirect = True;
      XChangeWindowAttributes(display, window, CWOverrideRedirect, &embedded);
      XReparentWindow(display, window, strtoul(argv[3], NULL, 10), 0, 60);
      XResizeWindow(display, window, atoi(argv[4]), atoi(argv[5]));
      if (atoi(argv[6])) XMapWindow(display, window);
    } else if (!strcmp(argv[1], "withdraw")) XWithdrawWindow(display, window, DefaultScreen(display));
    else if (!strcmp(argv[1], "resize") && argc == 5) {
      XResizeWindow(display, window, atoi(argv[3]), atoi(argv[4]));
    } else if (!strcmp(argv[1], "hide")) XUnmapWindow(display, window);
    else if (!strcmp(argv[1], "show")) XMapWindow(display, window);
    else if (strcmp(argv[1], "inspect")) return 4;
    XSync(display, False);
    inspect(window);
  }
  XCloseDisplay(display);
  return 0;
}
