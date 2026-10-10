#!/usr/bin/env python3
"""Brings an X11/XWayland window to the front — needs only python3 + libX11 (both ship with Ubuntu).

Usage:
  x11-focus.py --window 0x3a00007         # when WINDOWID is known
  x11-focus.py --pids 1234 1200 900       # the window owned by one of the hook's ancestors
Exit code: 0 = found and activated, 1 = not found, 2 = X11 unavailable
"""
import ctypes
import ctypes.util
import sys

lib = ctypes.util.find_library('X11')
if not lib:
    sys.exit(2)
x = ctypes.cdll.LoadLibrary(lib)

Window = ctypes.c_ulong
Atom = ctypes.c_ulong
x.XOpenDisplay.restype = ctypes.c_void_p
x.XOpenDisplay.argtypes = [ctypes.c_char_p]
x.XDefaultRootWindow.restype = Window
x.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
x.XInternAtom.restype = Atom
x.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
x.XGetWindowProperty.argtypes = [ctypes.c_void_p, Window, Atom, ctypes.c_long, ctypes.c_long, ctypes.c_int, Atom,
                                 ctypes.POINTER(Atom), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_ulong),
                                 ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_void_p)]
x.XFree.argtypes = [ctypes.c_void_p]
x.XRaiseWindow.argtypes = [ctypes.c_void_p, Window]
x.XFlush.argtypes = [ctypes.c_void_p]
x.XCloseDisplay.argtypes = [ctypes.c_void_p]


class XClientMessageEvent(ctypes.Structure):
    _fields_ = [('type', ctypes.c_int), ('serial', ctypes.c_ulong), ('send_event', ctypes.c_int),
                ('display', ctypes.c_void_p), ('window', Window), ('message_type', Atom),
                ('format', ctypes.c_int), ('l', ctypes.c_long * 5)]


class XEvent(ctypes.Union):
    _fields_ = [('xclient', XClientMessageEvent), ('pad', ctypes.c_long * 24)]


x.XSendEvent.argtypes = [ctypes.c_void_p, Window, ctypes.c_int, ctypes.c_long, ctypes.POINTER(XEvent)]

d = x.XOpenDisplay(None)
if not d:
    sys.exit(2)
root = x.XDefaultRootWindow(d)
A = lambda name: x.XInternAtom(d, name.encode(), 0)


def get_prop(win, atom, max_len=4096):
    t, f, n, after, data = Atom(), ctypes.c_int(), ctypes.c_ulong(), ctypes.c_ulong(), ctypes.c_void_p()
    if x.XGetWindowProperty(d, win, atom, 0, max_len, 0, 0, ctypes.byref(t), ctypes.byref(f), ctypes.byref(n),
                            ctypes.byref(after), ctypes.byref(data)) != 0 or not data.value:
        return []
    vals = [ctypes.cast(data, ctypes.POINTER(ctypes.c_ulong))[i] for i in range(n.value)] if f.value == 32 else []
    x.XFree(data)
    return vals


def activate(win):
    ev = XEvent()
    ev.xclient.type = 33  # ClientMessage
    ev.xclient.send_event = 1
    ev.xclient.window = win
    ev.xclient.message_type = A('_NET_ACTIVE_WINDOW')
    ev.xclient.format = 32
    ev.xclient.l[0] = 2  # source: pager/user action — passes the WM's focus-stealing prevention
    ev.xclient.l[1] = 0
    # SubstructureRedirectMask | SubstructureNotifyMask
    x.XSendEvent(d, root, 0, (1 << 20) | (1 << 19), ctypes.byref(ev))
    x.XRaiseWindow(d, win)
    x.XFlush(d)


args = sys.argv[1:]
target = None
if args[:1] == ['--window'] and len(args) > 1:
    target = int(args[1], 0)
elif args[:1] == ['--pids']:
    pids = [int(p) for p in args[1:] if p.isdigit()]
    clients = get_prop(root, A('_NET_CLIENT_LIST'))
    owner = {}
    for w in clients:
        p = get_prop(w, A('_NET_WM_PID'), 1)
        if p:
            owner.setdefault(p[0], w)
    # The closest ancestor wins (the list goes from child to parent)
    for p in pids:
        if p in owner:
            target = owner[p]
            break

if not target:
    x.XCloseDisplay(d)
    sys.exit(1)
activate(target)
x.XCloseDisplay(d)
sys.exit(0)
