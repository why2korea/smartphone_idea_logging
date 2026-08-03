/**
 * ============================================================================
 *  why2korea_memo — Google Apps Script (2단계: 실제 자동 발송 + 구글 드라이브 저장)
 * ============================================================================
 *
 *  이 파일이 하는 일
 *   1) 앱에서 보낸 기록(JSON)을 받습니다               → doPost(e)
 *   2) 실제로 이메일을 발송합니다 (손글씨 PNG + 앱에서 붙인 첨부파일) → MailApp.sendEmail()
 *   3) 같은 내용을 구글 드라이브 폴더에 저장합니다        → 텍스트 + 이미지
 *   4) 구글 스프레드시트에 한 줄씩 로그를 남깁니다
 *
 *  ※ 폴더와 시트는 없으면 스크립트가 알아서 만듭니다. ID를 찾아 넣을 필요가 없습니다.
 *
 * ----------------------------------------------------------------------------
 *  ★ 붙여넣기 & 배포 방법 (처음 한 번만, 5분) ★
 * ----------------------------------------------------------------------------
 *  1. 크롬에서  https://script.google.com  접속 → 왼쪽 위 [새 프로젝트]
 *
 *  2. 프로젝트 이름을 'why2korea_memo' 로 바꿉니다 (왼쪽 위 '제목 없는 프로젝트' 클릭)
 *
 *  3. 가운데 코드 편집창에 원래 있던 내용(function myFunction...)을 전부 지우고,
 *     이 파일 전체를 복사해서 붙여넣습니다 → 저장(Ctrl+S)
 *
 *  4. 오른쪽 위 [배포] → [새 배포]
 *       - 왼쪽 톱니바퀴(유형 선택) → '웹 앱' 선택
 *       - 설명:            why2korea_memo v1   (아무 글자나 괜찮습니다)
 *       - 실행:            나                  ★ 반드시 '나'
 *       - 액세스 권한이 있는 사용자: 모든 사용자  ★ 반드시 '모든 사용자'
 *       - [배포] 클릭
 *
 *  5. 처음이라면 권한 승인 창이 뜹니다
 *       [액세스 승인] → 본인 구글 계정 선택
 *       → "Google에서 확인하지 않은 앱" 경고가 나오면
 *         [고급] → 맨 아래 [why2korea_memo(안전하지 않음)으로 이동] → [허용]
 *       (내가 만든 내 스크립트라서 안전합니다. 구글 심사를 받지 않았다는 뜻일 뿐입니다.)
 *
 *  6. 배포가 끝나면 '웹 앱 URL' 이 나옵니다. 아래처럼 /exec 로 끝나는 주소입니다.
 *         https://script.google.com/macros/s/AKfycb..................../exec
 *     이 주소를 복사하세요.
 *
 *  7. 휴대폰(또는 PC)에서 why2korea_memo 앱을 열고
 *       [설정] → '전송 방식' 에서  ◉ 직접 발송 (Google Apps Script) 선택
 *              → 'Google Apps Script 웹앱 URL' 칸에 6번 주소 붙여넣기
 *              → [연결 테스트] 눌러 "연결 성공!" 확인
 *              → [전송 설정 저장]
 *     끝났습니다. 이제 이메일 버튼을 누르면 메일앱을 거치지 않고 바로 발송됩니다.
 *
 *  ▶ 코드를 수정한 뒤에는 반드시 [배포] → [배포 관리] → 연필(수정) →
 *    버전: '새 버전' → [배포] 를 해야 반영됩니다. (URL은 그대로 유지됩니다)
 *
 * ----------------------------------------------------------------------------
 *  참고 (무료 한도)
 *   무료 지메일 계정은 하루 100통까지 발송할 수 있습니다. 개인 메모용으로는 충분합니다.
 * ----------------------------------------------------------------------------
 */


/* ============================================================================
   [설정] 이 값만 필요하면 바꾸세요
   ============================================================================ */

// 드라이브에 만들어질 폴더 이름
var FOLDER_NAME = 'why2korea_memo';

// 로그를 기록할 스프레드시트 이름
var SHEET_NAME = 'why2korea_memo_log';

// 메일 보낸 사람 이름 (받는 사람 메일함에 이렇게 표시됩니다)
var SENDER_NAME = 'why2korea_memo';


/* ============================================================================
   [1] 앱에서 보낸 요청 받기
   ============================================================================ */

/**
 * 앱이 fetch(POST)로 보낸 요청을 처리합니다.
 * 앱은 CORS 문제를 피하려고 Content-Type: text/plain 으로 보내므로,
 * 여기서 문자열을 JSON.parse 해서 읽습니다.
 */
function doPost(e) {
  try {
    // 본문이 비어 있으면 오류
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOut({ ok: false, error: '내용이 비어 있음' });
    }

    var data = JSON.parse(e.postData.contents);

    // 앱의 [연결 테스트] 버튼이 보내는 신호 → 메일을 보내지 않고 바로 응답
    if (data.ping) {
      return jsonOut({
        ok: true,
        message: '연결 성공',
        remainingQuota: MailApp.getRemainingDailyQuota()   // 오늘 남은 발송 가능 통수
      });
    }

    return jsonOut(handleRecord(data));

  } catch (err) {
    // 오류가 나도 앱이 멈추지 않도록 항상 JSON으로 답합니다
    return jsonOut({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/**
 * 브라우저에서 URL을 직접 열었을 때 보이는 화면입니다.
 * 이 글이 보이면 배포가 잘 된 것입니다.
 */
function doGet(e) {
  return ContentService
    .createTextOutput('why2korea_memo GAS 정상 동작 중입니다. 이 주소를 앱 설정에 붙여넣으세요.')
    .setMimeType(ContentService.MimeType.TEXT);
}

/** 앱에게 JSON으로 답하기 */
function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/* ============================================================================
   [2] 기록 하나를 처리 (메일 발송 → 드라이브 저장 → 시트 기록)
   ============================================================================ */

function handleRecord(data) {
  // ── 받은 값 정리 ──
  var to = (data.to || []).filter(function (a) { return a && a.indexOf('@') > 0; });
  if (!to.length) return { ok: false, error: '수신자가 없음' };

  var subject  = data.subject || '(제목 없음)';
  var body     = data.body || '';
  var category = data.category || '미분류';
  var title    = data.title || '';
  var text     = data.text || '';
  var group    = data.group || '';
  var drawings = data.drawings || [];          // PNG dataURL 목록
  var files    = data.files || [];             // 첨부파일 {name,type,size,data} 목록
  var when     = data.createdAt ? new Date(data.createdAt) : new Date();

  // ── 손글씨 dataURL → 첨부파일(Blob)로 변환 ──
  var stamp = formatStamp(when);               // 예: 20260730_1432
  var attachments = [];
  for (var i = 0; i < drawings.length; i++) {
    var blob = dataUrlToBlob(drawings[i], stamp + '_손글씨' + (i + 1) + '.png');
    if (blob) attachments.push(blob);
  }

  // ── 앱에서 붙인 첨부파일 → Blob으로 변환 (원래 파일 이름을 그대로 씁니다) ──
  var fileCount = 0;
  for (var j = 0; j < files.length; j++) {
    var f = files[j] || {};
    var fname = safeFileName(f.name || ('첨부' + (j + 1)));
    var fblob = dataUrlToBlob(f.data, stamp + '_' + fname);
    if (fblob) { attachments.push(fblob); fileCount++; }
  }

  // ── (1) 이메일 발송 ──
  MailApp.sendEmail({
    to: to.join(','),
    subject: subject,
    body: body,
    name: SENDER_NAME,
    attachments: attachments
  });

  // ── (2) 구글 드라이브에 저장 ──
  // 드라이브 저장이나 시트 기록이 실패해도 '메일은 이미 보냈으니' 실패로 만들지 않습니다.
  var driveUrl = '';
  try {
    driveUrl = saveToDrive({
      when: when, stamp: stamp, category: category, title: title,
      text: text, body: body, group: group, to: to, attachments: attachments
    });
  } catch (err) {
    driveUrl = '저장 실패: ' + err;
  }

  // ── (3) 스프레드시트에 로그 한 줄 ──
  try {
    appendLog({
      when: when, category: category, title: title, text: text,
      group: group, to: to, count: attachments.length - fileCount,
      fileCount: fileCount, driveUrl: driveUrl, id: data.id || ''
    });
  } catch (err) {
    // 로그 실패는 무시합니다
  }

  return {
    ok: true,
    sentTo: to,
    attachments: attachments.length,
    files: fileCount,
    driveUrl: driveUrl,
    remainingQuota: MailApp.getRemainingDailyQuota()
  };
}


/* ============================================================================
   [3] 구글 드라이브 저장
   ============================================================================ */

/**
 * 폴더 구조는 이렇게 만들어집니다.
 *   내 드라이브 / why2korea_memo / 2026-07 / 20260730_1432_[개인용]_제목.txt
 *                                          / 20260730_1432_손글씨1.png
 */
function saveToDrive(rec) {
  var monthName = rec.when.getFullYear() + '-' + pad2(rec.when.getMonth() + 1);
  var monthFolder = getOrCreateChildFolder(getRootFolder(), monthName);

  // 텍스트 파일 저장
  var safeTitle = sanitize(rec.title || firstLine(rec.text) || '무제');
  var fileName = rec.stamp + '_[' + rec.category + ']_' + safeTitle + '.txt';

  var content =
      rec.body + '\n\n' +
      '─────────────\n' +
      '전송 그룹: ' + rec.group + '\n' +
      '수신자: ' + rec.to.join(', ') + '\n';

  var txtFile = monthFolder.createFile(
    Utilities.newBlob(content, 'text/plain; charset=utf-8', fileName)
  );

  // 손글씨 이미지 저장
  for (var i = 0; i < rec.attachments.length; i++) {
    monthFolder.createFile(rec.attachments[i].copyBlob().setName(rec.attachments[i].getName()));
  }

  return txtFile.getUrl();
}

/** 최상위 폴더(why2korea_memo)를 얻습니다. 없으면 만듭니다. */
function getRootFolder() {
  var props = PropertiesService.getScriptProperties();
  var savedId = props.getProperty('FOLDER_ID');

  // 이미 만들어 둔 폴더가 있으면 그걸 씁니다 (매번 검색하지 않아 빠릅니다)
  if (savedId) {
    try { return DriveApp.getFolderById(savedId); } catch (e) { /* 지워졌으면 새로 만듭니다 */ }
  }

  var folder = getOrCreateChildFolder(DriveApp.getRootFolder(), FOLDER_NAME);
  props.setProperty('FOLDER_ID', folder.getId());
  return folder;
}

/** 부모 폴더 안에서 이름이 같은 폴더를 찾고, 없으면 만듭니다. */
function getOrCreateChildFolder(parent, name) {
  var it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}


/* ============================================================================
   [4] 스프레드시트 로그
   ============================================================================ */

function appendLog(rec) {
  var sheet = getLogSheet();
  sheet.appendRow([
    rec.when,                          // 기록 시각
    rec.category,                      // 분류
    rec.title,                         // 제목
    truncate(rec.text, 2000),          // 본문 (너무 길면 자릅니다)
    rec.group,                         // 전송 그룹
    rec.to.join(', '),                 // 수신자
    rec.count,                         // 손글씨 장수
    rec.driveUrl,                      // 드라이브 링크
    new Date(),                        // 발송 시각
    rec.id,                            // 앱 안에서의 기록 id
    rec.fileCount || 0                 // 첨부파일 개수 (★ 맨 끝에 추가 — 기존 열 순서를 건드리지 않습니다)
  ]);
}

/** 로그 시트를 얻습니다. 없으면 스프레드시트를 새로 만듭니다. */
function getLogSheet() {
  var props = PropertiesService.getScriptProperties();
  var savedId = props.getProperty('SHEET_ID');

  if (savedId) {
    try { return SpreadsheetApp.openById(savedId).getSheets()[0]; } catch (e) { /* 새로 만듭니다 */ }
  }

  // 새 스프레드시트를 만들고, why2korea_memo 폴더 안으로 옮깁니다
  var ss = SpreadsheetApp.create(SHEET_NAME);
  var sheet = ss.getSheets()[0];

  // 제목 줄 만들기
  sheet.appendRow(['기록 시각', '분류', '제목', '본문', '전송 그룹', '수신자', '손글씨(장)', '드라이브 링크', '발송 시각', 'id', '첨부파일(개)']);
  sheet.getRange(1, 1, 1, 11).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(3, 220);
  sheet.setColumnWidth(4, 380);

  try {
    DriveApp.getFileById(ss.getId()).moveTo(getRootFolder());
  } catch (e) { /* 옮기지 못해도 시트는 정상 동작합니다 */ }

  props.setProperty('SHEET_ID', ss.getId());
  return sheet;
}


/* ============================================================================
   [5] 잡다한 도우미 함수들
   ============================================================================ */

/** "data:image/png;base64,AAAA..." → 첨부 가능한 Blob */
function dataUrlToBlob(dataUrl, fileName) {
  if (!dataUrl || dataUrl.indexOf('base64,') === -1) return null;
  var parts = dataUrl.split('base64,');
  var mime = (parts[0].match(/data:([^;]+)/) || [null, 'image/png'])[1];
  var bytes = Utilities.base64Decode(parts[1]);
  return Utilities.newBlob(bytes, mime, fileName);
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

/** 파일 이름에 쓰는 시각 → 20260730_1432 */
function formatStamp(d) {
  return '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
         '_' + pad2(d.getHours()) + pad2(d.getMinutes());
}

/** 파일 이름에 쓸 수 없는 글자 제거 */
function sanitize(s) {
  return String(s).replace(/[\\\/:*?"<>|\n\r\t]/g, ' ').trim().slice(0, 50) || '무제';
}

/**
 * 첨부파일 이름 정리 — 위 sanitize 와 같지만 '확장자를 잃지 않게' 합니다.
 *   '아주긴이름............pdf' → '아주긴이름(50자까지).pdf'
 */
function safeFileName(name) {
  var clean = String(name || '').replace(/[\\\/:*?"<>|\n\r\t]/g, ' ').trim();
  if (!clean) return '첨부파일';

  var dot = clean.lastIndexOf('.');
  var ext = (dot > 0 && clean.length - dot <= 12) ? clean.slice(dot) : '';
  var base = ext ? clean.slice(0, dot) : clean;

  if (base.length > 50) base = base.slice(0, 50);
  return (base || '첨부파일') + ext;
}

function firstLine(text) {
  var lines = String(text || '').split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].trim()) return lines[i].trim();
  }
  return '';
}

function truncate(s, max) {
  s = String(s || '');
  return s.length > max ? s.slice(0, max) + '…' : s;
}


/* ============================================================================
   [6] 테스트용 함수 — 편집기에서 직접 실행해 볼 수 있습니다
   ----------------------------------------------------------------------------
   사용법: 위쪽 함수 선택 칸에서 'testSendToMe' 를 고르고 [실행] 버튼 클릭.
          내 지메일 주소로 테스트 메일이 오고, 드라이브/시트도 만들어집니다.
          (앱에서 배포 없이 미리 확인할 때 편리합니다)
   ============================================================================ */

function testSendToMe() {
  var myEmail = Session.getActiveUser().getEmail();

  var result = handleRecord({
    id: 'test-1',
    group: '나에게',
    to: [myEmail],
    subject: '[개인용] ' + formatStamp(new Date()) + ' — GAS 연결 테스트',
    body: 'why2korea_memo GAS 테스트입니다.\n\n---\n분류: 개인용',
    category: '개인용',
    title: 'GAS 연결 테스트',
    text: 'why2korea_memo GAS 테스트입니다.',
    createdAt: new Date().toISOString(),
    drawings: [],
    files: []
  });

  Logger.log(JSON.stringify(result, null, 2));
}
