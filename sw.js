/* ============================================================
   why2korea_memo 서비스워커 (sw.js)
   ------------------------------------------------------------
   역할 ① 앱 파일을 브라우저에 저장(캐시)해두어
          비행기 모드/지하철처럼 인터넷이 없을 때도 앱이 열리게 합니다.
   역할 ② ⏰ 알람을 '앱이 꺼져 있어도' 휴대폰 알림(OS 알림)으로 띄웁니다.
          (2026-08-14 추가)

   ※ 코드를 수정했는데 휴대폰에서 바뀌지 않으면
      아래 CACHE_NAME 의 v9 를 v10, v11 ... 으로 올려주세요.
      그러면 옛 캐시를 버리고 새 파일을 내려받습니다.
   ============================================================ */

const CACHE_NAME = 'why2korea-memo-v9';

// 미리 저장해 둘 파일 목록
const PRECACHE_FILES = [
  './',
  './index.html',
  './secrets.enc.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

// [1] 설치 시점: 위 파일들을 캐시에 담아둡니다
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // 파일 하나가 없어서 설치 전체가 실패하는 일을 막기 위해 하나씩 담습니다
      .then((cache) => Promise.all(
        PRECACHE_FILES.map((url) => cache.add(url).catch(() => null))
      ))
      .then(() => self.skipWaiting())   // 새 버전을 곧바로 활성화
  );
});

// [2] 활성화 시점: 이름이 다른(=옛 버전) 캐시를 모두 지웁니다
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
      // 서비스워커가 새로 깨어났으니 놓친 알람이 있는지 살펴봅니다
      .then(() => alarmWakeup())
      .catch(() => null)
  );
});

// [3] 네트워크 요청 가로채기
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // GET 요청만 다룹니다 (GAS로 보내는 POST 등은 그대로 통과)
  if (request.method !== 'GET') return;

  // 같은 사이트의 파일만 다룹니다 (구글 앱스 스크립트 요청은 통과)
  if (new URL(request.url).origin !== self.location.origin) return;

  // 요청이 들어왔다 = 서비스워커가 깨어 있다 → 놓친 알람이 있는지 슬쩍 확인
  alarmTouch(event);

  // HTML 문서(앱 화면)는 '네트워크 먼저' → 수정한 코드가 바로 반영됩니다
  const isHtml = request.mode === 'navigate' ||
                 (request.headers.get('accept') || '').includes('text/html');

  // 암호화된 개인정보 파일도 '네트워크 먼저'로 다룹니다.
  // 이메일을 고쳐서 새로 올렸을 때 폰이 옛날 것을 계속 쓰지 않도록 하기 위해서입니다.
  const isSecret = new URL(request.url).pathname.endsWith('/secrets.enc.js');

  if (isHtml || isSecret) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // 최신 파일을 받아왔으면 캐시도 갱신해 둡니다
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        // 인터넷이 없으면 저장해 둔 파일을 보여줍니다
        .catch(() => caches.match(request).then(
          (hit) => hit || (isHtml ? caches.match('./index.html') : undefined)
        ))
    );
    return;
  }

  // 아이콘 등 나머지 파일은 '캐시 먼저' → 빠르게 열립니다
  event.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      return response;
    }))
  );
});


/* ============================================================================
   [4] ⏰ 알람 엔진 — 앱이 꺼져 있어도 휴대폰 알림으로 알려줍니다
   ----------------------------------------------------------------------------
   ★ 어떻게 동작하나요?
     앱(index.html)이 알람 목록을 IndexedDB('why2korea_alarm')에 적어 둡니다.
     서비스워커는 앱과 따로 도는 프로그램이라서, 앱을 완전히 껐어도
     아래 네 가지 방법 중 브라우저가 지원하는 것으로 알림을 띄웁니다.

       ① 예약 알림 (Notification Triggers)
          시각을 미리 예약해 두면 앱이 꺼져 있어도 운영체제가 알림을 띄웁니다.
          — 가장 확실한 방법이지만 지원하는 브라우저가 아직 적습니다.
       ② 주기 백그라운드 동기화 (Periodic Background Sync)
          브라우저가 몇 시간에 한 번씩 서비스워커를 깨워 줍니다. 이때 확인합니다.
       ③ 백그라운드 동기화 (Background Sync) / 앱에서 보낸 신호
          앱을 화면 밖으로 내리는 순간 곧 울릴 알람이 있으면 그때까지 기다립니다.
       ④ 뒤늦게 확인 (catch-up)
          위 방법이 모두 막혀 있어도, 서비스워커가 다음에 깨어나는 순간
          '지난 알람' 으로 모아서 알려줍니다.

   ★ 한 번 울린 알람은 IndexedDB 에 fired 표시를 남겨 다시 울리지 않습니다.
     앱은 다음에 열릴 때 이 표시를 읽어 기록(alarmFiredAt)에 옮겨 적습니다.
   ============================================================================ */

const ALARM_DB      = 'why2korea_alarm';   // 알람 전용 저장소 이름
const ALARM_STORE   = 'alarms';            // 그 안의 표 이름
const ALARM_TAG     = 'w2k-alarm-';        // 알림에 붙이는 이름표 (중복 방지)
const ALARM_NEAR_MS = 5 * 60 * 1000;       // '곧 울릴 알람' 기준 = 5분
const ALARM_FETCH_GAP_MS = 20 * 1000;      // fetch 때 확인하는 최소 간격

let alarmLastCheck = 0;   // 마지막으로 확인한 시각 (서비스워커가 죽으면 0으로 돌아감)
let alarmSleepTimer = null;

/* ── IndexedDB 다루기 (앱과 서비스워커가 함께 쓰는 창고) ───────────────── */

function alarmOpenDB() {
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(ALARM_DB, 1); }
    catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ALARM_STORE)) {
        db.createObjectStore(ALARM_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function alarmReadAll() {
  return alarmOpenDB().then((db) => new Promise((resolve) => {
    let out = [];
    try {
      const tx = db.transaction(ALARM_STORE, 'readonly');
      const rq = tx.objectStore(ALARM_STORE).getAll();
      rq.onsuccess = () => { out = rq.result || []; };
      tx.oncomplete = () => { db.close(); resolve(out); };
      tx.onerror = () => { db.close(); resolve([]); };
    } catch (e) { try { db.close(); } catch (e2) {} resolve([]); }
  })).catch(() => []);
}

function alarmWriteMany(items) {
  if (!items || !items.length) return Promise.resolve(false);
  return alarmOpenDB().then((db) => new Promise((resolve) => {
    try {
      const tx = db.transaction(ALARM_STORE, 'readwrite');
      const st = tx.objectStore(ALARM_STORE);
      items.forEach((it) => { try { st.put(it); } catch (e) {} });
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); resolve(false); };
    } catch (e) { try { db.close(); } catch (e2) {} resolve(false); }
  })).catch(() => false);
}

/* ── 알림 문구 만들기 ──────────────────────────────────────────────────── */

const ALARM_WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

function alarmPad2(n) { return (n < 10 ? '0' : '') + n; }

// "2026-08-14 (금) 14:30"
function alarmWhenText(ms) {
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + alarmPad2(d.getMonth() + 1) + '-' + alarmPad2(d.getDate()) +
         ' (' + ALARM_WEEKDAY[d.getDay()] + ') ' +
         alarmPad2(d.getHours()) + ':' + alarmPad2(d.getMinutes());
}

// 알림 하나를 화면에 띄웁니다. late=true 면 '지난 알람' 으로 표시합니다.
function alarmShow(item, late) {
  const title = (item.title || '(제목 없음)');
  const lines = [];
  if (item.category) lines.push('분류: ' + item.category);
  lines.push('알람 시각: ' + alarmWhenText(item.at));
  if (late) lines.push('(앱이 꺼져 있는 동안 시각이 지났습니다)');

  return self.registration.showNotification((late ? '⏰ 지난 알람 — ' : '⏰ 알람 — ') + title, {
    body: lines.join('\n'),
    tag: ALARM_TAG + item.id,
    renotify: true,
    requireInteraction: true,          // 누를 때까지 알림창을 남겨 둡니다
    vibrate: [300, 120, 300, 120, 300],
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    timestamp: item.at,
    data: { id: item.id, at: item.at, kind: 'alarm' }
  }).catch(() => null);
}

// 아직 울리지 않은 '예약 알림' 을 시각에 맞춰 미리 걸어 둡니다 (①번 방법)
function alarmScheduleTriggers(list, now) {
  if (typeof TimestampTrigger === 'undefined') return Promise.resolve(0);

  // 예전에 걸어 둔 예약을 먼저 걷어냅니다 (시각을 바꿨을 수 있으므로).
  // includeTriggered:true 라야 '아직 안 울린 예약' 까지 함께 돌려줍니다.
  // 이미 울려서 화면에 떠 있는 알림(at <= now)은 건드리지 않습니다.
  return self.registration.getNotifications({ includeTriggered: true })
    .catch(() => [])
    .then((olds) => {
      olds.forEach((n) => {
        const d = (n && n.data) || {};
        if (d.scheduled && typeof d.at === 'number' && d.at > now) {
          try { n.close(); } catch (e) {}
        }
      });

      const todo = list.filter((a) => a && a.on && !a.fired && a.at > now);
      const jobs = todo.map((a) => {
        const lines = [];
        if (a.category) lines.push('분류: ' + a.category);
        lines.push('알람 시각: ' + alarmWhenText(a.at));
        return self.registration.showNotification('⏰ 알람 — ' + (a.title || '(제목 없음)'), {
          body: lines.join('\n'),
          tag: ALARM_TAG + a.id,
          renotify: true,
          requireInteraction: true,
          vibrate: [300, 120, 300, 120, 300],
          icon: './icons/icon-192.png',
          badge: './icons/icon-192.png',
          timestamp: a.at,
          showTrigger: new TimestampTrigger(a.at),
          data: { id: a.id, at: a.at, kind: 'alarm', scheduled: true }
        }).then(() => true).catch(() => false);
      });

      return Promise.all(jobs).then((oks) => {
        // 예약에 성공한 알람은 armed 표시를 남깁니다 (나중에 두 번 울리지 않도록)
        const armed = [];
        todo.forEach((a, i) => { if (oks[i] && !a.armed) { a.armed = true; armed.push(a); } });
        return alarmWriteMany(armed).then(() => oks.filter(Boolean).length);
      });
    })
    .catch(() => 0);
}

/* ── 시각이 된 알람 울리기 ─────────────────────────────────────────────── */

function alarmFireDue() {
  const now = Date.now();

  return alarmReadAll().then((list) => {
    const due = list
      .filter((a) => a && a.on && !a.fired && typeof a.at === 'number' && a.at <= now + 1500)
      .sort((a, b) => a.at - b.at);

    if (!due.length) return { fired: 0, list: list };

    const jobs = due.map((a) => {
      a.fired = now;
      const late = (now - a.at) > 90 * 1000;

      // ①번(예약 알림)으로 걸어 둔 알람은 이미 떠 있을 수 있습니다.
      // 실제로 떠 있는지 확인해서, 떠 있으면 그냥 두고(중복 방지)
      // 사라졌으면 지금 다시 띄웁니다.
      if (!a.armed) return alarmShow(a, late);
      return self.registration.getNotifications({ tag: ALARM_TAG + a.id, includeTriggered: true })
        .catch(() => [])
        .then((ns) => (ns && ns.length ? null : alarmShow(a, late)));
    });

    return Promise.all(jobs)
      .then(() => alarmWriteMany(due))
      .then(() => alarmNotifyClients())
      .then(() => ({ fired: due.length, list: list }));
  });
}

// 앱이 열려 있다면 "알람 울렸어요" 라고 알려 줍니다 (앱 안 팝업이 겹치지 않도록)
function alarmNotifyClients() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((cls) => { cls.forEach((c) => { try { c.postMessage({ type: 'ALARM_FIRED' }); } catch (e) {} }); })
    .catch(() => null);
}

/* ── 서비스워커가 깨어났을 때 하는 일 ─────────────────────────────────── */

// ① 놓친 알람을 울리고 ② 앞으로의 알람을 예약합니다.
// 돌려주는 값: 가장 가까운 다음 알람까지 남은 밀리초 (없으면 -1)
function alarmWakeup() {
  alarmLastCheck = Date.now();

  return alarmFireDue().then((res) => {
    const now = Date.now();
    const rest = res.list.filter((a) => a && a.on && !a.fired && a.at > now);

    return alarmScheduleTriggers(rest, now).then(() => {
      if (!rest.length) return -1;
      return rest.reduce((min, a) => Math.min(min, a.at), Infinity) - now;
    });
  }).catch(() => -1);
}

/* 곧(5분 안에) 울릴 알람이 있으면 그때까지 서비스워커를 붙잡아 둡니다.
   ①번 예약 알림을 못 쓰는 브라우저에서 '화면을 끈 직후' 알람이 울리게 해 줍니다.
   (브라우저가 허락하는 만큼만 살아 있으므로 최대 5분으로 제한합니다) */
function alarmHoldUntilNext(waitMs) {
  if (waitMs < 0 || waitMs > ALARM_NEAR_MS) return Promise.resolve(false);

  return new Promise((resolve) => {
    if (alarmSleepTimer) clearTimeout(alarmSleepTimer);
    alarmSleepTimer = setTimeout(() => {
      alarmSleepTimer = null;
      alarmFireDue().then(() => resolve(true)).catch(() => resolve(false));
    }, Math.max(500, waitMs + 500));
  });
}

// fetch 가 들어올 때마다 매번 확인하면 무거우므로 20초에 한 번만 확인합니다
function alarmTouch(event) {
  const now = Date.now();
  if (now - alarmLastCheck < ALARM_FETCH_GAP_MS) return;
  alarmLastCheck = now;
  try { event.waitUntil(alarmWakeup().catch(() => null)); } catch (e) {}
}

/* ── 깨어나는 통로들 ───────────────────────────────────────────────────── */

// 앱이 보내는 신호 (알람을 저장·수정했을 때, 앱을 화면 밖으로 내렸을 때)
self.addEventListener('message', (event) => {
  const msg = event.data || {};

  if (msg.type === 'ALARM_ARM' || msg.type === 'ALARM_SYNC') {
    event.waitUntil(
      alarmWakeup()
        .then((waitMs) => (msg.hold ? alarmHoldUntilNext(waitMs) : null))
        .catch(() => null)
    );
    return;
  }

  if (msg.type === 'SKIP_WAITING') { self.skipWaiting(); }
});

// 브라우저가 주기적으로 깨워 주는 통로 (설치한 PWA + 크롬 계열)
self.addEventListener('periodicsync', (event) => {
  if (event.tag !== 'w2k-alarm-check') return;
  event.waitUntil(alarmWakeup().then((w) => alarmHoldUntilNext(w)).catch(() => null));
});

// 인터넷이 끊겼다 돌아올 때 등 (한 번짜리 동기화)
self.addEventListener('sync', (event) => {
  if (event.tag !== 'w2k-alarm-check') return;
  event.waitUntil(alarmWakeup().then((w) => alarmHoldUntilNext(w)).catch(() => null));
});

// 푸시 서버를 나중에 붙일 때를 대비한 통로 (지금은 쓰지 않습니다)
self.addEventListener('push', (event) => {
  event.waitUntil(alarmWakeup().catch(() => null));
});

// 알림을 눌렀을 때 → 앱을 열고 그 메모 상세로 보냅니다
self.addEventListener('notificationclick', (event) => {
  const data = (event.notification && event.notification.data) || {};
  event.notification.close();
  if (data.kind !== 'alarm') return;

  event.waitUntil((async () => {
    // 예약 알림(①번)이 울린 경우에는 아직 fired 표시가 없으므로 여기서 남깁니다
    try {
      const list = await alarmReadAll();
      const hit = list.filter((a) => a && a.id === data.id && !a.fired);
      if (hit.length) { hit[0].fired = Date.now(); await alarmWriteMany(hit); }
    } catch (e) {}

    const cls = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of cls) {
      if ('focus' in c) {
        try { c.postMessage({ type: 'ALARM_OPEN', id: data.id }); } catch (e) {}
        return c.focus();
      }
    }
    if (self.clients.openWindow) {
      return self.clients.openWindow('./index.html?alarm=' + encodeURIComponent(data.id || ''));
    }
  })().catch(() => null));
});

// 알림을 (누르지 않고) 지웠을 때도 '울렸음' 으로 표시해 둡니다
self.addEventListener('notificationclose', (event) => {
  const data = (event.notification && event.notification.data) || {};
  if (data.kind !== 'alarm') return;
  event.waitUntil((async () => {
    try {
      const list = await alarmReadAll();
      const hit = list.filter((a) => a && a.id === data.id && !a.fired);
      if (hit.length) { hit[0].fired = Date.now(); await alarmWriteMany(hit); }
    } catch (e) {}
  })().catch(() => null));
});
