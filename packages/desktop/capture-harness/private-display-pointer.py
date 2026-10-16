"""Read painted X11 root pixels and send actual XTest clicks on a private fixture display.

Uses the same installed X11/XTest mechanism as private-display-keys.py. No user
display, DOM input approximation, package install or operating-system setting change.
"""
import ctypes as c
import ctypes.util
import json
import os
import select
import struct
import sys
import time
import zlib

if os.environ.get("PASEO_BROWSER_FIXTURE_PRIVATE_DISPLAY") != "1":
    raise RuntimeError("authenticated private fixture display required")
display_name = os.environ.get("DISPLAY", "")
if not display_name.startswith(":") or int(display_name[1:]) < 20000:
    raise RuntimeError("human/shared display rejected")
if not os.environ.get("XAUTHORITY"):
    raise RuntimeError("private display authentication required")

x = c.CDLL(ctypes.util.find_library("X11"))
t = c.CDLL(ctypes.util.find_library("Xtst"))
x.XOpenDisplay.restype = c.c_void_p
x.XDefaultRootWindow.argtypes = [c.c_void_p]
x.XDefaultRootWindow.restype = c.c_ulong
x.XSync.argtypes = [c.c_void_p, c.c_int]
x.XCloseDisplay.argtypes = [c.c_void_p]
x.XGetImage.argtypes = [c.c_void_p, c.c_ulong, c.c_int, c.c_int, c.c_uint, c.c_uint, c.c_ulong, c.c_int]
x.XGetImage.restype = c.c_void_p
x.XDestroyImage.argtypes = [c.c_void_p]
x.XGetPixel.argtypes = [c.c_void_p, c.c_int, c.c_int]
x.XGetPixel.restype = c.c_ulong
t.XTestFakeMotionEvent.argtypes = [c.c_void_p, c.c_int, c.c_int, c.c_int, c.c_ulong]
t.XTestFakeButtonEvent.argtypes = [c.c_void_p, c.c_uint, c.c_int, c.c_ulong]
x.XStringToKeysym.argtypes = [c.c_char_p]
x.XStringToKeysym.restype = c.c_ulong
x.XKeysymToKeycode.argtypes = [c.c_void_p, c.c_ulong]
x.XKeysymToKeycode.restype = c.c_uint
t.XTestFakeKeyEvent.argtypes = [c.c_void_p, c.c_uint, c.c_int, c.c_ulong]
x.XGetInputFocus.argtypes = [c.c_void_p, c.POINTER(c.c_ulong), c.POINTER(c.c_int)]
x.XQueryPointer.argtypes = [c.c_void_p, c.c_ulong, c.POINTER(c.c_ulong), c.POINTER(c.c_ulong),
                          c.POINTER(c.c_int), c.POINTER(c.c_int), c.POINTER(c.c_int),
                          c.POINTER(c.c_int), c.POINTER(c.c_uint)]

class XImage(c.Structure):
    _fields_ = [("width", c.c_int), ("height", c.c_int), ("xoffset", c.c_int), ("format", c.c_int),
                ("data", c.c_void_p), ("byte_order", c.c_int), ("bitmap_unit", c.c_int),
                ("bitmap_bit_order", c.c_int), ("bitmap_pad", c.c_int), ("depth", c.c_int),
                ("bytes_per_line", c.c_int), ("bits_per_pixel", c.c_int),
                ("red_mask", c.c_ulong), ("green_mask", c.c_ulong), ("blue_mask", c.c_ulong)]

def chunk(kind, data):
    return struct.pack("!I", len(data)) + kind + data + struct.pack("!I", zlib.crc32(kind + data))

def read_pixels(display, points):
    """Read small real compositor samples without requesting browser captures."""
    pixels = []
    for px, py in points:
        pointer = x.XGetImage(display, x.XDefaultRootWindow(display), px, py, 1, 1, c.c_ulong(-1).value, 2)
        if not pointer:
            raise RuntimeError("painted root pixel unavailable")
        try:
            value = x.XGetPixel(pointer, 0, 0)
            pixels.append([(value >> 16) & 255, (value >> 8) & 255, value & 255])
        finally:
            x.XDestroyImage(pointer)
    return pixels

def read_native_focus(display):
    """Read exact OS focus and pointer window path without focusing or moving it."""
    focused = c.c_ulong()
    revert = c.c_int()
    x.XGetInputFocus(display, c.byref(focused), c.byref(revert))
    window = x.XDefaultRootWindow(display)
    windows = [window]
    root_x, root_y, mask = c.c_int(), c.c_int(), c.c_uint()
    for _ in range(16):
        root, child = c.c_ulong(), c.c_ulong()
        local_x, local_y = c.c_int(), c.c_int()
        success = x.XQueryPointer(display, window, c.byref(root), c.byref(child),
                                 c.byref(root_x), c.byref(root_y), c.byref(local_x),
                                 c.byref(local_y), c.byref(mask))
        if not success or not child.value or child.value in windows:
            break
        window = child.value
        windows.append(window)
    return {"recordedMonotonicNs": time.monotonic_ns(), "focusWindow": focused.value,
            "revertTo": revert.value, "pointerWindowPath": windows,
            "pointerRootXY": [root_x.value, root_y.value], "pointerMask": mask.value}

def observe_capture(display, options):
    """Bound compositor sampling and one trusted input gesture to an owned capture.

    Pixel sampling is finite, not exhaustive transient-layer visibility proof.
    The caller sends click once, observes its receiver/focus, then key once.
    EOF/deadline closes this native client; no native focus repair is performed.
    """
    points = options["points"]
    character = options.get("character")
    if character not in ("a", "b"):
        raise RuntimeError("only the distinct admitted baseline/capture keys are supported")
    baseline = read_pixels(display, points)
    ready_deadline = time.monotonic_ns() + 2_000_000_000
    while baseline != options["expectedPixels"]:
        if time.monotonic_ns() >= ready_deadline:
            raise RuntimeError("selected host probe did not paint before observation")
        baseline = read_pixels(display, points)
    started = time.monotonic_ns()
    last = started
    largest_gap = 0
    samples = 0
    changes = []
    sent_input = False
    sent_click = False
    focus_receipts = {"ready": read_native_focus(display)}
    ended = "deadline"
    print(json.dumps({"state": "ready", "baseline": baseline, "startedMonotonicNs": started,
                      "nativeFocus": focus_receipts["ready"]}), flush=True)
    while time.monotonic_ns() - started < 5_000_000_000:
        if select.select([sys.stdin], [], [], 0)[0]:
            command = sys.stdin.readline().strip()
            if command == "done" or not command:
                ended = "done" if command else "eof"
                break
            if command == "click" and not sent_click:
                px, py = options["input"]
                focus_receipts["beforeClick"] = read_native_focus(display)
                operations = [(t.XTestFakeMotionEvent, (display, -1, px, py, 0)),
                              (t.XTestFakeButtonEvent, (display, 1, 1, 0)),
                              (t.XTestFakeButtonEvent, (display, 1, 0, 0))]
            elif command == "key" and sent_click and not sent_input:
                focus_receipts["beforeKey"] = read_native_focus(display)
                key = x.XKeysymToKeycode(display, x.XStringToKeysym(character.encode("ascii")))
                if not key:
                    raise RuntimeError("observer native key unavailable")
                operations = [(t.XTestFakeKeyEvent, (display, key, 1, 0)),
                              (t.XTestFakeKeyEvent, (display, key, 0, 0))]
            else:
                raise RuntimeError("observer input replay or out-of-order key rejected")
            for function, arguments in operations:
                if not function(*arguments):
                    raise RuntimeError("observer native input failed")
            x.XSync(display, 0)
            if command == "click":
                sent_click = True
                focus_receipts["afterClick"] = read_native_focus(display)
            else:
                sent_input = True
                focus_receipts["afterKey"] = read_native_focus(display)
        pixels = read_pixels(display, points)
        now = time.monotonic_ns()
        largest_gap = max(largest_gap, now - last)
        last = now
        samples += 1
        if pixels != baseline and len(changes) < 16:
            changes.append({"elapsedNs": now - started, "pixels": pixels})
    focus_receipts["finished"] = read_native_focus(display)
    print(json.dumps({"state": "finished", "samples": samples, "character": character,
                     "nativeFocus": focus_receipts,
                     "startedMonotonicNs": started, "finishedMonotonicNs": time.monotonic_ns(),
                     "largestSampleGapNs": largest_gap, "changes": changes,
                     "sentClick": sent_click, "sentInput": sent_input, "ended": ended,
                     "coverage": "finite XGetImage samples and one XTest gesture; not exhaustive native-layer events"}), flush=True)

d = x.XOpenDisplay(None)
if not d:
    raise RuntimeError("private display unavailable")
try:
    operation = sys.argv[1]
    if operation == "observe-capture":
        observe_capture(d, json.loads(sys.argv[2]))
    elif operation in ("click", "context-click"):
        px, py = map(int, sys.argv[2:4])
        button = 3 if operation == "context-click" else 1
        before_focus = read_native_focus(d) if operation == "context-click" else None
        if not t.XTestFakeMotionEvent(d, -1, px, py, 0):
            raise RuntimeError("XTest motion failed")
        if not t.XTestFakeButtonEvent(d, button, 1, 0):
            raise RuntimeError("XTest button press failed")
        if not t.XTestFakeButtonEvent(d, button, 0, 0):
            raise RuntimeError("XTest button release failed")
        x.XSync(d, 0)
        result = {"mechanism": "X11 XTest", "x": px, "y": py}
        if operation == "context-click":
            result.update({"button": button, "beforeFocus": before_focus,
                           "afterFocus": read_native_focus(d)})
        print(json.dumps(result))
    elif operation == "probe":
        points = json.loads(sys.argv[2])
        x.XSync(d, 0)
        pixels = read_pixels(d, points)
        print(json.dumps({"mechanism": "XGetImage root composition", "pixels": pixels}))
    elif operation == "capture":
        px, py, width, height = map(int, sys.argv[2:6])
        x.XSync(d, 0)
        pointer = x.XGetImage(d, x.XDefaultRootWindow(d), px, py, width, height, c.c_ulong(-1).value, 2)
        if not pointer:
            raise RuntimeError("painted root image unavailable")
        try:
            image = c.cast(pointer, c.POINTER(XImage)).contents
            if (image.bits_per_pixel, image.byte_order, image.red_mask, image.green_mask, image.blue_mask) != (32, 0, 0xff0000, 0xff00, 0xff):
                raise RuntimeError("unsupported XImage pixel format")
            raw = c.string_at(image.data, image.bytes_per_line * height)
            rows = bytearray()
            for y in range(height):
                rows.append(0)
                row = raw[y * image.bytes_per_line:y * image.bytes_per_line + width * 4]
                for offset in range(0, len(row), 4):
                    rows.extend((row[offset + 2], row[offset + 1], row[offset]))
            png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack("!2I5B", width, height, 8, 2, 0, 0, 0))
            png += chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")
            with open(sys.argv[6], "wb") as output:
                output.write(png)
            print(json.dumps({"mechanism": "XGetImage root composition", "width": width, "height": height}))
        finally:
            x.XDestroyImage(pointer)
    else:
        raise RuntimeError("unsupported private display operation")
finally:
    x.XCloseDisplay(d)
