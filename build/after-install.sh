#!/bin/bash
# Bayloob postinst

ln -sf '/opt/Bayloob/bayloob' '/usr/bin/bayloob'

# Hooks moved from resources/scripts to resources/hooks in 0.5; keep the old path working for
# hooks that earlier versions wrote into ~/.claude/settings.json
[ -e /opt/Bayloob/resources/scripts ] || ln -s hooks /opt/Bayloob/resources/scripts

# Ubuntu 24.04+: AppArmor restricts user namespaces for unprivileged users.
# Give Bayloob its own profile so Chromium's sandbox can start.
if [ -f /etc/apparmor.d/abi/4.0 ]; then
  cat > /etc/apparmor.d/bayloob <<'PROFILE'
abi <abi/4.0>,
include <tunables/global>

profile bayloob /opt/Bayloob/bayloob flags=(unconfined) {
  userns,
  include if exists <local/bayloob>
}
PROFILE
  if hash apparmor_parser 2>/dev/null; then
    apparmor_parser -r /etc/apparmor.d/bayloob 2>/dev/null || true
  fi
fi

# Fallback if the AppArmor profile fails to load: the SUID sandbox
chmod 4755 '/opt/Bayloob/chrome-sandbox' || true

# GNOME Shell extension for window listing/focus on Wayland; each user enables it once
# (Bayloob settings, or: gnome-extensions enable bayloob@baynovix.com)
EXT_DIR='/usr/share/gnome-shell/extensions/bayloob@baynovix.com'
mkdir -p "$EXT_DIR"
cp -f /opt/Bayloob/resources/gnome-extension/* "$EXT_DIR"/ 2>/dev/null || true

if hash update-desktop-database 2>/dev/null; then
  update-desktop-database /usr/share/applications || true
fi
if hash gtk-update-icon-cache 2>/dev/null; then
  gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
fi
