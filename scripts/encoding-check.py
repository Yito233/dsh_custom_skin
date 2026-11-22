import pathlib
import sys

root = pathlib.Path(r"E:\Deepseek harness\custom-skin")
for name in ["src/main.js", "src/core.js", "src/i18n.js", "client.js"]:
    path = root / name
    if not path.exists():
        print(name, "missing")
        continue
    raw = path.read_bytes()
    try:
        raw.decode("utf-8")
        state = "utf-8"
    except UnicodeDecodeError as err:
        state = "not-utf8: " + str(err)
    cjk = sum(1 for ch in raw.decode("utf-8", "ignore") if "\u4e00" <= ch <= "\u9fff")
    print(name, len(raw), state, "cjk-chars:", cjk)
