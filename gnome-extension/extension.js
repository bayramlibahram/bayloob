// Bayloob window bridge for GNOME Shell.
// On Wayland an app can neither list other apps' windows nor raise them. This extension runs inside the
// shell and offers both over D-Bus, so Bayloob can show running windows and "Focus window" works:
//
//   gdbus call --session --dest org.gnome.Shell --object-path /com/baynovix/Bayloob \
//     --method com.baynovix.Bayloob.Windows.List
import Gio from "gi://Gio";
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

const OBJECT_PATH = "/com/baynovix/Bayloob";
const VERSION = 2; // 2: Panel
const IFACE = `
<node>
  <interface name="com.baynovix.Bayloob.Windows">
    <method name="Ping"><arg type="u" direction="out" name="version"/></method>
    <method name="List"><arg type="s" direction="out" name="windowsJson"/></method>
    <method name="Panel"><arg type="s" direction="out" name="panelJson"/></method>
    <method name="Activate">
      <arg type="t" direction="in" name="windowId"/>
      <arg type="b" direction="out" name="activated"/>
    </method>
  </interface>
</node>`;

class WindowBridge {
  Ping() {
    return VERSION;
  }

  // Normal, user-visible windows only (no menus, tooltips or the shell's own surfaces)
  #windows() {
    return global
      .get_window_actors()
      .map(actor => actor.get_meta_window())
      .filter(
        win => win && !win.is_skip_taskbar() && win.get_window_type() === Meta.WindowType.NORMAL
      );
  }

  List() {
    const tracker = Shell.WindowTracker.get_default();
    const windows = this.#windows().map(win => {
      const app = tracker.get_window_app(win);
      return {
        id: String(win.get_id()), // 64-bit; sent as a string so JSON keeps it exact
        title: win.get_title() || "",
        pid: win.get_pid(),
        wmClass: win.get_wm_class() || "",
        appId: app?.get_id() || "", // desktop file id, e.g. "firefox_firefox.desktop"
        appName: app?.get_name() || "",
        workspace: win.get_workspace()?.index() ?? -1,
        focused: win.has_focus(),
        minimized: win.minimized,
      };
    });
    return JSON.stringify(windows);
  }

  // Where GNOME's top bar is, so the Bayloob pill can sit just below it instead of covering the clock
  Panel() {
    const [x, y] = Main.panel.get_transformed_position();
    const [width, height] = Main.panel.get_transformed_size();
    return JSON.stringify({ x, y, width, height, visible: Main.panel.visible });
  }

  Activate(windowId) {
    const win = this.#windows().find(w => String(w.get_id()) === String(windowId));
    if (!win) {
      return false;
    }
    Main.activateWindow(win); // switches workspace, unminimizes and focuses
    return true;
  }
}

export default class BayloobExtension extends Extension {
  #dbus = null;

  enable() {
    this.#dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, new WindowBridge());
    this.#dbus.export(Gio.DBus.session, OBJECT_PATH);
  }

  disable() {
    this.#dbus?.unexport();
    this.#dbus = null;
  }
}
