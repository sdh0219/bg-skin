# -*- coding: utf-8 -*-
"""v4: extra smooth frames - opacity ramp + settings + palette"""
import importlib.util
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("v3", os.path.join(ROOT, "make-frames-v3.py"))
v3 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v3)

OUT = v3.OUT_FRAMES
W, H = v3.W, v3.H
from PIL import Image, ImageDraw, ImageFont

CARGO = v3.CARGO_TOML
EXT = v3.EXT_JS


def save(img, name):
    p = os.path.join(OUT, name)
    img.convert("RGB").save(p, quality=95)
    print("wrote", name)


# opacity ramp 4 stages (smoother reveal)
for i, (op, blur, tag) in enumerate([(0.06, 0, "a"), (0.12, 0, "b"), (0.18, 1, "c"), (0.24, 2, "d")], 1):
    img = v3.compose_scene(
        "wall-anime-forest.png",
        opacity=op,
        blur=blur,
        show_terminal=True,
        file_tab="cargo.toml",
        code_lines=CARGO,
        highlight=7,
        caption=f"调透明度 {op:.2f}" + (f" · blur {blur}px" if blur else ""),
        caption_sub="越调越有氛围感，代码依旧好读",
        win_pos=(280, 60),
        badge=f"OPACITY {op:.2f}",
        arrows=[{"from": (700, 420), "to": (980, 560), "label": "壁纸透出", "label_pos": (820, 380)}] if i >= 2 else None,
    )
    save(img, f"s03{tag}_opacity.png")

# settings.json scene
settings_lines = [
    "{",
    '  "bgSkin.enabled": true,',
    '  "bgSkin.images": [',
    '    "D:/wallpapers/forest.png",',
    '    "D:/wallpapers/city.png"',
    "  ],",
    '  "bgSkin.opacity": 0.22,',
    '  "bgSkin.blur": 2,',
    '  "bgSkin.position": "cover",',
    '  "bgSkin.mode": "behind"',
    "}",
]
img = v3.compose_scene(
    "wall-anime-city.png",
    opacity=0.20,
    blur=2,
    show_terminal=False,
    file_tab="settings.json",
    code_lines=settings_lines,
    highlight=6,
    caption="配置写在 settings.json，改完重载即可",
    caption_sub="images / opacity / blur / position / mode",
    win_pos=(280, 60),
    badge="bgSkin SETTINGS",
)
save(img, "s12_settings.png")

# command palette
wall = v3.load_wall("wall-anime-forest.png")
base = wall.convert("RGBA")
base.alpha_composite(Image.new("RGBA", (W, H), (0, 0, 0, 40)))
v3.draw_macos_menubar(base)
win = v3.draw_vscode_window(wall=wall, opacity=0.20, show_terminal=True, code_lines=CARGO)
base.alpha_composite(win, (280, 60))
d = ImageDraw.Draw(base)
# palette overlay
px, py, pw, ph = 420, 160, 1000, 360
d.rounded_rectangle([px, py, px + pw, py + ph], radius=12, fill=(30, 30, 36, 245), outline=v3.CYAN, width=2)
d.rectangle([px, py, px + pw, py + 56], fill=(24, 24, 30, 255))
d.text((px + 24, py + 28), ">", font=v3.mono_font(20), fill=v3.CYAN, anchor="lm")
d.text((px + 48, py + 28), "bg-skin", font=v3.font(20), fill=v3.WHITE, anchor="lm")
cmds = [
    "bg-skin: 背景设置菜单",
    "bg-skin: 选择背景图（可多选）",
    "bg-skin: 随机切换背景图",
    "bg-skin: 调整背景透明度",
    "bg-skin: 开启 / 关闭背景",
]
for i, c in enumerate(cmds):
    yy = py + 90 + i * 48
    if i == 1:
        d.rounded_rectangle([px + 12, yy - 18, px + pw - 12, yy + 22], radius=6, fill=(0, 90, 140, 200))
    d.text((px + 36, yy), c, font=v3.font(18), fill=v3.WHITE if i == 1 else (180, 180, 190), anchor="lm")
v3.orange_arrow(base, (1400, 280), (1100, 250), label="命令面板", label_pos=(1420, 240))
v3.bottom_caption(base, "Ctrl+Shift+P 输入 bg-skin，全部功能都在这", "状态栏 Background 按钮 = 同款菜单")
save(base, "s13_palette.png")

# outro hold frame - star + recap
img = v3.compose_scene(
    "wall-anime-room.png",
    opacity=0.22,
    show_terminal=True,
    caption="开源 MIT · 升级自愈 · 卸载还原 · GitHub 搜 bg-skin",
    caption_sub="点个 Star 支持一下，我们下次见，拜拜～",
    win_pos=(280, 60),
    badge="THANK YOU  ·  STAR ME  ·  BYE",
)
save(img, "s14_outro.png")

print("v4 extra frames done")
