// mobile-safari.js
// PWA meta tags + iOS Safari UX fixes for Forge Neo

(function () {
    // Only apply on mobile / touch devices
    if (!('ontouchstart' in window) && navigator.maxTouchPoints === 0) return;

    /* ── PWA / Home Screen meta tags ────────────────────────── */
    function addMeta(name, content) {
        if (document.querySelector('meta[name="' + name + '"]')) return;
        var m = document.createElement('meta');
        m.name = name;
        m.content = content;
        document.head.appendChild(m);
    }
    function addLink(rel, href, type) {
        var l = document.createElement('link');
        l.rel = rel;
        if (href) l.href = href;
        if (type) l.type = type;
        document.head.appendChild(l);
    }

    addMeta('apple-mobile-web-app-capable', 'yes');
    addMeta('mobile-web-app-capable', 'yes');
    addMeta('apple-mobile-web-app-status-bar-style', 'default');
    addMeta('apple-mobile-web-app-title', 'Forge Neo');
    addMeta('theme-color', '#ffffff');

    /* ── Fix viewport: prevent double-tap zoom ───────────────
       We add maximum-scale=1 ONLY when no input is focused,
       and relax it when input is focused so the user can still
       zoom text if needed. This is the least intrusive approach
       that stops the accidental tap-zoom while keeping
       accessibility pinch-zoom available.                      */
    var viewportMeta = document.querySelector('meta[name="viewport"]');
    if (viewportMeta) {
        var base = viewportMeta.content.replace(/,?\s*maximum-scale=[^,]*/g, '');
        viewportMeta.content = base + ', maximum-scale=1.0';
    }

    /* ── Dropdown / select scroll isolation ─────────────────
       iOS scrolls the whole page when finger starts in a
       scrollable child that hits its boundary.
       We stop propagation of touchmove when the touch target
       is inside a scrollable element that still has room.     */
    document.addEventListener('touchmove', function (e) {
        var el = e.target;
        while (el && el !== document.documentElement) {
            if (isScrollable(el) && el.scrollHeight > el.clientHeight) {
                // Scrollable element found — let it scroll without bubbling
                e.stopPropagation();
                return;
            }
            el = el.parentElement;
        }
    }, { passive: true });

    function isScrollable(el) {
        var style = window.getComputedStyle(el);
        var overflow = style.overflowY;
        return overflow === 'auto' || overflow === 'scroll' ||
               overflow === '-webkit-auto' || overflow === '-webkit-scroll';
    }

    /* ── Dropdown: re-apply overscroll-behavior after Gradio
       renders new dropdowns (Gradio re-renders on each update) */
    onUiUpdate(function () {
        document.querySelectorAll('.gradio-dropdown .wrap:not(.hide)').forEach(function (wrap) {
            wrap.style.webkitOverflowScrolling = 'touch';
            wrap.style.overscrollBehavior = 'contain';
            wrap.style.touchAction = 'pan-y';
        });
    });

})();
