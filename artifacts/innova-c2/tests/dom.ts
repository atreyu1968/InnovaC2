import { JSDOM } from "jsdom";

// Loaded before React Testing Library. No running app, login, DB or provider.
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://synthetic.invalid/",
});
for (const [name, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
