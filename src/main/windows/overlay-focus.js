/** Native focus options for the overlay; Linux cannot change focusability after window creation. */
function overlayFocusOptions(linux = process.platform === "linux") {
  return {
    // A focusable Linux window would otherwise steal focus as soon as Bayloob starts.
    show: !linux,
    // The dock must start focusable so its inline reply field can receive keyboard input. Other
    // platforms opt in only while typing.
    focusable: linux,
  };
}

module.exports = { overlayFocusOptions };
