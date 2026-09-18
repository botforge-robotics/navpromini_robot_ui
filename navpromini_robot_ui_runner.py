#!/usr/bin/env python3
"""
NavPro Mini - Native Headless WebKitGTK Kiosk Runner
Embeds the Web UI in a dedicated, borderless, fullscreen GTK3 window with WebGL,
hardware acceleration, touch support, and zero browser chrome.
"""

import os
import sys
import time
import signal
import socket
import subprocess
import threading
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler

# Enable hardware compositing for WebKitGTK
os.environ.setdefault("WEBKIT_FORCE_COMPOSITING_MODE", "1")
os.environ.setdefault("WEBKIT_DISABLE_COMPOSITING_MODE", "0")

import gi
gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import Gtk, WebKit2, Gdk, GLib

PORT = 8090

def is_port_open(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(('127.0.0.1', port)) == 0

def start_internal_server(ui_dir, port=8090):
    class QuietHandler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(ui_dir), **kwargs)
        def log_message(self, format, *args):
            pass

    server = HTTPServer(('127.0.0.1', port), QuietHandler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server

class RobotKioskWindow(Gtk.Window):
    def __init__(self, target_url):
        super().__init__(type=Gtk.WindowType.TOPLEVEL)
        self.set_title("NavPro Mini")
        self.set_decorated(False)
        self.set_default_size(800, 1280)

        # Light theme window background (#F3F4F9)
        bg = Gdk.RGBA()
        bg.parse("#F3F4F9")
        try:
            self.override_background_color(Gtk.StateFlags.NORMAL, bg)
        except Exception:
            pass

        # Ephemeral WebKit Context & Zero Disk Cache
        data_manager = WebKit2.WebsiteDataManager.new_ephemeral()
        context = WebKit2.WebContext.new_with_website_data_manager(data_manager)
        context.set_cache_model(WebKit2.CacheModel.DOCUMENT_VIEWER)

        # WebKit Settings & GPU Acceleration
        settings = WebKit2.Settings()
        settings.set_enable_webgl(True)
        try:
            settings.set_enable_accelerated_2d_canvas(True)
        except Exception:
            pass
        try:
            settings.set_hardware_acceleration_policy(WebKit2.HardwareAccelerationPolicy.ALWAYS)
        except Exception:
            pass
        settings.set_enable_smooth_scrolling(True)
        settings.set_javascript_can_open_windows_automatically(False)
        settings.set_media_playback_allows_inline(True)
        try:
            settings.set_media_playback_requires_user_gesture(False)
        except Exception:
            pass
        try:
            settings.set_enable_webaudio(True)
        except Exception:
            pass
        settings.set_enable_developer_extras(True)
        try:
            settings.set_enable_write_console_messages_to_stdout(True)
        except Exception:
            pass
        settings.set_zoom_text_only(False)

        # WebKit WebView with Ephemeral Context
        self.webview = WebKit2.WebView.new_with_context(context)
        self.webview.set_settings(settings)
        # Suppress context menu for clean touch kiosk experience
        self.webview.connect('context-menu', lambda *args: True)

        # Strictly enforce 1.0 zoom level — prevent browser pinch/zoom scaling
        self.webview.set_zoom_level(1.0)
        def _lock_zoom(wv, pspec):
            if wv.get_zoom_level() != 1.0:
                wv.set_zoom_level(1.0)
        self.webview.connect('notify::zoom-level', _lock_zoom)

        # Block native GTK pinch-to-zoom gestures from scaling the webview
        try:
            self.zoom_gesture = Gtk.GestureZoom.new(self.webview)
            self.zoom_gesture.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)
            def _claim_zoom(gesture, *args):
                gesture.set_state(Gtk.EventSequenceState.CLAIMED)
            self.zoom_gesture.connect('scale-changed', _claim_zoom)
        except Exception:
            pass

        # Intercept Ctrl+scroll to prevent browser zoom
        def _on_scroll(widget, event):
            if event.state & Gdk.ModifierType.CONTROL_MASK:
                return True
            return False
        self.webview.connect('scroll-event', _on_scroll)

        try:
            self.webview.override_background_color(Gtk.StateFlags.NORMAL, bg)
        except Exception:
            pass

        self.add(self.webview)
        self.connect('destroy', Gtk.main_quit)

        # Enforce fullscreen and keep-above
        self.fullscreen()
        self.set_keep_above(True)

        self.webview.load_uri(target_url)
        self.show_all()
        self.webview.grab_focus()

        GLib.timeout_add(1000, self._keep_fullscreen)

    def _keep_fullscreen(self):
        self.fullscreen()
        self.set_keep_above(True)
        return False

def start_eval_server(win, port=8092):
    class EvalHandler(SimpleHTTPRequestHandler):
        def do_POST(self):
            content_len = int(self.headers.get('Content-Length', 0))
            post_body = self.rfile.read(content_len).decode('utf-8')
            def _callback(wv, res, user_data):
                try:
                    js_res = wv.run_javascript_finish(res)
                    val = js_res.get_js_value()
                    with open('/tmp/eval_result.txt', 'w') as f:
                        f.write(val.to_string() if val else 'null')
                except Exception as ex:
                    with open('/tmp/eval_result.txt', 'w') as f:
                        f.write(f'ERROR_CALLBACK: {ex}')

            def _exec():
                try:
                    win.webview.run_javascript(post_body, None, _callback, None)
                except Exception as ex:
                    with open('/tmp/eval_result.txt', 'w') as f:
                        f.write(f'ERROR_EXEC: {ex}')
                return False
            GLib.idle_add(_exec)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}\n')
        def log_message(self, format, *args):
            pass

    try:
        server = HTTPServer(('127.0.0.1', port), EvalHandler)
        t = threading.Thread(target=server.serve_forever, daemon=True)
        t.start()
        print(f"[Kiosk] Local automation eval server listening on port {port}")
    except Exception as e:
        print(f"[Kiosk] Could not start eval server: {e}")

def main():
    script_dir = Path(__file__).resolve().parent
    
    # Check if UI files are alongside runner or in AppDir structure
    ui_dir = script_dir
    if (script_dir / "usr" / "share" / "navpromini-robot-ui").is_dir():
        ui_dir = script_dir / "usr" / "share" / "navpromini-robot-ui"

    url = f"http://127.0.0.1:{PORT}/"
    if len(sys.argv) > 1 and sys.argv[1].startswith("http"):
        url = sys.argv[1]

    if not is_port_open(PORT):
        print(f"[Kiosk] Port {PORT} offline. Starting internal HTTP server on port {PORT}...")
        start_internal_server(ui_dir, PORT)
        time.sleep(0.5)

    print(f"[Kiosk] Launching Headless Robot UI window pointing to {url}")
    signal.signal(signal.SIGINT, signal.SIG_DFL)
    signal.signal(signal.SIGTERM, signal.SIG_DFL)

    win = RobotKioskWindow(url)
    start_eval_server(win, port=8092)
    Gtk.main()

if __name__ == "__main__":
    main()
