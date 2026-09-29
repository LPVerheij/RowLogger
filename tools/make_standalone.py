#!/usr/bin/env python3
"""Build the single-file Arduino sketch from the firmware modules.

  firmware/RowLog/*.h, *.cpp  ->  firmware/RowLogStandalone/RowLogStandalone.ino

The modules in firmware/RowLog/ are the source. The standalone .ino is generated from them
(never edit it by hand): run this script after changing a module, and commit both.

  python3 tools/make_standalone.py          write the standalone sketch
  python3 tools/make_standalone.py --check  exit 1 if it is out of date (no changes made)
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "firmware" / "RowLog"
OUT = ROOT / "firmware" / "RowLogStandalone" / "RowLogStandalone.ino"

# Headers first (declarations, in dependency order), then the implementations, main.cpp last.
HEADERS = ["rowlog_config.h", "rowlog.h", "imu.h", "tapzero.h", "sdlog.h", "blelink.h",
           "strokerate.h", "boatmotion.h", "sonify.h", "oled.h", "ledbutton.h"]
SOURCES = ["imu.cpp", "tapzero.cpp", "sdlog.cpp", "blelink.cpp", "strokerate.cpp",
           "boatmotion.cpp", "sonify.cpp", "oled.cpp", "ledbutton.cpp", "main.cpp"]

LOCAL_INCLUDE = re.compile(r'^\s*#\s*include\s+"[^"]+"\s*$')
PRAGMA_ONCE = re.compile(r'^\s*#\s*pragma\s+once\s*$')


def body(name, text):
    lines = [l for l in text.splitlines() if not LOCAL_INCLUDE.match(l) and not PRAGMA_ONCE.match(l)]
    while lines and not lines[0].strip():
        lines.pop(0)
    rule = "=" * 88
    return f"// {rule}\n// {name}\n// {rule}\n" + "\n".join(lines).rstrip() + "\n"


def build():
    for f in HEADERS + SOURCES:
        if not (SRC / f).exists():
            sys.exit(f"missing module: {SRC / f}")
    listed = set(HEADERS + SOURCES)
    extra = [p.name for p in sorted(SRC.glob("*.[ch]*")) if p.suffix in (".h", ".cpp") and p.name not in listed]
    if extra:
        sys.exit("modules not listed in tools/make_standalone.py: " + ", ".join(extra))

    main = (SRC / "main.cpp").read_text()
    m = re.match(r"\s*/\*.*?\*/\s*", main, re.S)          # main.cpp's header comment goes on top
    doc = m.group(0).strip() if m else ""
    main_rest = main[m.end():] if m else main

    parts = [doc, "",
             "// This single-file sketch is GENERATED from the modules in firmware/RowLog/ by",
             "// tools/make_standalone.py. Don't edit it: change the modules and run the script.",
             "// Settings and pins are in the rowlog_config.h section right below.", ""]
    parts += [body(f, (SRC / f).read_text()) for f in HEADERS]
    parts += [body(f, (SRC / f).read_text() if f != "main.cpp" else main_rest) for f in SOURCES]
    return "\n".join(parts)


def main():
    text = build()
    if "--check" in sys.argv[1:]:
        current = OUT.read_text() if OUT.exists() else ""
        if current != text:
            print(f"{OUT.relative_to(ROOT)} is out of date: run python3 tools/make_standalone.py")
            sys.exit(1)
        print(f"{OUT.relative_to(ROOT)} is up to date")
        return
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text)
    print(f"wrote {OUT.relative_to(ROOT)} ({len(text.splitlines())} lines)")


if __name__ == "__main__":
    main()
