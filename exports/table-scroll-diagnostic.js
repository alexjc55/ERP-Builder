// Paste into the browser console on the affected table, first as the user and
// then as admin. Read-only: no API requests, DOM changes, storage, or row values.
(() => {
  const rect = el => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  };
  const box = el => {
    const s = getComputedStyle(el);
    return {
      tag: el.tagName, ...rect(el),
      clientWidth: el.clientWidth, scrollWidth: el.scrollWidth,
      clientHeight: el.clientHeight, scrollHeight: el.scrollHeight,
      scrollLeft: el.scrollLeft, scrollTop: el.scrollTop,
      overflowX: s.overflowX, overflowY: s.overflowY,
      display: s.display, position: s.position,
      minWidth: s.minWidth, maxWidth: s.maxWidth, tableLayout: s.tableLayout,
    };
  };
  console.log(JSON.stringify({
    viewport: { width: innerWidth, height: innerHeight, scale: devicePixelRatio, dir: document.documentElement.dir },
    tables: Array.from(document.querySelectorAll("main table")).map((table, index) => {
      const ancestors = [];
      for (let p = table.parentElement; p; p = p.parentElement) {
        ancestors.push(box(p));
        if (p.tagName === "BODY") break;
      }
      return {
        index, table: box(table), ancestors,
        headers: Array.from(table.querySelectorAll("thead th")).map((th, column) => {
          const s = getComputedStyle(th);
          return { column, ...box(th), left: s.left, right: s.right, insetInlineStart: s.insetInlineStart, zIndex: s.zIndex };
        }),
      };
    }),
  }, null, 2));
})();