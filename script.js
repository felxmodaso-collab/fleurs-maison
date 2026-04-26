/* ────────────────────────────────────────────────────────────
   FLEURS — Single-stage seamless scroll experience
   ──────────────────────────────────────────────────────────── */
(() => {
  'use strict';

  const { gsap } = window;
  const { ScrollTrigger } = window;
  const { Lenis } = window;
  if (!gsap || !ScrollTrigger || !Lenis) {
    console.error('GSAP / ScrollTrigger / Lenis not loaded');
    return;
  }
  gsap.registerPlugin(ScrollTrigger);

  const REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ────────────────────────────────────────────────────────────
  // Scroll-zone map (0..1 progress mapped to scene state)
  // Layout (8 screens of total scroll):
  //   0.00 - 0.10  →  hero (entrance cinemagraph, locked, awaits door click)
  //   0.10 - 0.24  →  t1   (entrance → s1 transition, scrubbed)
  //   0.24 - 0.34  →  s1   (cinemagraph + content)
  //   0.34 - 0.46  →  t2   (s1 → s2 transition)
  //   0.46 - 0.56  →  s2   (cinemagraph + content)
  //   0.56 - 0.68  →  t3   (s2 → long_hall transition)
  //   0.68 - 0.78  →  s3   (cinemagraph + content)
  //   0.78 - 0.90  →  t4   (long_hall → garden transition)
  //   0.90 - 1.00  →  s4   (cinemagraph + content)
  // ────────────────────────────────────────────────────────────
  const ZONES = [
    { name: 'hero', from: 0.00, to: 0.10, type: 'cine',  target: 'entrance', content: 'hero' },
    { name: 't1',   from: 0.10, to: 0.24, type: 'trans', target: 't1'                     },
    { name: 's1',   from: 0.24, to: 0.34, type: 'cine',  target: 's1',       content: 's1' },
    { name: 't2',   from: 0.34, to: 0.46, type: 'trans', target: 't2'                     },
    { name: 's2',   from: 0.46, to: 0.56, type: 'cine',  target: 's2',       content: 's2' },
    { name: 't3',   from: 0.56, to: 0.68, type: 'trans', target: 't3'                     },
    { name: 's3',   from: 0.68, to: 0.78, type: 'cine',  target: 'long_hall', content: 's3' },
    { name: 't4',   from: 0.78, to: 0.90, type: 'trans', target: 't4'                     },
    { name: 's4',   from: 0.90, to: 1.00, type: 'cine',  target: 'garden',   content: 's4' },
  ];

  // Helpers to look up zones by name and target progress for jumping
  const zoneByName = Object.fromEntries(ZONES.map(z => [z.name, z]));
  // Where to scroll when nav menu jumps to a section: end of the cine zone
  // means the user has fully arrived at that section.
  const NAV_TARGETS = {
    hero: 0.0,
    s1:   zoneByName.s1.to - 0.005,  // just before t2 starts
    s2:   zoneByName.s2.to - 0.005,
    s3:   zoneByName.s3.to - 0.005,
    s4:   zoneByName.s4.to - 0.005,
  };

  // ────────────────────────────────────────────────────────────
  // FrameSequence: canvas drawImage of preloaded JPG sequence
  // ────────────────────────────────────────────────────────────
  class FrameSequence {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
      this.dir = canvas.dataset.dir;
      this.count = parseInt(canvas.dataset.count, 10);
      this.frames = new Array(this.count);
      this.loadedCount = 0;
      // smoothed (displayed) and target frame indices (floats, lerp'd in rAF)
      this.targetFrame = 0;
      this.displayedFrame = 0;
      this.lastDrawnFrame = -1;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this._sized = false;
      this._raf = null;
      this._render = this._render.bind(this);
      this._resize();
    }

    _resize() {
      const c = this.canvas;
      const cw = c.clientWidth || window.innerWidth;
      const ch = c.clientHeight || window.innerHeight;
      const w = Math.floor(cw * this.dpr);
      const h = Math.floor(ch * this.dpr);
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
        this._sized = true;
        if (this.lastDrawnFrame >= 0) {
          this.lastDrawnFrame = -1;
          this._scheduleRender();
        }
      }
    }

    preload(onProgress) {
      return new Promise((resolve) => {
        if (this.count === 0) { resolve(); return; }
        let firstResolved = false;
        for (let i = 0; i < this.count; i++) {
          const num = String(i + 1).padStart(3, '0');
          const img = new Image();
          img.decoding = 'async';
          img.src = `./public/frames/${this.dir}/${num}.jpg`;
          this.frames[i] = img;
          img.onload = img.onerror = () => {
            this.loadedCount++;
            if (onProgress) onProgress(this.loadedCount / this.count);
            if (!firstResolved && i === 0) {
              firstResolved = true;
              this._resize();
              this._scheduleRender();
            }
            if (this.loadedCount === this.count) resolve();
          };
        }
        setTimeout(resolve, 30000);
      });
    }

    /** set the TARGET frame (float-precision); displayed frame lerps toward it each rAF */
    setTarget(idxFloat) {
      this.targetFrame = Math.max(0, Math.min(this.count - 1, idxFloat));
    }

    /** instant jump (used for warp/snap) */
    setFrame(idx) {
      const clamped = Math.max(0, Math.min(this.count - 1, idx));
      this.targetFrame = clamped;
      this.displayedFrame = clamped;
      const round = Math.round(clamped);
      if (round !== this.lastDrawnFrame) this._renderAt(round);
    }

    /** advance displayed frame toward target (called every frame from a global rAF) */
    tick(lerp) {
      const dist = this.targetFrame - this.displayedFrame;
      if (Math.abs(dist) < 0.001) return;
      this.displayedFrame += dist * lerp;
      const round = Math.round(this.displayedFrame);
      if (round !== this.lastDrawnFrame) this._renderAt(round);
    }

    _scheduleRender() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(this._render);
    }

    _render() {
      this._raf = null;
      const idx = Math.round(this.displayedFrame);
      this._renderAt(idx);
    }

    _renderAt(idx) {
      let img = this.frames[idx];
      if (!img || !img.complete || img.naturalWidth === 0) {
        const fallback = this._findNearestLoaded(idx);
        if (fallback === -1) return;
        img = this.frames[fallback];
      }
      this._drawCover(img);
      this.lastDrawnFrame = idx;
    }

    showFrame(idx) { this.setFrame(idx); }

    _findNearestLoaded(idx) {
      for (let r = 0; r < this.count; r++) {
        const a = this.frames[idx - r];
        if (a && a.complete && a.naturalWidth > 0) return idx - r;
        const b = this.frames[idx + r];
        if (b && b.complete && b.naturalWidth > 0) return idx + r;
      }
      return -1;
    }

    _drawCover(img) {
      const c = this.canvas;
      if (!this._sized) this._resize();
      const cw = c.width, ch = c.height;
      const iw = img.naturalWidth, ih = img.naturalHeight;
      if (!cw || !ch || !iw || !ih) return;
      const ratio = Math.max(cw / iw, ch / ih);
      const dw = iw * ratio, dh = ih * ratio;
      const dx = (cw - dw) / 2, dy = (ch - dh) / 2;
      this.ctx.drawImage(img, dx, dy, dw, dh);
    }

  }

  // ────────────────────────────────────────────────────────────
  // Init
  // ────────────────────────────────────────────────────────────
  const loader      = $('.loader');
  const loaderBar   = $('.loader__bar span');
  const loaderHint  = $('.loader__hint');
  const body        = document.body;
  const stage       = $('.stage');
  const doorCta     = $('.door-cta');
  const navToggle   = $('.nav-toggle');
  const navOverlay  = $('#nav-overlay');
  const railDots    = $$('.progress-rail__dot');
  const scrollHint  = $('.scroll-hint');
  const siteFooter  = $('.site-footer');

  const cines = Object.fromEntries(
    $$('video[data-cine]').map(v => [v.dataset.cine, v])
  );
  const sequences = Object.fromEntries(
    $$('canvas[data-trans]').map(c => [c.dataset.trans, new FrameSequence(c)])
  );
  const contents = Object.fromEntries(
    $$('.content[data-content]').map(el => [el.dataset.content, el])
  );

  // Pause non-active cinemagraphs from start
  Object.entries(cines).forEach(([name, video]) => {
    if (name !== 'entrance') video.pause();
  });

  // ── Generalized intro→idle stunt-double for any cinemagraph ──
  // For each <video data-cine="X" data-idle-src="...">: dynamically create a sibling
  // stunt video with the idle src. On intro 'ended' → atomic opacity swap, idle takes over.
  // Pattern proven seamless on entrance — same render pipeline, no canvas, no tear.
  function setupIntroIdleSwap(intro) {
    const idleSrc = intro.dataset.idleSrc;
    if (!idleSrc) return;
    const name = intro.dataset.cine;

    // Create stunt sibling
    const stunt = document.createElement('video');
    stunt.className = intro.className.replace(/\bis-visible\b/g, '').trim() + ' idle-stunt';
    stunt.muted = true;
    stunt.loop = true;
    stunt.playsInline = true;
    stunt.preload = 'auto';
    stunt.innerHTML = `<source src="${idleSrc}" type="video/mp4">`;
    intro.insertAdjacentElement('afterend', stunt);

    let swapped = false;
    intro.addEventListener('ended', () => {
      if (swapped) return;
      swapped = true;

      stunt.currentTime = 0;
      stunt.play().catch(() => {});

      const swap = () => {
        // Atomic visibility swap in single compositor commit.
        // Use is-visible only (no separate is-active) so setActiveCine controls
        // visibility uniformly for stunts and regular cines.
        stunt.classList.add('is-visible');
        intro.classList.remove('is-visible');
        intro.pause();
        // Reroute the layer system: stunt is now the entrance/s2/etc representative
        cines[name] = stunt;
        stunt.setAttribute('data-cine', name);
        intro.removeAttribute('data-cine');
      };

      if ('requestVideoFrameCallback' in stunt) {
        stunt.requestVideoFrameCallback(() => swap());
      } else {
        stunt.addEventListener('playing', () => requestAnimationFrame(swap), { once: true });
      }
    });
  }

  // Apply to all cinemagraphs that have an idle src defined
  $$('video[data-cine][data-idle-src]').forEach(setupIntroIdleSwap);

  // ────────────────────────────────────────────────────────────
  // Lenis smooth scroll
  // ────────────────────────────────────────────────────────────
  const lenis = new Lenis({
    duration: 1.6,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
    smoothTouch: false,         // native momentum on iOS/Android (Lenis-touch is janky on iOS)
    syncTouch: true,            // sync touch events with Lenis tick
    syncTouchLerp: 0.075,
    lerp: 0.08,
    wheelMultiplier: 0.85,
    touchMultiplier: 1.6,
  });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);

  // Force scroll to top on init (avoid browser-restored scrollY)
  window.scrollTo(0, 0);

  // Lock scroll until door click
  lenis.stop();
  document.documentElement.classList.add('is-scroll-locked');
  // Also block native wheel/touch (Lenis.stop is enough but extra safety)
  function preventScroll(e) {
    if (entered) return;
    e.preventDefault();
  }
  window.addEventListener('wheel', preventScroll, { passive: false });
  window.addEventListener('touchmove', preventScroll, { passive: false });

  // ────────────────────────────────────────────────────────────
  // Loader
  // ────────────────────────────────────────────────────────────
  const updateLoaderProgress = (p) => {
    if (loaderBar) loaderBar.style.width = `${Math.min(100, Math.round(p * 100))}%`;
  };

  // Preload t1 immediately (it's the first transition the user will see)
  let t1Ready = false;
  const t1 = sequences.t1;
  if (t1) {
    t1.preload(updateLoaderProgress).then(() => {
      t1Ready = true;
      updateLoaderProgress(1);
    });
  }

  function hideLoader() {
    setTimeout(() => loader?.classList.add('is-hidden'), 250);
  }
  // Hide loader as soon as hero video can play (independent of t1)
  const heroVideo = cines.entrance;
  if (heroVideo) {
    if (heroVideo.readyState >= 3) hideLoader();
    else {
      heroVideo.addEventListener('canplay', hideLoader, { once: true });
      setTimeout(hideLoader, 5000);
    }
  } else hideLoader();

  // Lazy preload of transitions: only load t2/t3/t4 when user approaches their zones.
  // Saves bandwidth on weak networks — first paint only needs t1 + entrance video.
  const _preloadStarted = new Set();
  function preloadTransition(name) {
    if (_preloadStarted.has(name)) return;
    _preloadStarted.add(name);
    sequences[name]?.preload();
  }
  // Triggered by zone changes (see applyZone below): preload the NEXT transition
  // when user is in the current cine zone (e.g. in s1 → preload t2)
  function preloadNextFromZone(zoneName) {
    const next = { hero: 't1', t1: 't2', s1: 't2', t2: 't3', s2: 't3', t3: 't4', s3: 't4' };
    const target = next[zoneName];
    if (target) preloadTransition(target);
  }

  // ────────────────────────────────────────────────────────────
  // Door CTA / hero idle UI
  // ────────────────────────────────────────────────────────────
  // Reveal door CTA + scroll hint after small delay (only if still at hero)
  setTimeout(() => {
    if (currentZoneName === 'hero' && !entered) {
      doorCta?.classList.add('is-visible');
      scrollHint?.classList.add('is-visible');
    }
  }, 700);

  let entered = false;

  function enterShop(targetZone) {
    if (entered) {
      // already entered → just scrollTo target
      if (targetZone) jumpToZone(targetZone);
      return;
    }
    entered = true;

    // Unlock scroll
    lenis.start();
    body.classList.remove('is-locked');

    // Hide door CTA + scroll hint
    doorCta?.classList.remove('is-visible');
    scrollHint?.classList.remove('is-visible');

    // Wait until t1 is ready before scrolling through it
    const beginScroll = () => {
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;

      // Default target: end of t1 zone (= start of s1)
      const defaultTargetProgress = NAV_TARGETS.s1;
      const targetProgress = targetZone != null ? NAV_TARGETS[targetZone] ?? defaultTargetProgress : defaultTargetProgress;
      const targetY = docHeight * targetProgress;

      // Animate scroll smoothly across the t1 zone in ~6s (mimics "walking through doorway")
      lenis.scrollTo(targetY, {
        duration: 6,
        easing: (t) => 1 - Math.pow(1 - t, 2.6),  // ease-out quad-ish
      });
    };

    if (t1Ready) {
      beginScroll();
    } else {
      // Show loader hint while t1 finishes loading
      if (loaderHint) loaderHint.textContent = 'Encore un instant…';
      loader?.classList.remove('is-hidden');
      const wait = setInterval(() => {
        if (t1Ready) {
          clearInterval(wait);
          loader?.classList.add('is-hidden');
          setTimeout(beginScroll, 400);
        }
      }, 100);
    }
  }

  doorCta?.addEventListener('click', () => enterShop());

  // Click anywhere on stage (excluding controls) when at hero → enter
  let heroClickEnabled = false;
  setTimeout(() => { heroClickEnabled = true; }, 1500);
  stage?.addEventListener('click', (e) => {
    if (!heroClickEnabled || entered) return;
    if (e.target.closest('.nav-toggle, .nav-overlay, .progress-rail, .door-cta')) return;
    enterShop();
  });

  // ────────────────────────────────────────────────────────────
  // Master scroll → zone state machine
  // ────────────────────────────────────────────────────────────
  let currentZoneName = 'hero';

  function findZone(p) {
    for (let i = 0; i < ZONES.length; i++) {
      if (p < ZONES[i].to) return ZONES[i];
    }
    return ZONES[ZONES.length - 1];
  }

  function setActiveCine(name) {
    Object.entries(cines).forEach(([k, v]) => {
      if (k === name) {
        v.classList.add('is-visible');
        if (v.paused) v.play().catch(() => {});
      } else {
        v.classList.remove('is-visible');
      }
    });
    setTimeout(() => {
      Object.entries(cines).forEach(([k, v]) => {
        if (k !== name && !v.paused) v.pause();
      });
    }, 700);
  }

  function setActiveCanvas(name) {
    Object.entries(sequences).forEach(([k, seq]) => {
      seq.canvas.classList.toggle('is-visible', k === name);
    });
  }

  function setActiveContent(name) {
    Object.entries(contents).forEach(([k, el]) => {
      el.classList.toggle('is-visible', k === name);
    });
  }

  function applyZone(zone, localProgress) {
    if (zone.name !== currentZoneName) {
      currentZoneName = zone.name;
      preloadNextFromZone(zone.name);
      // Show appropriate cine vs canvas
      if (zone.type === 'cine') {
        setActiveCine(zone.target);
        setActiveCanvas(null);
        setActiveContent(zone.content);
        // Door CTA only for hero zone (and only if not entered yet)
        doorCta?.classList.toggle('is-visible', zone.name === 'hero' && !entered);
        scrollHint?.classList.toggle('is-visible', zone.name === 'hero' && !entered);
        siteFooter?.classList.toggle('is-visible', zone.name === 's4');
      } else {
        // Transition zone — show its canvas, hide all cines + contents
        setActiveCanvas(zone.target);
        setActiveCine(null);
        setActiveContent(null);
        doorCta?.classList.remove('is-visible');
        scrollHint?.classList.remove('is-visible');
        siteFooter?.classList.remove('is-visible');
      }
      // Update progress rail
      updateProgressRail(zone);
    }

    // For transitions: scrub TARGET frame (lerp'd in rAF tick)
    if (zone.type === 'trans') {
      const seq = sequences[zone.target];
      if (seq) {
        seq.setTarget(localProgress * (seq.count - 1));
      }
    }
  }

  // Global lerp tick — smooths every sequence's displayed frame toward target
  const LERP_FACTOR = 0.18; // higher = more responsive, lower = silkier
  function tickAllSequences() {
    Object.values(sequences).forEach(seq => seq.tick(LERP_FACTOR));
  }
  gsap.ticker.add(tickAllSequences);

  function updateProgressRail(zone) {
    const map = { hero: 'hero', t1: 's1', s1: 's1', t2: 's2', s2: 's2', t3: 's3', s3: 's3', t4: 's4', s4: 's4' };
    const targetName = map[zone.name] || 'hero';
    railDots.forEach(d => {
      d.toggleAttribute('data-active', d.dataset.target === targetName);
    });
  }

  // Master ScrollTrigger
  function initScrollMaster() {
    ScrollTrigger.create({
      trigger: '.track',
      start: 'top top',
      end: 'bottom bottom',
      scrub: 0,
      onUpdate: (self) => {
        const p = self.progress;
        const zone = findZone(p);
        const localProgress = (p - zone.from) / (zone.to - zone.from);
        applyZone(zone, localProgress);
      },
    });
  }

  initScrollMaster();
  // Apply initial zone on load
  applyZone(ZONES[0], 0);

  // ────────────────────────────────────────────────────────────
  // Nav menu
  // ────────────────────────────────────────────────────────────
  function toggleNav(open) {
    const next = typeof open === 'boolean' ? open : !navToggle.classList.contains('is-open');
    navToggle.classList.toggle('is-open', next);
    navToggle.setAttribute('aria-expanded', String(next));
    if (next) navOverlay.removeAttribute('hidden');
    else setTimeout(() => navOverlay.setAttribute('hidden', ''), 400);
  }
  navToggle?.addEventListener('click', () => toggleNav());

  function jumpToZone(zoneName) {
    const targetProgress = NAV_TARGETS[zoneName];
    if (targetProgress == null) return;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const targetY = docHeight * targetProgress;
    lenis.scrollTo(targetY, { duration: 1.6 });
  }

  $$('[data-nav]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const z = a.dataset.nav;
      if (!entered && z !== 'hero') {
        // user wants to jump somewhere from hero — enter first then jump
        enterShop(z);
      } else if (z === 'hero') {
        if (entered) jumpToZone('hero');
      } else {
        jumpToZone(z);
      }
      toggleNav(false);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && navToggle.classList.contains('is-open')) toggleNav(false);
  });

  railDots.forEach(dot => {
    dot.addEventListener('click', () => {
      const z = dot.dataset.target;
      if (!entered && z !== 'hero') enterShop(z);
      else if (z === 'hero') jumpToZone('hero');
      else jumpToZone(z);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Resize
  // ────────────────────────────────────────────────────────────
  let resizeRaf;
  window.addEventListener('resize', () => {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      Object.values(sequences).forEach(s => s._resize());
      ScrollTrigger.refresh();
    });
  });

  // ────────────────────────────────────────────────────────────
  // Reduced motion fallback
  // ────────────────────────────────────────────────────────────
  if (REDUCE_MOTION) {
    body.classList.remove('is-locked');
    lenis.start();
    entered = true;
  }

  // ────────────────────────────────────────────────────────────
  // Shop: products, cart, overlay
  // ────────────────────────────────────────────────────────────
  const PRODUCTS = [
    { id: '01', img: 'bouquet_01.jpg', name: 'Rose & pivoine, romantique', desc: 'Roses jardin de la Drôme, pivoines coréennes, ruban de lin crème.', price: 85 },
    { id: '02', img: 'bouquet_02.jpg', name: 'Bouquet de mariée cascade', desc: 'David Austin blanches, gardénia, jasmin, lierre tombant.', price: 240 },
    { id: '03', img: 'bouquet_03.jpg', name: 'Prairie sauvage', desc: 'Bleuets, coquelicots, marguerites, scabieuse, blé doré.', price: 65 },
    { id: '04', img: 'bouquet_04.jpg', name: 'Composition sculpturale', desc: 'Protea royal, pampas, palmes séchées, pichet de pierre.', price: 150 },
    { id: '05', img: 'bouquet_05.jpg', name: 'Noir dramatique', desc: 'Dahlia bordeaux, calla noir, renoncule rubis, rose oxblood.', price: 120 },
    { id: '06', img: 'bouquet_06.jpg', name: 'Pastel pastoral', desc: 'Lavande, digitale, muflier, pois de senteur, sauge.', price: 75 },
    { id: '07', img: 'bouquet_07.jpg', name: 'Hortensias minimalistes', desc: 'Têtes blanches denses dans un vase mat crème.', price: 95 },
    { id: '08', img: 'bouquet_08.jpg', name: 'Tulipes perroquet', desc: 'Flammées orange, jaune, magenta, blanc strié — tiges courbes.', price: 70 },
    { id: '09', img: 'bouquet_09.jpg', name: "Récolte d'automne", desc: 'Renoncule cuivrée, dahlia terracotta, eucalyptus, blé.', price: 85 },
    { id: '10', img: 'bouquet_10.jpg', name: 'Vintage thé fané', desc: 'Roses anciennes Souvenir de la Malmaison, papier teinté.', price: 110 },
    { id: '11', img: 'bouquet_11.jpg', name: 'Tropical statement', desc: 'Oiseau-de-paradis, anthurium, monstera, gingembre.', price: 130 },
    { id: '12', img: 'bouquet_12.jpg', name: 'Bouquet sec, préservé', desc: 'Lavande, statice, eucalyptus, hortensia séché — durable.', price: 60 },
    { id: '13', img: 'bouquet_13.jpg', name: 'Orchidée spécimen', desc: 'Cattleya seule, vase verre soufflé, geste minimal.', price: 180 },
    { id: '14', img: 'bouquet_14.jpg', name: 'Coucher de soleil', desc: 'Dahlia terracotta, rose pêche, renoncule orange, fil cuivre.', price: 95 },
    { id: '15', img: 'bouquet_15.jpg', name: 'Mariée jardin', desc: 'Roses Juliet, Patience, Keira, ranunculus, lisianthus.', price: 220 },
    { id: '16', img: 'bouquet_16.jpg', name: 'Iris bearded', desc: 'Trois tiges hautes, feuillage long — vase grès crème.', price: 75 },
    { id: '17', img: 'bouquet_17.jpg', name: 'Baies & capsules', desc: 'Eucalyptus, hypericum noir, viburnum rouge, smoke bush.', price: 70 },
    { id: '18', img: 'bouquet_18.jpg', name: 'Ikebana asymétrique', desc: 'Cerisiers en fleur, camélia blanc, fritillaire — kenzan.', price: 165 },
    { id: '19', img: 'bouquet_19.jpg', name: 'Centre de table', desc: 'Dôme compact pivoines crème et rose, anémone — argent.', price: 105 },
    { id: '20', img: 'bouquet_20.jpg', name: 'Posy hebdomadaire', desc: 'Mélange saisonnier, livré chaque semaine — boîte crème.', price: 45 },
  ];

  const CART_KEY = 'fleurs.cart.v1';
  const cartState = JSON.parse(localStorage.getItem(CART_KEY) || '{}');

  function saveCart() {
    localStorage.setItem(CART_KEY, JSON.stringify(cartState));
  }

  function cartCount() {
    return Object.values(cartState).reduce((s, q) => s + q, 0);
  }

  function cartTotal() {
    return Object.entries(cartState).reduce((s, [id, q]) => {
      const p = PRODUCTS.find(p => p.id === id);
      return s + (p ? p.price * q : 0);
    }, 0);
  }

  function addToCart(id) {
    cartState[id] = (cartState[id] || 0) + 1;
    saveCart();
    renderCart();
    updateCartCounts();
  }
  function changeQty(id, delta) {
    cartState[id] = (cartState[id] || 0) + delta;
    if (cartState[id] <= 0) delete cartState[id];
    saveCart();
    renderCart();
    updateCartCounts();
  }
  function removeFromCart(id) {
    delete cartState[id];
    saveCart();
    renderCart();
    updateCartCounts();
  }

  function updateCartCounts() {
    const n = cartCount();
    $$('.cart-count').forEach(el => {
      el.textContent = n;
      el.setAttribute('data-count', n);
    });
    const checkoutBtn = $('#checkout-btn');
    if (checkoutBtn) checkoutBtn.disabled = n === 0;
  }

  function renderShop() {
    const grid = $('#shop-grid');
    if (!grid || grid.children.length) return; // already rendered
    const fmt = (n) => `${n} €`;
    grid.innerHTML = PRODUCTS.map(p => `
      <article class="product-card" data-pid="${p.id}">
        <img class="product-card__img" src="./public/bouquets/${p.img}" alt="${p.name}" loading="lazy" />
        <div class="product-card__body">
          <h3 class="product-card__name">${p.name}</h3>
          <p class="product-card__desc">${p.desc}</p>
          <div class="product-card__bot">
            <span class="product-card__price">${fmt(p.price)}</span>
            <button class="product-card__add" type="button" data-add="${p.id}">Ajouter</button>
          </div>
        </div>
      </article>
    `).join('');

    grid.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-add]');
      if (!btn) return;
      addToCart(btn.dataset.add);
      btn.classList.add('is-added');
      btn.textContent = 'Ajouté ✓';
      setTimeout(() => {
        btn.classList.remove('is-added');
        btn.textContent = 'Ajouter';
      }, 1300);
    });
  }

  function renderCart() {
    const list = $('#cart-items');
    const total = $('#cart-total');
    if (!list || !total) return;
    const ids = Object.keys(cartState);
    if (ids.length === 0) {
      list.innerHTML = '<p class="cart-empty">Votre panier est vide.<br/>Ajoutez quelques fleurs.</p>';
      total.textContent = '0 €';
      return;
    }
    list.innerHTML = ids.map(id => {
      const p = PRODUCTS.find(p => p.id === id);
      if (!p) return '';
      const q = cartState[id];
      return `
        <div class="cart-item" data-pid="${id}">
          <img class="cart-item__img" src="./public/bouquets/${p.img}" alt="${p.name}" />
          <div class="cart-item__info">
            <h4 class="cart-item__name">${p.name}</h4>
            <span class="cart-item__price">${p.price} € · ${q} × = ${p.price * q} €</span>
            <div class="cart-item__qty">
              <button type="button" data-qty-minus="${id}" aria-label="Réduire">−</button>
              <span>${q}</span>
              <button type="button" data-qty-plus="${id}" aria-label="Augmenter">+</button>
            </div>
          </div>
          <button class="cart-item__remove" type="button" data-remove="${id}" aria-label="Retirer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 5l14 14M19 5L5 19"/></svg>
          </button>
        </div>
      `;
    }).join('');
    total.textContent = `${cartTotal()} €`;
  }

  // Cart event delegation
  $('#cart-items')?.addEventListener('click', (e) => {
    const minus = e.target.closest('[data-qty-minus]');
    const plus = e.target.closest('[data-qty-plus]');
    const remove = e.target.closest('[data-remove]');
    if (minus) changeQty(minus.dataset.qtyMinus, -1);
    else if (plus) changeQty(plus.dataset.qtyPlus, +1);
    else if (remove) removeFromCart(remove.dataset.remove);
  });

  // Open / close shop overlay
  const shopOverlay = $('#shop-overlay');
  const cartPanel = $('#cart-panel');
  const cartBackdrop = $('#cart-backdrop');

  function openShop() {
    renderShop();
    shopOverlay?.removeAttribute('hidden');
    // Note: data-lenis-prevent on shop overlay = Lenis ignores wheel inside it,
    // native scroll works. We don't need lenis.stop().
  }
  function closeShop() {
    shopOverlay?.setAttribute('hidden', '');
  }

  function openCart() {
    renderCart();
    cartPanel?.removeAttribute('hidden');
    cartBackdrop?.removeAttribute('hidden');
  }
  function closeCart() {
    cartPanel?.setAttribute('hidden', '');
    cartBackdrop?.setAttribute('hidden', '');
  }

  $('#open-shop')?.addEventListener('click', openShop);
  $('#close-shop')?.addEventListener('click', closeShop);
  $('#open-cart')?.addEventListener('click', openCart);
  $('#open-cart-from-shop')?.addEventListener('click', openCart);
  $('#close-cart')?.addEventListener('click', closeCart);
  cartBackdrop?.addEventListener('click', closeCart);
  $('#checkout-btn')?.addEventListener('click', () => {
    alert(`Demande de commande envoyée\nTotal: ${cartTotal()} €\n${cartCount()} article(s)\n\nNous vous contacterons sous 1 h.`);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!cartPanel?.hasAttribute('hidden')) closeCart();
    else if (!shopOverlay?.hasAttribute('hidden')) closeShop();
  });

  // Initial cart counts on load
  updateCartCounts();

  // Expose for debugging
  window.__fleurs = { lenis, ZONES, sequences, cines, contents, enterShop, jumpToZone, openShop, openCart, cartState };
})();
