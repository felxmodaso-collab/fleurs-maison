# Fleurs — Maison Florale (canvas-scroll experience)

Интерактивный сайт цветочного магазина в формате scroll-driven walkthrough.

## Архитектура

5 локаций (статичные cinemagraph-видео, autoplay loop) + 4 транзишена между ними (JPG-секвенции в canvas, перематываются скроллом — без HTML5 video seek-jitter).

| # | Сцена | ID | Cinemagraph | Транзишн → следующей |
|---|-------|-----|-------------|----------------------|
| 0 | Entrée (фасад FLEURS) | `#hero` | `cine_entrance.mp4` | t1 (по клику двери, 24fps плейбэк) |
| 1 | À propos (тёмная анфилада) | `#s1` | `cine_s1.mp4` | t2 (scroll-scrubbed) |
| 2 | Mariages (романтичная пастораль) | `#s2` | `cine_s2.mp4` | t3 (scroll-scrubbed, лианы расплетаются) |
| 3 | Boutique (длинный анфиладный зал) | `#s3` | `cine_long_hall.mp4` | t4 (scroll-scrubbed, выход в сад) |
| 4 | L'atelier (полисадник) | `#s4` | `cine_garden.mp4` | — |

## Стек

- **Vanilla HTML/CSS/JS** — без билд-шага
- **GSAP + ScrollTrigger** (CDN) — пиннинг и scrub
- **Lenis** (CDN) — smooth scroll
- **Canvas drawImage + JPG-секвенции** — для всех scroll-scrubbed транзишенов (96 кадров каждая, 1600×900, q=4 jpeg)
- **HTML5 `<video loop autoplay muted playsinline>`** — для cinemagraph-ов (8s, играют по mount, IntersectionObserver pause при выходе из viewport)
- **Шрифты:** Pinyon Script (логотип), Cormorant Garamond (заголовки/тело), Caveat (handwritten акценты), Inter (UI)

## Запуск (локально)

Любой статический сервер:

```bash
# через python (если установлен)
cd runtime/projects/florist-canvas
python -m http.server 8000

# или через npx serve
npx serve .

# или live-server
npx live-server .
```

Открыть `http://localhost:8000`.

## Файловая структура

```
florist-canvas/
├── index.html
├── styles.css
├── script.js
├── README.md
└── public/
    ├── videos/                     ← cinemagraph-ы (8s loop) + исходники транзишенов
    │   ├── cine_entrance.mp4       (21 MB)
    │   ├── cine_s1.mp4             (13 MB)
    │   ├── cine_s2.mp4             (15 MB)
    │   ├── cine_long_hall.mp4      (15 MB)
    │   ├── cine_garden.mp4         (16 MB)
    │   ├── transition_*.mp4        (исходники для повторного rebuild frames/)
    │   └── …
    └── frames/                     ← JPG-секвенции для canvas-scrub
        ├── t1/001.jpg ... 096.jpg  (entrance → s1, ~33 MB)
        ├── t2/                     (s1 → s2, ~33 MB)
        ├── t3/                     (s2 → long_hall, ~34 MB)
        └── t4/                     (long_hall → garden, ~34 MB)
```

## Что работает

- ✅ Hero с заблокированным скроллом до клика
- ✅ Door click → плейбэк frame-sequence на 24fps → unlock scroll → fade в s1
- ✅ Scroll-scrub для t2/t3/t4 (canvas drawImage, no video seek)
- ✅ Cinemagraph autoplay/pause через IntersectionObserver (perf на слабых устройствах)
- ✅ Sticky burger-меню с overlay (5 пунктов)
- ✅ Vertical progress rail справа (5 точек, активная при центре сцены)
- ✅ Lenis smooth scroll
- ✅ Адаптив (mobile breakpoint)
- ✅ `prefers-reduced-motion` fallback (без click-played транзишена)

## Что осталось сделать (next)

- [ ] FLEURS-логотип как SVG (NanoBanana hand-painted lettering)
- [ ] Реальный контент: тексты, ассортимент, цены
- [ ] Каталог букетов (s3) с детальными карточками
- [ ] Корзина / форма заказа
- [ ] Скомпрессить cinemagraph-ы дополнительно (можно ужать до 8-10 MB каждый)
- [ ] Service worker + cache для frame-секвенций
- [ ] OpenGraph / Twitter card мета
- [ ] Аналитика / метрика

## Перегенерация frame-секвенций

Если меняем исходник транзишена — пересобираем секвенцию:

```bash
ffmpeg -y -i public/videos/transition_X.mp4 \
  -vf "select='not(mod(n,2))',scale=1600:900" \
  -vsync 0 -q:v 4 \
  public/frames/tN/%03d.jpg
```

Мы берём каждый 2-й кадр из 192 source @ 24fps → 96 кадров, что соответствует ~12 fps эффективного scrub-rate (визуально неотличимо от 24 при scroll-перемотке).
