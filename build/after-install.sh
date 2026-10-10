#!/bin/bash
# Bayloob postinst

ln -sf '/opt/Bayloob/bayloob' '/usr/bin/bayloob'

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

if hash update-desktop-database 2>/dev/null; then
  update-desktop-database /usr/share/applications || true
fi
if hash gtk-update-icon-cache 2>/dev/null; then
  gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
fi
