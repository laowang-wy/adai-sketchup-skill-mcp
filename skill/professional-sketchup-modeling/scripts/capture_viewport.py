"""Compatibility entry: foreground-stealing capture has been retired."""
from capture_window import main
import json
if __name__ == '__main__': print(json.dumps(main(), ensure_ascii=True))
