"""Shared paths for the browser test tools: run them from anywhere in a clone.
Screenshots go to ./shots (git-ignored) unless SHOTS is set; CHROME overrides the browser binary."""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = 'file://' + os.path.join(ROOT, 'dist', 'index.html')
SHOTS = os.environ.get('SHOTS', os.path.join(ROOT, 'shots'))
os.makedirs(SHOTS, exist_ok=True)
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')
