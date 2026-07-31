# -*- coding: utf-8 -*-
"""
why2korea_memo 앱 아이콘 생성 스크립트
--------------------------------------
어두운 배경(#111111) + 노란 번개(#FFD400) 아이콘 PNG 3장을 만듭니다.

만들어지는 파일 (icons 폴더):
  - icon-192.png          안드로이드 홈화면 아이콘
  - icon-512.png          스플래시 화면 / 고해상도용
  - apple-touch-icon.png  아이폰 홈화면 아이콘 (180x180)

특징: 외부 라이브러리(PIL 등) 없이 파이썬 기본 모듈만 씁니다.
      추가 설치가 필요 없어서 어느 PC에서든 바로 실행됩니다.

실행 방법 (윈도우 PowerShell):
  cd C:\\why2korea\\claude\\smartphone
  python tools\\make_icons.py

색이나 모양을 바꾸고 싶으면 아래 [설정] 부분의 숫자만 고치고 다시 실행하면 됩니다.
"""

import os
import zlib
import struct

# ─────────────────────────────────────────────────────────────
# [설정] 이 값들만 바꾸면 아이콘 모양/색이 바뀝니다
# ─────────────────────────────────────────────────────────────

BG_COLOR = (0x11, 0x11, 0x11)      # 배경색: 진한 회색(거의 검정)
FG_COLOR = (0xFF, 0xD4, 0x00)      # 심볼색: 노랑

# 번개 모양의 좌표 (0.0 ~ 1.0 사이의 비율. x는 오른쪽으로, y는 아래로 증가)
# 아이콘 크기가 몇 픽셀이든 이 비율대로 그려집니다.
BOLT_POINTS = [
    (13 / 24, 2 / 24),    # 번개 맨 위 (왼쪽 꼭지)
    (3 / 24, 14 / 24),    # 왼쪽 아래로 내려오는 사선
    (12 / 24, 14 / 24),   # 가운데 꺾이는 지점
    (11 / 24, 22 / 24),   # 번개 맨 아래 (뾰족한 끝)
    (21 / 24, 10 / 24),   # 오른쪽 위로 올라가는 사선
    (12 / 24, 10 / 24),   # 가운데 꺾이는 지점
]

# 번개를 아이콘 대비 몇 %로 그릴지. 너무 크면 안드로이드에서 모서리가 잘립니다.
BOLT_SCALE = 0.76

# 세로 방향 안티에일리어싱(계단 현상 제거) 정밀도. 4면 충분히 매끄럽습니다.
SUPERSAMPLE = 4

# 만들 아이콘 목록: (파일이름, 픽셀크기)
TARGETS = [
    ("icon-192.png", 192),
    ("icon-512.png", 512),
    ("apple-touch-icon.png", 180),
]


# ─────────────────────────────────────────────────────────────
# [1] PNG 파일로 저장하는 함수 (라이브러리 없이 직접 만듦)
# ─────────────────────────────────────────────────────────────

def save_png(path, width, height, rgb_bytes):
    """RGB 픽셀 데이터를 PNG 파일로 저장합니다."""

    # PNG는 각 줄 앞에 '필터 방식' 1바이트를 붙여야 합니다 (0 = 필터 없음)
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        raw += rgb_bytes[y * width * 3:(y + 1) * width * 3]

    def make_chunk(tag, data):
        """PNG의 기본 단위인 '청크'를 만듭니다. (길이 + 태그 + 데이터 + 체크섬)"""
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"                                   # PNG 파일임을 알리는 서명
    # IHDR: 가로, 세로, 색 깊이 8비트, 색 방식 2(트루컬러 RGB)
    png += make_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    png += make_chunk(b"IDAT", zlib.compress(bytes(raw), 9))     # 실제 이미지 데이터(압축)
    png += make_chunk(b"IEND", b"")                              # 파일 끝 표시

    with open(path, "wb") as f:
        f.write(png)


# ─────────────────────────────────────────────────────────────
# [2] 다각형(번개 모양)을 픽셀로 칠하는 함수
# ─────────────────────────────────────────────────────────────

def rasterize_polygon(points, size):
    """
    points: (x, y) 비율 좌표 목록
    size:   아이콘 한 변의 픽셀 수
    반환값: 픽셀마다 '얼마나 칠해졌는지'(0.0~1.0)를 담은 리스트
    """
    # 비율 좌표를 실제 픽셀 좌표로 변환 (가운데 정렬 + BOLT_SCALE 적용)
    pts = []
    for (x, y) in points:
        px = (0.5 + (x - 0.5) * BOLT_SCALE) * size
        py = (0.5 + (y - 0.5) * BOLT_SCALE) * size
        pts.append((px, py))

    coverage = [0.0] * (size * size)
    edges = list(zip(pts, pts[1:] + pts[:1]))   # 점들을 이어서 변(edge) 목록 만들기

    # 가로선을 아주 촘촘하게(픽셀당 SUPERSAMPLE개) 그으면서, 도형 내부 구간을 칠합니다
    total_rows = size * SUPERSAMPLE
    for row in range(total_rows):
        sy = (row + 0.5) / SUPERSAMPLE          # 이 가로선의 y 좌표
        pixel_y = row // SUPERSAMPLE            # 결과가 들어갈 픽셀 줄 번호

        # 이 가로선이 도형의 변과 만나는 x 좌표들을 모두 찾습니다
        crossings = []
        for (x1, y1), (x2, y2) in edges:
            if (y1 <= sy < y2) or (y2 <= sy < y1):
                t = (sy - y1) / (y2 - y1)
                crossings.append(x1 + t * (x2 - x1))
        if len(crossings) < 2:
            continue
        crossings.sort()

        # 교차점을 짝지어(0-1, 2-3 ...) 그 사이를 도형 내부로 보고 칠합니다
        for i in range(0, len(crossings) - 1, 2):
            xa, xb = crossings[i], crossings[i + 1]
            xa = max(0.0, xa)
            xb = min(float(size), xb)
            if xb <= xa:
                continue
            first = int(xa)
            last = min(size - 1, int(xb - 1e-9))
            for px in range(first, last + 1):
                # 이 픽셀이 구간에 걸친 가로 비율만큼 칠합니다 (부드러운 경계)
                left = max(xa, px)
                right = min(xb, px + 1.0)
                if right > left:
                    coverage[pixel_y * size + px] += (right - left) / SUPERSAMPLE

    return coverage


# ─────────────────────────────────────────────────────────────
# [3] 실제로 아이콘 파일들을 만듭니다
# ─────────────────────────────────────────────────────────────

def build_icon(path, size):
    coverage = rasterize_polygon(BOLT_POINTS, size)

    pixels = bytearray(size * size * 3)
    for i in range(size * size):
        a = coverage[i]
        if a > 1.0:
            a = 1.0
        # 배경색과 심볼색을 칠해진 비율(a)만큼 섞습니다
        for c in range(3):
            value = BG_COLOR[c] * (1.0 - a) + FG_COLOR[c] * a
            pixels[i * 3 + c] = int(value + 0.5)

    save_png(path, size, size, bytes(pixels))
    print(f"  만들었습니다: {path}  ({size}x{size})")


def main():
    # 이 스크립트는 tools 폴더에 있으므로, 한 단계 위가 프로젝트 폴더입니다
    project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    icons_dir = os.path.join(project_dir, "icons")
    os.makedirs(icons_dir, exist_ok=True)

    print("아이콘 생성을 시작합니다...")
    for filename, size in TARGETS:
        build_icon(os.path.join(icons_dir, filename), size)
    print("완료! icons 폴더를 확인하세요.")


if __name__ == "__main__":
    main()
