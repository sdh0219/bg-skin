# -*- coding: utf-8 -*-
"""bg-skin v3: realistic macOS desktop + VS Code compositor (1920x1080)"""
import math, os, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps

W, H = 1920, 1080
ROOT = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(ROOT, "assets")
OUT_FRAMES = os.path.join(ASSETS, "frames3")
os.makedirs(OUT_FRAMES, exist_ok=True)

VSC_BG = (30, 30, 30)
VSC_SIDE = (37, 37, 41)
VSC_SIDE2 = (32, 32, 36)
VSC_TAB = (45, 45, 48)
VSC_TAB_ACT = (30, 30, 30)
VSC_STATUS = (0, 122, 204)
WHITE = (240, 240, 240)
DIM = (160, 160, 165)
ORANGE = (255, 140, 40)
CYAN = (78, 201, 176)
PINK = (206, 145, 120)
GOLD = (255, 200, 60)


def font(size, bold=False):
    p = r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc"
    if os.path.exists(p):
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            pass
    return ImageFont.load_default()


def mono_font(size):
    for p in (r"C:\Windows\Fonts\consola.ttf", r"C:\Windows\Fonts\cour.ttf", r"C:\Windows\Fonts\msyh.ttc"):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return font(size)


def load_wall(name, size=(W, H)):
    im = Image.open(os.path.join(ASSETS, name)).convert("RGB")
    return ImageOps.fit(im, size, method=Image.Resampling.LANCZOS)


def draw_macos_menubar(img, time_str="16:31"):
    bar = Image.new("RGBA", (W, 28), (20, 20, 24, 210))
    d = ImageDraw.Draw(bar)
    d.text((14, 14), "VS Code", font=font(13, True), fill=WHITE, anchor="lm")
    for i, t in enumerate(["File", "Edit", "Selection", "View", "Go", "Run", "Terminal", "Help"]):
        d.text((90 + i * 72, 14), t, font=font(12), fill=(200, 200, 205), anchor="lm")
    d.text((W // 2, 14), "♪  coding playlist", font=font(12), fill=(180, 180, 190), anchor="mm")
    for x, t in [(W - 300, "⚙"), (W - 260, "☀"), (W - 220, "36%"), (W - 170, "📶"), (W - 120, "100%"), (W - 70, time_str)]:
        d.text((x, 14), t, font=font(12), fill=(220, 220, 225), anchor="lm")
    img.alpha_composite(bar, (0, 0))


def draw_dock(img):
    apps = ["finder", "safari", "code", "iterm", "music", "settings", "trash"]
    colors = {
        "finder": (70, 150, 230), "safari": (40, 160, 220), "code": (0, 120, 200),
        "iterm": (40, 40, 45), "music": (240, 60, 90), "settings": (140, 140, 150), "trash": (90, 90, 95),
    }
    bw, gap = 56, 10
    total = len(apps) * bw + (len(apps) - 1) * gap
    x0, y0 = (W - total) // 2, H - 74
    glass = Image.new("RGBA", (total + 28, 76), (0, 0, 0, 0))
    ImageDraw.Draw(glass).rounded_rectangle([0, 0, total + 24, 72], radius=18, fill=(40, 40, 46, 190), outline=(80, 80, 90, 120))
    img.alpha_composite(glass, (x0 - 12, y0 - 8))
    d = ImageDraw.Draw(img)
    for i, a in enumerate(apps):
        x = x0 + i * (bw + gap)
        d.rounded_rectangle([x, y0, x + bw, y0 + bw], radius=12, fill=colors[a] + (255,))
        if a == "code":
            d.polygon([(x + 18, y0 + 28), (x + 28, y0 + 16), (x + 32, y0 + 16), (x + 22, y0 + 28), (x + 32, y0 + 40), (x + 28, y0 + 40)], fill=WHITE)
        elif a == "iterm":
            d.rectangle([x + 12, y0 + 14, x + 44, y0 + 42], outline=(0, 220, 120), width=2)
            d.text((x + 16, y0 + 28), ">_", font=mono_font(12), fill=(0, 220, 120), anchor="lm")
        if a == "code":
            d.ellipse([x + 25, y0 + bw + 2, x + 31, y0 + bw + 8], fill=WHITE)


def draw_activity_icon(d, x, y, kind, active=False):
    col = WHITE if active else (160, 160, 168)
    if kind == "files":
        d.rounded_rectangle([x - 7, y - 8, x + 7, y + 6], radius=2, outline=col, width=2)
        d.line([(x - 4, y - 3), (x + 4, y - 3)], fill=col, width=2)
        d.line([(x - 4, y + 1), (x + 4, y + 1)], fill=col, width=2)
    elif kind == "search":
        d.ellipse([x - 8, y - 8, x + 2, y + 2], outline=col, width=2)
        d.line([(x + 2, y + 2), (x + 8, y + 8)], fill=col, width=2)
    elif kind == "git":
        d.ellipse([x - 6, y - 6, x + 2, y + 2], outline=col, width=2)
        d.ellipse([x - 2, y + 2, x + 6, y + 10], outline=col, width=2)
        d.line([(x - 2, y), (x + 2, y + 4)], fill=col, width=2)
    elif kind == "debug":
        d.ellipse([x - 7, y - 5, x + 7, y + 9], outline=col, width=2)
        d.line([(x - 4, y - 8), (x + 4, y - 8)], fill=col, width=2)
    elif kind == "ext":
        d.rounded_rectangle([x - 7, y - 7, x + 7, y + 7], radius=2, outline=col, width=2)
        d.line([(x - 3, y), (x + 3, y)], fill=col, width=2)
        d.line([(x, y - 3), (x, y + 3)], fill=col, width=2)


def tokenize_toml(line):
    if line.strip().startswith("#"):
        return [(line, (106, 153, 85))]
    if line.strip().startswith("["):
        return [(line, (86, 156, 214))]
    if "=" in line:
        k, v = line.split("=", 1)
        return [(k + "=", (156, 220, 254)), (v, (206, 145, 120))]
    return [(line, (212, 212, 212))]


CARGO_TOML = [
    "[package]", 'name = "rust-deep-learning"', 'version = "0.1.0"', 'edition = "2021"',
    "", "[workspace]", "members = [", '    "crates/*",', "]", "",
    "[dependencies]", 'ndarray = "0.15"', 'candle-core = "0.3"', 'anyhow = "1.0"',
]
EXT_JS = [
    "'use strict';", "", "const vscode = require('vscode');",
    "const patcher = require('./src/patcher');", "",
    "function getConfig() {",
    "  const c = vscode.workspace.getConfiguration('bgSkin');",
    "  return { enabled: c.get('enabled', true),",
    "    images: (c.get('images', []) || []).map(String),",
    "    opacity: c.get('opacity', 0.18) };", "}",
    "", "function syncPatch() {", "  const cfg = getConfig();",
    "  if (cfg.enabled && cfg.images.length > 0) {",
    "    return patcher.applyPatch(vscode.env.appRoot, {",
    "      imagePath: cfg.images[0], opacity: cfg.opacity }, log);",
    "  }", "}",
]


def draw_code_lines(d, x, y, lines, line_h=22, highlight=None):
    mf = mono_font(15)
    for i, line in enumerate(lines):
        yy = y + i * line_h
        if highlight is not None and i == highlight:
            d.rectangle([x - 10, yy - 2, x + 640, yy + line_h - 4], fill=(255, 255, 255, 22))
        d.text((x - 36, yy), str(i + 1), font=mf, fill=(80, 80, 90), anchor="lm")
        cx = x
        for text, col in tokenize_toml(line):
            d.text((cx, yy), text, font=mf, fill=col, anchor="lm")
            cx += d.textlength(text, font=mf)


def draw_vscode_window(wall=None, opacity=0.18, blur=0, file_tab="cargo.toml",
                       code_lines=None, show_terminal=False, title="rust深度学习",
                       highlight_line=None):
    ww, wh = 1280, 820
    shadow = Image.new("RGBA", (ww + 60, wh + 60), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([30, 36, ww + 30, wh + 30], radius=12, fill=(0, 0, 0, 160))
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))

    body = Image.new("RGBA", (ww, wh), VSC_BG + (255,))
    bd = ImageDraw.Draw(body)
    bd.rectangle([0, 0, ww, 36], fill=(32, 32, 36, 255))
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        bd.ellipse([14 + i * 22, 12, 28 + i * 22, 26], fill=c)
    bd.rounded_rectangle([ww // 2 - 180, 8, ww // 2 + 180, 28], radius=6, fill=(60, 60, 66, 255))
    bd.text((ww // 2, 18), title, font=font(12), fill=(180, 180, 188), anchor="mm")
    bd.rounded_rectangle([ww // 2 + 200, 8, ww // 2 + 250, 28], radius=6, fill=(0, 120, 180, 255))
    bd.text((ww // 2 + 225, 18), "更新", font=font(11, True), fill=WHITE, anchor="mm")

    act_x = 48
    bd.rectangle([0, 36, act_x, wh - 22], fill=VSC_SIDE2)
    for i, k in enumerate(["files", "search", "git", "debug", "ext"]):
        draw_activity_icon(bd, act_x // 2, 60 + i * 44, k, active=(i == 0))
    bd.ellipse([act_x // 2 - 10, wh - 50, act_x // 2 + 10, wh - 30], outline=(140, 140, 150), width=1)

    side_w = 220
    bd.rectangle([act_x, 36, act_x + side_w, wh - 22], fill=VSC_SIDE)
    bd.text((act_x + 16, 54), "资源管理器", font=font(13, True), fill=(200, 200, 208))
    bd.text((act_x + 16, 84), "RUST深度学习", font=font(12, True), fill=(180, 180, 188))
    files = [("▾ src", False), ("  lib.rs", False), ("  train.rs", False),
             ("▾ crates", False), ("  tensor", False), (file_tab, True),
             ("Cargo.lock", False), ("README.md", False)]
    for i, (name, act) in enumerate(files):
        yy = 110 + i * 26
        if act:
            bd.rectangle([act_x, yy - 10, act_x + side_w, yy + 14], fill=(0, 90, 140, 180))
        bd.text((act_x + 20, yy), name, font=font(13), fill=WHITE if act else (190, 190, 198))
    bd.text((act_x + 16, wh - 120), "大纲", font=font(12), fill=DIM)
    bd.text((act_x + 16, wh - 96), "时间线", font=font(12), fill=DIM)

    ed_x, ed_y = act_x + side_w, 36
    ed_w = ww - ed_x
    ed_h = wh - ed_y - 22 - (160 if show_terminal else 0)

    editor = Image.new("RGBA", (ed_w, ed_h), VSC_BG + (255,))
    if wall is not None:
        wimg = wall.resize((ed_w, ed_h), Image.Resampling.LANCZOS).convert("RGBA")
        if blur > 0:
            wimg = wimg.filter(ImageFilter.GaussianBlur(blur))
        a = max(8, min(255, int(255 * opacity)))
        editor = Image.alpha_composite(wimg, Image.new("RGBA", (ed_w, ed_h), (30, 30, 30, 255 - a)))
        shade = Image.new("RGBA", (ed_w, ed_h), (0, 0, 0, 0))
        sd = ImageDraw.Draw(shade)
        for i in range(36):
            sd.rectangle([0, 0, ed_w, i], fill=(0, 0, 0, int(2 + i * 0.35)))
        editor.alpha_composite(shade)

    ed = ImageDraw.Draw(editor)
    ed.rectangle([0, 0, ed_w, 36], fill=VSC_TAB)
    ed.rectangle([0, 0, 180, 36], fill=VSC_TAB_ACT)
    ed.text((16, 18), file_tab, font=font(13), fill=WHITE, anchor="lm")
    ed.text((160, 18), "×", font=font(14), fill=DIM, anchor="mm")
    ed.text((200, 18), "欢迎", font=font(13), fill=DIM, anchor="lm")
    crumb_alpha = 120 if wall is not None else 255
    ed.rectangle([0, 36, ed_w, 58], fill=(30, 30, 30, crumb_alpha))
    ed.text((16, 47), f"{title}  ›  [workspace]  ›  [members]  ›  abc", font=font(12), fill=(150, 150, 160), anchor="lm")

    if code_lines is None:
        code_lines = CARGO_TOML
    draw_code_lines(ed, 70, 80, code_lines, highlight=highlight_line)

    mm_x = ed_w - 70
    ed.rectangle([mm_x, 58, ed_w, ed_h], fill=(0, 0, 0, 60))
    random.seed(3)
    for i in range(0, ed_h - 70, 4):
        lw = random.randint(8, 40)
        col = random.choice([(86, 156, 214, 80), (78, 201, 176, 70), (206, 145, 120, 70), (212, 212, 212, 60)])
        ed.rectangle([mm_x + 8, 70 + i, mm_x + 8 + lw, 70 + i + 2], fill=col)

    body.alpha_composite(editor, (ed_x, ed_y))

    if show_terminal:
        term_h = 160
        if wall is not None:
            wimg = wall.resize((ed_w, term_h), Image.Resampling.LANCZOS).convert("RGBA")
            if blur > 0:
                wimg = wimg.filter(ImageFilter.GaussianBlur(blur + 2))
            a = max(6, int(255 * opacity * 0.9))
            term = Image.alpha_composite(wimg, Image.new("RGBA", (ed_w, term_h), (18, 18, 20, 255 - a)))
        else:
            term = Image.new("RGBA", (ed_w, term_h), (30, 30, 30, 230))
        td = ImageDraw.Draw(term)
        td.rectangle([0, 0, ed_w, 28], fill=(45, 45, 48, 220))
        for i, t in enumerate(["终端", "输出", "调试控制台", "问题"]):
            td.text((16 + i * 90, 14), t, font=font(12), fill=WHITE if i == 0 else DIM, anchor="lm")
        td.rounded_rectangle([8, 36, 280, 64], radius=12, fill=(70, 120, 70, 200), outline=(120, 200, 120, 180))
        td.text((24, 50), "fuurin  ~", font=mono_font(13), fill=(220, 255, 220), anchor="lm")
        td.rounded_rectangle([300, 36, 420, 64], radius=12, fill=(50, 90, 140, 200))
        td.text((360, 50), "v22.23.1", font=mono_font(12), fill=(200, 220, 255), anchor="mm")
        td.rounded_rectangle([430, 36, 560, 64], radius=12, fill=(60, 60, 80, 200))
        td.text((495, 50), "v3.14.6", font=mono_font(12), fill=(220, 220, 240), anchor="mm")
        td.text((580, 50), "16:30", font=mono_font(12), fill=WHITE, anchor="lm")
        td.text((16, 90), "> cargo train --epochs 10", font=mono_font(14), fill=(120, 220, 160), anchor="lm")
        td.text((16, 114), "  epoch 3/10  loss 0.0421  acc 0.97", font=mono_font(13), fill=(180, 180, 190), anchor="lm")
        td.text((16, 138), "█", font=mono_font(14), fill=(120, 220, 160), anchor="lm")
        body.alpha_composite(term, (ed_x, ed_y + ed_h))

    st = ImageDraw.Draw(body)
    st.rectangle([0, wh - 22, ww, wh], fill=VSC_STATUS)
    st.text((12, wh - 11), "main*", font=font(11), fill=WHITE, anchor="lm")
    st.text((90, wh - 11), "0 errors  0 warnings", font=font(11), fill=WHITE, anchor="lm")
    st.text((240, wh - 11), "Live Share", font=font(11), fill=WHITE, anchor="lm")
    st.text((320, wh - 11), "-- INSERT --", font=font(11), fill=WHITE, anchor="lm")
    st.text((420, wh - 11), "TOML", font=font(11), fill=WHITE, anchor="lm")
    bx = ww - 220
    st.rounded_rectangle([bx, wh - 20, bx + 110, wh - 4], radius=3, fill=(0, 90, 140, 255))
    st.text((bx + 55, wh - 11), "Background", font=font(11, True), fill=(180, 240, 255), anchor="mm")
    st.text((bx + 130, wh - 11), "Dependenci", font=font(11), fill=WHITE, anchor="lm")

    canvas = Image.new("RGBA", (ww + 40, wh + 40), (0, 0, 0, 0))
    canvas.alpha_composite(shadow, (0, 0))
    canvas.alpha_composite(body, (20, 20))
    ImageDraw.Draw(canvas).rounded_rectangle([20, 20, 20 + ww, 20 + wh], radius=8, outline=(70, 70, 78, 255), width=1)
    return canvas


def orange_arrow(img, p1, p2, width=4, label=None, label_pos=None):
    d = ImageDraw.Draw(img)
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(glow).line([p1, p2], fill=ORANGE + (90,), width=width + 8)
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(6)))
    d.line([p1, p2], fill=ORANGE + (255,), width=width)
    ang = math.atan2(p2[1] - p1[1], p2[0] - p1[0])
    alen = 18
    left = (p2[0] - alen * math.cos(ang - 0.4), p2[1] - alen * math.sin(ang - 0.4))
    right = (p2[0] - alen * math.cos(ang + 0.4), p2[1] - alen * math.sin(ang + 0.4))
    d.polygon([p2, left, right], fill=ORANGE + (255,))
    if label:
        lx, ly = label_pos or ((p1[0] + p2[0]) // 2, (p1[1] + p2[1]) // 2 - 30)
        tw = d.textlength(label, font=font(16, True))
        d.rounded_rectangle([lx - 8, ly - 16, lx + tw + 8, ly + 16], radius=8, fill=(20, 16, 10, 200), outline=ORANGE, width=1)
        d.text((lx, ly), label, font=font(16, True), fill=ORANGE, anchor="mm")


def bottom_caption(base, caption, sub=None):
    d = ImageDraw.Draw(base)
    bar_h = 100 if sub else 72
    ov = Image.new("RGBA", (W, bar_h + 20), (0, 0, 0, 0))
    ImageDraw.Draw(ov).rounded_rectangle([40, 8, W - 40, bar_h], radius=16, fill=(0, 0, 0, 170), outline=ORANGE + (180,), width=2)
    base.alpha_composite(ov, (0, H - bar_h - 16))
    d.text((W // 2, H - bar_h + 18), caption, font=font(26, True), fill=WHITE, anchor="mm")
    if sub:
        d.text((W // 2, H - bar_h + 52), sub, font=font(18), fill=(200, 200, 210), anchor="mm")


def top_badge(base, text):
    d = ImageDraw.Draw(base)
    tw = d.textlength(text, font=font(18, True)) + 40
    d.rounded_rectangle([W // 2 - tw // 2, 40, W // 2 + tw // 2, 78], radius=12, fill=(0, 0, 0, 180), outline=ORANGE, width=2)
    d.text((W // 2, 59), text, font=font(18, True), fill=WHITE, anchor="mm")


def compose_scene(wall_name, opacity=0.18, blur=0, show_terminal=True,
                  file_tab="cargo.toml", code_lines=None, highlight=None,
                  caption=None, caption_sub=None, win_pos=(280, 60),
                  arrows=None, badge=None, show_dock=True):
    wall = load_wall(wall_name)
    base = wall.convert("RGBA")
    vign = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    vd = ImageDraw.Draw(vign)
    for i in range(100):
        a = int(i * 0.4)
        vd.rectangle([0, i, W, i + 1], fill=(0, 0, 0, a))
        vd.rectangle([0, H - i, W, H - i + 1], fill=(0, 0, 0, a))
    base.alpha_composite(vign)
    draw_macos_menubar(base)
    win = draw_vscode_window(
        wall=wall, opacity=opacity, blur=blur, file_tab=file_tab,
        code_lines=code_lines, show_terminal=show_terminal, highlight_line=highlight,
    )
    base.alpha_composite(win, win_pos)
    if show_dock:
        draw_dock(base)
    if arrows:
        for a in arrows:
            orange_arrow(base, a["from"], a["to"], label=a.get("label"), label_pos=a.get("label_pos"))
    if badge:
        top_badge(base, badge)
    if caption:
        bottom_caption(base, caption, caption_sub)
    return base


def save(img, name):
    p = os.path.join(OUT_FRAMES, name)
    img.convert("RGB").save(p, quality=95)
    print("wrote", name)


def make_browser_window(url, content_draw):
    """简易浏览器窗 + 阴影，返回可 paste 的 RGBA"""
    bw, bh = 1100, 720
    br = Image.new("RGBA", (bw, bh), (32, 32, 36, 255))
    brr = ImageDraw.Draw(br)
    brr.rounded_rectangle([0, 0, bw - 1, bh - 1], radius=10, fill=(32, 32, 36, 255), outline=(70, 70, 78), width=1)
    brr.rectangle([0, 0, bw, 48], fill=(42, 42, 48, 255))
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        brr.ellipse([16 + i * 22, 16, 30 + i * 22, 30], fill=c)
    brr.rounded_rectangle([80, 12, bw - 40, 36], radius=8, fill=(24, 24, 28, 255))
    brr.text((100, 24), url, font=font(14), fill=CYAN, anchor="lm")
    content_draw(brr, bw, bh)
    sh = Image.new("RGBA", (bw + 40, bh + 40), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([20, 24, bw + 20, bh + 20], radius=12, fill=(0, 0, 0, 150))
    sh = sh.filter(ImageFilter.GaussianBlur(18))
    canvas = Image.new("RGBA", (bw + 40, bh + 40), (0, 0, 0, 0))
    canvas.alpha_composite(sh, (0, 0))
    canvas.alpha_composite(br, (20, 20))
    return canvas


def main():
    # 1 default boring
    img = compose_scene(
        "wall-anime-room.png", opacity=0.0, show_terminal=False,
        caption="默认 VS Code：纯色背景，有点无聊", caption_sub="coders deserve better skins",
        win_pos=(300, 70), show_dock=True,
    )
    save(img, "s01_default.png")

    # 2 click Background
    img = compose_scene(
        "wall-anime-room.png", opacity=0.0, show_terminal=False,
        caption="状态栏点开 Background 菜单", caption_sub="bg-skin: 选择背景图（可多选）",
        win_pos=(300, 70),
        arrows=[{"from": (1400, 1020), "to": (1180, 900), "label": "点这里", "label_pos": (1480, 980)}],
    )
    save(img, "s02_menu.png")

    # 3 main after shot
    img = compose_scene(
        "wall-anime-forest.png", opacity=0.20, blur=0, show_terminal=True,
        file_tab="cargo.toml", code_lines=CARGO_TOML, highlight=7,
        caption="换上自己的壁纸，代码区半透明透出",
        caption_sub="透明度 0.20 · 终端同样透出 · 可读性依旧在线",
        win_pos=(280, 60),
        arrows=[{"from": (700, 420), "to": (980, 560), "label": "壁纸在这里透出", "label_pos": (820, 380)}],
        badge="bg-skin · AFTER",
    )
    save(img, "s03_after.png")

    # 4 before/after compare
    wall = load_wall("wall-anime-forest.png")
    base = wall.convert("RGBA")
    base.alpha_composite(Image.new("RGBA", (W, H), (0, 0, 0, 40)))
    draw_macos_menubar(base)
    left = draw_vscode_window(wall=None, opacity=0, show_terminal=False, code_lines=CARGO_TOML)
    left = left.resize((int(left.width * 0.62), int(left.height * 0.62)), Image.Resampling.LANCZOS)
    right = draw_vscode_window(wall=wall, opacity=0.22, show_terminal=True, code_lines=CARGO_TOML)
    right = right.resize((int(right.width * 0.62), int(right.height * 0.62)), Image.Resampling.LANCZOS)
    base.alpha_composite(left, (40, 80))
    base.alpha_composite(right, (980, 80))
    d = ImageDraw.Draw(base)
    d.rounded_rectangle([40, 50, 200, 78], radius=8, fill=(80, 80, 90, 200))
    d.text((120, 64), "BEFORE", font=font(16, True), fill=WHITE, anchor="mm")
    d.rounded_rectangle([980, 50, 1140, 78], radius=8, fill=(255, 140, 40, 220))
    d.text((1060, 64), "AFTER", font=font(16, True), fill=WHITE, anchor="mm")
    orange_arrow(base, (880, 500), (1000, 500), label="bg-skin", label_pos=(900, 450))
    bottom_caption(base, "一键对比：从死黑到属于你的编辑器", "图片路径写入 settings，升级还会自动重打补丁")
    save(base, "s04_compare.png")

    # 5 city mode
    img = compose_scene(
        "wall-anime-city.png", opacity=0.28, blur=3, show_terminal=True,
        file_tab="extension.js", code_lines=EXT_JS,
        caption="透明度 / 模糊 / 位置 随手调",
        caption_sub="霓虹城市场景 · blur 3px · 代码仍可读",
        win_pos=(280, 60), badge="bg-skin · CITY MODE",
    )
    save(img, "s05_city.png")

    # 6 gallery
    wall = load_wall("wall-anime-room.png")
    base = wall.convert("RGBA")
    base.alpha_composite(Image.new("RGBA", (W, H), (0, 0, 0, 50)))
    draw_macos_menubar(base)
    thumbs = [("wall-anime-forest.png", 0.20, 80, "Forest"), ("wall-anime-city.png", 0.24, 700, "Cyber City"), ("wall-anime-room.png", 0.22, 1320, "Cozy Room")]
    for i, (wn, op, x, lab) in enumerate(thumbs):
        w = load_wall(wn)
        win = draw_vscode_window(wall=w, opacity=op, show_terminal=(i == 1), file_tab="main.rs", code_lines=CARGO_TOML if i != 1 else EXT_JS)
        win = win.resize((560, 360), Image.Resampling.LANCZOS)
        base.alpha_composite(win, (x, 120))
        fr = Image.new("RGBA", (570, 370), (0, 0, 0, 0))
        ImageDraw.Draw(fr).rounded_rectangle([0, 0, 568, 368], radius=10, outline=[CYAN, ORANGE, (197, 134, 192)][i], width=3)
        base.alpha_composite(fr, (x - 5, 115))
        ImageDraw.Draw(base).text((x + 280, 510), lab, font=font(20, True), fill=WHITE, anchor="mm")
    bottom_caption(base, "多张图随机轮换，每天打开都有新鲜感", "命令：bg-skin: 随机切换背景图")
    save(base, "s06_gallery.png")

    # 7 trust
    img = compose_scene(
        "wall-anime-forest.png", opacity=0.18, show_terminal=True,
        caption="校验和自动重写 · 升级自愈 · 卸载一键还原",
        caption_sub="改核心文件前先备份，Output 面板可查每一份备份路径",
        win_pos=(280, 60), badge="SAFE ENGINEERING",
    )
    save(img, "s07_trust.png")

    # 8 github search
    wall = load_wall("wall-anime-room.png")
    base = wall.convert("RGBA")
    base.alpha_composite(Image.new("RGBA", (W, H), (0, 0, 0, 30)))
    draw_macos_menubar(base)

    def gh_content(brr, bw, bh):
        brr.rounded_rectangle([40, 80, bw - 40, 240], radius=10, fill=(22, 26, 36, 255), outline=ORANGE, width=2)
        brr.text((60, 120), "sdh0219 / bg-skin", font=font(28, True), fill=(88, 166, 255))
        brr.text((60, 170), "VS Code 自定义编辑器背景 · MIT License · Releases", font=font(16), fill=DIM)
        brr.rounded_rectangle([bw - 180, 100, bw - 60, 140], radius=8, fill=(255, 200, 40, 40), outline=GOLD, width=2)
        brr.text((bw - 120, 120), "Star", font=font(18, True), fill=GOLD, anchor="mm")
        for i in range(3):
            yy = 280 + i * 100
            brr.rounded_rectangle([40, yy, bw - 40, yy + 80], radius=8, fill=(28, 28, 34, 220))
            brr.text((60, yy + 40), ["其他无关仓库…", "awesome-vscode 列表", "vsce 打包工具"][i], font=font(16), fill=(100, 100, 110), anchor="lm")

    win = make_browser_window("https://github.com/sdh0219/bg-skin", gh_content)
    base.alpha_composite(win, (390, 100))
    orange_arrow(base, (1280, 260), (1100, 200), label="认准这个仓库", label_pos=(1320, 300))
    bottom_caption(base, "1 浏览器打开 GitHub，搜 bg-skin", "github.com/sdh0219/bg-skin")
    save(base, "s08_github.png")

    # 9 releases
    base = load_wall("wall-anime-forest.png").convert("RGBA")
    base.alpha_composite(Image.new("RGBA", (W, H), (0, 0, 0, 35)))
    draw_macos_menubar(base)

    def rel_content(brr, bw, bh):
        brr.rounded_rectangle([40, 80, bw - 40, 360], radius=10, fill=(22, 24, 34, 255), outline=CYAN, width=2)
        brr.text((60, 120), "bg-skin 0.2.0", font=font(26, True), fill=CYAN)
        brr.rounded_rectangle([60, 170, 400, 250], radius=10, fill=(0, 90, 140, 255), outline=CYAN, width=2)
        brr.text((230, 210), "bg-skin-0.2.0.vsix", font=font(20, True), fill=WHITE, anchor="mm")
        brr.text((60, 290), "Assets：只下 .vsix，不要 Source code (zip)", font=font(16), fill=GOLD)
        brr.text((60, 330), "校验和 / 升级自愈 / 卸载还原 已包含", font=font(14), fill=DIM)

    win = make_browser_window("https://github.com/sdh0219/bg-skin/releases", rel_content)
    base.alpha_composite(win, (390, 100))
    orange_arrow(base, (1100, 480), (700, 400), label="下载 vsix", label_pos=(920, 520))
    bottom_caption(base, "2 进 Releases，下载 .vsix 安装包", "约 23KB，免构建，普通用户零门槛")
    save(base, "s09_releases.png")

    # 10 install vsix
    img = compose_scene(
        "wall-anime-room.png", opacity=0.0, show_terminal=False,
        caption="3 VS Code 扩展面板  ···  从 VSIX 安装",
        caption_sub="装完右下角会出现 Background 按钮",
        win_pos=(280, 60),
        arrows=[{"from": (1500, 400), "to": (1200, 320), "label": "从 VSIX 安装...", "label_pos": (1520, 360)}],
        badge="INSTALL FROM VSIX",
    )
    save(img, "s10_vsix.png")

    # 11 done + star
    img = compose_scene(
        "wall-anime-forest.png", opacity=0.22, show_terminal=True,
        caption="4 选图  重载窗口  壁纸出现！",
        caption_sub="觉得有用的话，去 GitHub 点个 Star 好不好？拜托拜托",
        win_pos=(280, 60),
        arrows=[{"from": (700, 420), "to": (1000, 560), "label": "成功！", "label_pos": (800, 380)}],
        badge="THANK YOU  ·  STAR ME",
    )
    save(img, "s11_done.png")

    print("all v3 frames ->", OUT_FRAMES)


if __name__ == "__main__":
    main()
