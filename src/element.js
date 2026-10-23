// <garmin-heatmap src="/assets/garmin.json" metric="distance" types="running"></garmin-heatmap>
//
// Attributes are the options in OPTION_NAMES (see render.js). Set `data`
// instead of `src` to pass a dataset directly. Several elements with the same
// `src` share one request.

import { OPTION_NAMES, parseOptions, renderHeatmap } from './render.js';

const requests = new Map();

function load(src) {
  const url = new URL(src, document.baseURI).href;
  if (!requests.has(url)) {
    requests.set(
      url,
      fetch(url).then((res) => {
        if (!res.ok) throw new Error(`Could not load ${url}: HTTP ${res.status}`);
        return res.json();
      })
    );
  }
  return requests.get(url);
}

export class GarminHeatmap extends HTMLElement {
  static observedAttributes = ['src', ...OPTION_NAMES];

  #data = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML =
      '<style>:host{display:block}svg{display:block}.error{font:12px system-ui,sans-serif;opacity:.6}</style><div part="grid"></div>';
  }

  get data() {
    return this.#data;
  }

  set data(value) {
    this.#data = value;
    this.#render();
  }

  connectedCallback() {
    this.#update();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (!this.isConnected || oldValue === newValue) return;
    if (name === 'src') this.#update();
    else this.#render();
  }

  async #update() {
    const src = this.getAttribute('src');
    if (!src) return this.#render();
    try {
      const data = await load(src);
      if (this.getAttribute('src') === src) this.data = data;
    } catch (error) {
      this.#show(error);
    }
  }

  #render() {
    if (!this.#data) return;
    try {
      const attributes = Object.fromEntries(OPTION_NAMES.map((name) => [name, this.getAttribute(name)]));
      this.shadowRoot.querySelector('[part=grid]').innerHTML = renderHeatmap(this.#data, parseOptions(attributes));
    } catch (error) {
      this.#show(error);
    }
  }

  #show(error) {
    const box = this.shadowRoot.querySelector('[part=grid]');
    box.innerHTML = '<p class="error"></p>';
    box.firstChild.textContent = `Garmin heatmap unavailable: ${error.message}`;
    console.error(error);
  }
}

if (!customElements.get('garmin-heatmap')) customElements.define('garmin-heatmap', GarminHeatmap);
