/*
 * Terrasight design mock-ups — standalone viewer.
 * Renders the <x-dc> template of a *.dc.html file in a normal browser:
 *   {{path}} holes, <sc-if value>, <sc-for list as>, on* event bindings, setState re-render.
 * Language: add ?lang=en or ?lang=uk to the URL (the in-page UA/EN switch also works).
 * This is a minimal viewer for reference only — not production code.
 */
(function () {
  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState(patch) {
      const next = typeof patch === "function" ? patch(this.state) : patch;
      this.state = Object.assign({}, this.state, next);
      if (this.__render) this.__render();
    }
  }

  function resolve(path, scopes) {
    if (path === "true") return true;
    if (path === "false") return false;
    const parts = path.split(".");
    for (const s of scopes) {
      if (s && Object.prototype.hasOwnProperty.call(s, parts[0])) {
        let v = s[parts[0]];
        for (let i = 1; i < parts.length; i++) v = v == null ? undefined : v[parts[i]];
        return v;
      }
    }
    return undefined;
  }

  const HOLE = /\{\{\s*([\w.]+)\s*\}\}/g;
  const ONLY = /^\{\{\s*([\w.]+)\s*\}\}$/;
  const interp = (str, scopes) => str.replace(HOLE, (_, p) => {
    const v = resolve(p, scopes);
    return v == null ? "" : String(v);
  });
  const truthy = (v) => !(v === false || v === "false" || v == null || v === "" || v === 0);

  // event handlers live in el.__h so a later render can swap them without re-binding
  function setHandler(el, type, fn) {
    el.__h = el.__h || {};
    el.__on = el.__on || {};
    el.__h[type] = fn;
    if (!el.__on[type]) {
      el.__on[type] = true;
      el.addEventListener(type, (e) => { const f = el.__h && el.__h[type]; if (f) f(e); });
    }
  }

  // patch the live DOM to match a freshly rendered tree, so running CSS animations are kept
  function morph(oldN, newN) {
    if (oldN.nodeType !== newN.nodeType || oldN.nodeName !== newN.nodeName) {
      oldN.parentNode.replaceChild(newN, oldN);
      return;
    }
    if (oldN.nodeType === 3) { if (oldN.nodeValue !== newN.nodeValue) oldN.nodeValue = newN.nodeValue; return; }
    if (oldN.nodeType !== 1) return;
    for (const a of Array.from(oldN.attributes)) if (!newN.hasAttribute(a.name)) oldN.removeAttribute(a.name);
    for (const a of Array.from(newN.attributes)) if (oldN.getAttribute(a.name) !== a.value) oldN.setAttribute(a.name, a.value);
    if ("value" in newN && oldN.value !== newN.value && document.activeElement !== oldN) oldN.value = newN.value;
    const nh = newN.__h || {};
    for (const type of Object.keys(nh)) setHandler(oldN, type, nh[type]);
    if (oldN.__h) for (const type of Object.keys(oldN.__h)) if (!nh[type]) oldN.__h[type] = null;
    morphChildren(oldN, newN);
  }
  function morphChildren(oldP, newP) {
    const o = Array.from(oldP.childNodes), n = Array.from(newP.childNodes);
    for (let i = 0; i < n.length; i++) {
      if (i < o.length) morph(o[i], n[i]);
      else oldP.appendChild(n[i]);
    }
    for (let i = n.length; i < o.length; i++) oldP.removeChild(o[i]);
  }

  function processChildren(srcParent, dstParent, scopes) {
    for (const node of Array.from(srcParent.childNodes)) processNode(node, dstParent, scopes);
  }

  function processNode(node, dst, scopes) {
    if (node.nodeType === 3) { dst.appendChild(document.createTextNode(interp(node.nodeValue, scopes))); return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (tag === "sc-if") {
      const raw = node.getAttribute("value") || "";
      const m = raw.match(ONLY);
      const v = m ? resolve(m[1], scopes) : raw;
      if (truthy(v)) processChildren(node, dst, scopes);
      return;
    }
    if (tag === "sc-for") {
      const m = (node.getAttribute("list") || "").match(ONLY);
      const list = m ? resolve(m[1], scopes) : [];
      const as = node.getAttribute("as") || "item";
      (list || []).forEach((item, index) => {
        processChildren(node, dst, [{ [as]: item, index }].concat(scopes));
      });
      return;
    }
    const isSvg = node.namespaceURI === "http://www.w3.org/2000/svg";
    const el = isSvg ? document.createElementNS(node.namespaceURI, node.tagName) : document.createElement(node.tagName);
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name;
      if (name.startsWith("hint-")) continue;
      const only = attr.value.match(ONLY);
      if (/^on[a-z]+$/i.test(name) && only) {
        const fn = resolve(only[1], scopes);
        if (typeof fn === "function") setHandler(el, name.slice(2).toLowerCase(), fn);
        continue;
      }
      const val = interp(attr.value, scopes);
      el.setAttribute(name, val);
      if (name === "value" && "value" in el) el.value = val;
      if (name === "checked" && "checked" in el) el.checked = truthy(val);
    }
    if (tag === "template") { processChildren(node.content, el.content, scopes); }
    else processChildren(node, el, scopes);
    dst.appendChild(el);
  }

  function boot() {
    const host = document.querySelector("x-dc");
    const script = document.querySelector("script[data-dc-script]");
    if (!host) return;

    const helmet = host.querySelector("helmet");
    if (helmet) { for (const c of Array.from(helmet.children)) document.head.appendChild(c); helmet.remove(); }

    const tpl = document.createElement("template");
    tpl.innerHTML = host.innerHTML;
    host.innerHTML = "";
    host.style.display = "block";

    let props = {};
    try {
      const spec = JSON.parse(script.getAttribute("data-props") || "{}");
      for (const [k, v] of Object.entries(spec)) if (!k.startsWith("$") && v && "default" in v) props[k] = v.default;
    } catch (e) { /* ignore */ }
    const qs = new URLSearchParams(location.search);
    for (const [k, v] of qs.entries()) props[k] = v;

    const Component = new Function("DCLogic", script.textContent + "\n;return Component;")(DCLogic);
    const inst = new Component(props);
    inst.props = props;
    inst.__render = () => {
      const vals = inst.renderVals ? inst.renderVals() : {};
      const frag = document.createElement("div");
      processChildren(tpl.content, frag, [vals]);
      if (!host.__mounted) { host.replaceChildren(...Array.from(frag.childNodes)); host.__mounted = true; }
      else morphChildren(host, frag);
      if (vals.lang) document.documentElement.lang = vals.lang;
    };
    inst.__render();
    if (inst.componentDidMount) inst.componentDidMount();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
