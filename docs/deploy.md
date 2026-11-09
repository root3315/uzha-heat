# Deploy

The app is plain static files. No backend.

```
cd web
npm ci
npm run build
```

Serve `web/dist` as static files. Data is in `web/dist/data/` (copied from `web/public/data/`).

## Как сейчас развёрнуто

https://uzha.mydevbox.xyz отдаёт домашний ТВ-бокс (Android, Termux):

- nginx слушает `127.0.0.1:8081`, корень `~/www/uzha`. На `8080` рядом крутится портфолио, его не трогаем.
- Cloudflare Tunnel (`~/.cloudflared/config.yml`) ведёт `uzha.mydevbox.xyz` на `127.0.0.1:8081`.
  DNS-запись заводится один раз: `cloudflared tunnel route dns <tunnel-id> uzha.mydevbox.xyz`.
- Любой путь без файла отдаёт `index.html` (`try_files $uri $uri/ /index.html`), иначе не откроются ссылки вида `/map/tashkent`.
- В `mime.types` у `application/javascript` должен быть `mjs`. Без этого воркер MapLibre приходит как
  `application/octet-stream` и карта не рисуется.

Выкладка новой версии с ПК (на ПК в `~/.ssh/config` должен быть хост `tvbox`):

```bash
cd web && npm ci && npm run build
tar cf - -C dist . | ssh tvbox 'rm -rf ~/www/uzha.new && mkdir ~/www/uzha.new && tar xf - -C ~/www/uzha.new   && rm -rf ~/www/uzha.old && mv ~/www/uzha ~/www/uzha.old && mv ~/www/uzha.new ~/www/uzha'
```

Старая версия остаётся в `~/www/uzha.old`, откат: поменять папки местами обратно.

## nginx example

`map` goes in the `http` block, the rest in `server`. Cache-Control comes from the map so
every response keeps the security headers (a location with its own `add_header` would drop them).

```nginx
map $uri $cache_control {
    ~^/assets/  "public, max-age=31536000, immutable";  # Vite hashed files
    default     "no-cache";                             # index.html, /data/*.json
}

server {
    listen 80;
    server_name uzha.mydevbox.xyz;
    root /srv/uzha/dist;
    index index.html;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types application/json application/javascript text/css image/svg+xml;

    add_header Cache-Control $cache_control always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; worker-src 'self' blob:; child-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tiles.openfreemap.org https://upload.wikimedia.org; font-src 'self'; connect-src 'self' https://tiles.openfreemap.org; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;
    add_header Cross-Origin-Opener-Policy same-origin always;

    location ^~ /assets/ { try_files $uri =404; }
    location ^~ /data/   { try_files $uri =404; }
    location /           { try_files $uri /index.html; }
}
```

Notes:

- `no-cache` on `/data/*.json` means the browser re-checks with ETag on every load and gets
  a 304 if the file is unchanged, so new data shows up right after a deploy.
- CSP: MapLibre workers run from `blob:`, style/tiles/glyphs come from `tiles.openfreemap.org`,
  photos from `upload.wikimedia.org`. A new external host has to be added here.
- HSTS belongs wherever TLS ends (e.g. the Cloudflare side if the box sits behind a tunnel).
