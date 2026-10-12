// Light or dark, as the old pages do (ui-common.js): follow prefers-color-scheme, which main points at the
// System / Light / Dark setting. theme.css swaps the tokens on <html data-theme>.
export function followTheme() {
  const light = matchMedia("(prefers-color-scheme: light)");
  const apply = () => {
    document.documentElement.dataset.theme = light.matches ? "light" : "dark";
  };
  apply();
  light.addEventListener("change", apply);
}
