# -*- coding: utf-8 -*-
import io
p = r'C:\Users\31482\Doubao\chats\2026-09-26\new-chat\StructMind-Agent\src\pages\HomePage\HomePage.tsx'
s = io.open(p, encoding='utf-8').read()
old = """           .app-shell, #root > div:not(.print-only) {
             display: none !important;
           }"""
new = """           .app-shell {
             display: none !important;
           }"""
n = s.count(old)
assert n == 1, n
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('OK selector-fix2')
