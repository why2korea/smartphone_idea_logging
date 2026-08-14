/* ============================================================
   why2korea_memo 서비스워커 (sw.js)
   ------------------------------------------------------------
   역할: 앱 파일을 브라우저에 저장(캐시)해두어
         비행기 모드/지하철처럼 인터넷이 없을 때도 앱이 열리게 합니다.

   ※ 코드를 수정했는데 휴대폰에서 바뀌지 않으면
      아래 CACHE_NAME 의 v1 을 v2, v3 ... 으로 올려주세요.
      그러면 옛 캐시를 버리고 새 파일을 내려받습니다.
   ============================================================ */

const CACHE_NAME = 'why2korea-memo-v8';

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
  );
});

// [3] 네트워크 요청 가로채기
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // GET 요청만 다룹니다 (GAS로 보내는 POST 등은 그대로 통과)
  if (request.method !== 'GET') return;

  // 같은 사이트의 파일만 다룹니다 (구글 앱스 스크립트 요청은 통과)
  if (new URL(request.url).origin !== self.location.origin) return;

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
