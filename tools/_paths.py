"""Shared paths for the browser test tools: run them from anywhere in a clone.
Screenshots go to ./shots (git-ignored) unless SHOTS is set; CHROME overrides the browser binary."""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = 'file://' + os.path.join(ROOT, 'dist', 'index.html')
URL = PAGE + '?notour'  # the quick tour opens by itself for a new player; the checks start past it (ui.py tests it on PAGE)
SHOTS = os.environ.get('SHOTS', os.path.join(ROOT, 'shots'))
os.makedirs(SHOTS, exist_ok=True)
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')
