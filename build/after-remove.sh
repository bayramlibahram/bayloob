#!/bin/bash
# Bayloob postrm — removes only the package's own files; never touches ~/.claude/settings.json
rm -f '/usr/bin/bayloob'
if [ -f /etc/apparmor.d/bayloob ]; then
  if hash apparmor_parser 2>/dev/null; then apparmor_parser -R /etc/apparmor.d/bayloob 2>/dev/null || true; fi
  rm -f /etc/apparmor.d/bayloob
fi
rm -rf '/usr/share/gnome-shell/extensions/bayloob@baynovix.com'
