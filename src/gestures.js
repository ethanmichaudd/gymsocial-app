/**
 * Touch gestures, in one place:
 *
 * - swipe a sheet down to close it (any bottom sheet, not the centred
 *   "are you sure" box);
 * - swipe a row left to show its buttons, like Mail's Archive / Delete
 *   (press and hold, or the ⋯ button, does the same);
 * - drag an exercise by its ≡ handle to put it somewhere else.
 *
 * All of it also works with a mouse, and none of it is the only way to do
 * something: every swipe has a button that does the same thing.
 */

/* ---------- swipe a sheet down to close ---------- */

/* Grab the top of a sheet (or anywhere, if it's scrolled to the top) and
   pull down. Past about a quarter of its height, or with a quick flick,
   it closes through its own Close/Cancel button, so whatever that button
   normally does still happens. */
function wireSheetSwipe() {
  var drag = null;

  document.addEventListener("touchstart", function (e) {
    var sheet = e.target.closest && e.target.closest(".modal-overlay.open:not(.is-dialog) .modal-sheet");
    if (!sheet || e.touches.length !== 1) { drag = null; return; }
    // text boxes, sliders and maps keep their own touches
    if (e.target.closest("input, textarea, select, .leaflet-container, .equip-scroll, .friend-strip, .board-tabs, .swipe-row, [data-drag]")) { drag = null; return; }
    var onHead = !!e.target.closest(".modal-head");
    // the edit sheet only closes from its top bar: a slip shouldn't drop changes
    if (!onHead && sheet.closest("#edit-modal-overlay")) { drag = null; return; }
    drag = { sheet: sheet, y0: e.touches[0].clientY, x0: e.touches[0].clientX, t0: Date.now(),
      onHead: onHead, dy: 0, live: false, scroll0: sheet.scrollTop };
  }, { passive: true });

  document.addEventListener("touchmove", function (e) {
    if (!drag) return;
    var dy = e.touches[0].clientY - drag.y0;
    var dx = e.touches[0].clientX - drag.x0;
    if (!drag.live) {
      if (Math.abs(dy) < 8) return;
      // only a downward pull, from the top bar or with nothing scrolled
      if (dy < 0 || Math.abs(dx) > Math.abs(dy) || (!drag.onHead && drag.sheet.scrollTop > 0)) { drag = null; return; }
      drag.live = true;
      drag.sheet.style.transition = "none";
    }
    e.preventDefault();               // stop the page bouncing underneath
    drag.dy = Math.max(0, dy);
    drag.sheet.style.transform = "translateY(" + drag.dy + "px)";
  }, { passive: false });

  var end = function () {
    if (!drag) return;
    var d = drag;
    drag = null;
    if (!d.live) return;
    var fast = d.dy > 60 && d.dy / Math.max(1, Date.now() - d.t0) > 0.6;
    d.sheet.style.transition = "";
    d.sheet.style.transform = "";
    if (d.dy > d.sheet.offsetHeight * 0.25 || fast) {
      var close = d.sheet.querySelector(".modal-head .modal-close");
      if (close) close.click();
    }
  };
  document.addEventListener("touchend", end);
  document.addEventListener("touchcancel", end);
}

/* ---------- swipe a row left to show its buttons ---------- */

var openRow = null;

function closeRow(row) {
  if (!row) return;
  var front = row.querySelector(".swipe-front");
  if (front) front.style.transform = "";
  row.classList.remove("is-open");
  if (openRow === row) openRow = null;
}

function openSwipeRow(row) {
  if (openRow && openRow !== row) closeRow(openRow);
  var acts = row.querySelector(".swipe-actions");
  row.querySelector(".swipe-front").style.transform = "translateX(-" + acts.offsetWidth + "px)";
  row.classList.add("is-open");
  openRow = row;
}

/* Rows built as
     <div class="swipe-row"><div class="swipe-actions">buttons</div>
       <div class="swipe-front">the row <button data-swipe-more>⋯</button></div></div>
   Swipe left to show the buttons, right (or a tap anywhere else) to hide
   them. Press and hold, or ⋯, opens them too. */
export function wireSwipeRows(root) {
  root.querySelectorAll(".swipe-row").forEach(function (row) {
    var front = row.querySelector(".swipe-front");
    var acts = row.querySelector(".swipe-actions");
    var t = null, hold = null;

    front.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) return;
      t = { x0: e.touches[0].clientX, y0: e.touches[0].clientY, dx: 0, live: false, was: row.classList.contains("is-open") };
      hold = setTimeout(function () {
        if (t && !t.live) { t.held = true; openSwipeRow(row); if (navigator.vibrate) navigator.vibrate(10); }
      }, 450);
    }, { passive: true });

    front.addEventListener("touchmove", function (e) {
      if (!t) return;
      var dx = e.touches[0].clientX - t.x0, dy = e.touches[0].clientY - t.y0;
      if (!t.live) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        clearTimeout(hold);
        if (Math.abs(dy) > Math.abs(dx)) { t = null; return; }   // a scroll, not a swipe
        t.live = true;
        front.style.transition = "none";
      }
      e.preventDefault();
      var base = t.was ? -acts.offsetWidth : 0;
      t.dx = Math.min(0, Math.max(-acts.offsetWidth - 24, base + dx));
      front.style.transform = "translateX(" + t.dx + "px)";
    }, { passive: false });

    var end = function () {
      clearTimeout(hold);
      if (!t) return;
      var s = t;
      t = null;
      front.style.transition = "";
      if (s.held) { row._gestureAt = Date.now(); return; }
      if (!s.live) return;
      if (s.dx < -acts.offsetWidth / 2) openSwipeRow(row); else closeRow(row);
      row._gestureAt = Date.now();
    };
    front.addEventListener("touchend", end);
    front.addEventListener("touchcancel", end);

    // the tap that ends a swipe or a hold isn't a tap on the row
    front.addEventListener("click", function (e) {
      // the click a phone sends right after a swipe or a hold isn't a tap
      if (row._gestureAt && Date.now() - row._gestureAt < 450) {
        row._gestureAt = 0;
        e.preventDefault(); e.stopPropagation();
        return;
      }
      if (e.target.closest("[data-swipe-more]")) {
        e.stopPropagation();
        if (row.classList.contains("is-open")) closeRow(row); else openSwipeRow(row);
        return;
      }
      if (row.classList.contains("is-open")) { closeRow(row); e.stopPropagation(); }
    }, true);
    front.addEventListener("contextmenu", function (e) { e.preventDefault(); openSwipeRow(row); });
    // a button behind the row closes it again after doing its job
    acts.addEventListener("click", function () { setTimeout(function () { closeRow(row); }, 0); });
  });
}

/* ---------- drag to reorder ---------- */

function scrollParentOf(el) {
  for (var p = el.parentElement; p; p = p.parentElement) {
    var oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement || document.documentElement;
}

/* Hold an item's handle and drag it up or down; the others slide out of
   the way, and the list scrolls when you reach its edge. `moved(from, to)`
   is called once you let go somewhere new. */
export function wireDragReorder(container, itemSelector, handleSelector, moved) {
  container.querySelectorAll(handleSelector).forEach(function (handle) {
    handle.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      var items = [].slice.call(container.querySelectorAll(itemSelector));
      var item = handle.closest(itemSelector);
      var from = items.indexOf(item);
      if (from < 0 || items.length < 2) return;
      e.preventDefault();
      handle.setPointerCapture && handle.setPointerCapture(e.pointerId);

      var scroller = scrollParentOf(container);
      var scroll0 = scroller.scrollTop;
      var y0 = e.clientY;
      var rects = items.map(function (it) { var r = it.getBoundingClientRect(); return { top: r.top, h: r.height }; });
      var gap = items.length > 1 ? Math.max(0, rects[1].top - (rects[0].top + rects[0].h)) : 0;
      var shift = rects[from].h + gap;
      var to = from, lastY = e.clientY, raf = null;

      item.classList.add("is-dragging");
      container.classList.add("is-reordering");
      items.forEach(function (it, j) { if (j !== from) it.style.transition = "transform .15s ease"; });

      var place = function () {
        var dy = lastY - y0 + (scroller.scrollTop - scroll0);
        item.style.transform = "translateY(" + dy + "px)";
        // it takes a neighbour's place once its top edge (going up) or bottom
        // edge (going down) passes that neighbour's middle: half a card, not
        // a whole one, which matters when cards are tall
        var topEdge = rects[from].top + dy, bottomEdge = topEdge + rects[from].h;
        to = from;
        for (var j = 0; j < items.length; j++) {
          if (j === from) continue;
          var mid = rects[j].top + rects[j].h / 2;
          if (j < from && topEdge < mid) { to = Math.min(to, j); }
          if (j > from && bottomEdge > mid) { to = Math.max(to, j); }
        }
        items.forEach(function (it, j) {
          if (j === from) return;
          var off = 0;
          if (from < to && j > from && j <= to) off = -shift;
          if (from > to && j < from && j >= to) off = shift;
          it.style.transform = off ? "translateY(" + off + "px)" : "";
        });
      };
      // keep scrolling while the finger rests near the top or bottom edge
      var edge = function () {
        var box = scroller === document.documentElement ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
        var step = lastY < box.top + 70 ? -10 : lastY > box.bottom - 90 ? 10 : 0;
        if (step) { scroller.scrollTop += step; place(); }
        raf = requestAnimationFrame(edge);
      };
      raf = requestAnimationFrame(edge);

      var move = function (ev) { lastY = ev.clientY; place(); };
      var up = function () {
        cancelAnimationFrame(raf);
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        items.forEach(function (it) { it.style.transform = ""; it.style.transition = ""; });
        item.classList.remove("is-dragging");
        container.classList.remove("is-reordering");
        if (to !== from) moved(from, to);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
  });
}

/* ---------- startup ---------- */

export function startGestures() {
  wireSheetSwipe();
  // a tap anywhere else closes an open swiped row
  document.addEventListener("click", function (e) {
    if (openRow && !openRow.contains(e.target)) closeRow(openRow);
  }, true);
}
